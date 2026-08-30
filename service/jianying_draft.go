// 剪映（Jianying）草稿导出。
// 依据剪映公开草稿格式说明（draft_content.json 的 tracks/materials/segments 组织方式）
// 独立实现，未复制任何第三方代码（未参考/未使用 VOZEB-PRO、jsjianyingdraft 等
// BUSL-1.1 或其他受限协议项目的实现）。
//
// 草稿目录结构：
//
//	<draftName>/
//	  draft_content.json   时间轴与素材描述（tracks + materials + segments）
//	  draft_meta_info.json 草稿元信息
//	  draft_info.json      新版剪映打开草稿时需要的最简信息
//	  Resources/           下载好的视频/图片/音频素材文件
//
// 三轨映射：视频/图片素材 -> video 轨（主轨，顺序拼接）；
// 音频素材 -> audio 轨（从 0 秒起按顺序排布）；
// SRT 字幕逐条 -> text 轨的 text segment（绝对时间）。
//
// 所有 JSON 内的相对路径统一使用斜杠。
package service

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
)

const jianyingDraftRootDir = "data/jianying-drafts"

// 草稿内容格式版本号。公开资料中现代剪映（5.x 起）草稿 draft_content.json
// 的 version 字段常见取值为 360001 一类的大整数（并非小版本号递增），
// 此处取 360001 作为已知可用值；不同剪映版本对最低版本要求可能不同，需实测确认。
const jianyingDraftContentVersion = 360001

// 无法探测视频时长时的兜底片段时长（与前端图片/配音默认 5 秒一致）。
const jianyingFallbackVideoDurationUs = 5_000_000

// BuildJianyingDraft 生成剪映草稿到临时目录，返回目录路径。
// 目录布局：data/jianying-drafts/<uuid>/<draftName>/。调用方负责用完后删除
// data/jianying-drafts/<uuid> 根目录（handler 流式打包后清理）。
// 素材复用渲染任务的下载方式（存储对象走 storage 服务，外链走 SSRF 安全客户端）。
func BuildJianyingDraft(ctx context.Context, userID string, spec model.TimelineSpec, draftName string) (rootDir string, err error) {
	if strings.TrimSpace(userID) == "" {
		return "", safeMessageError{message: "请先登录"}
	}
	if err := normalizeTimelineSpec(&spec); err != nil {
		return "", err
	}
	draftName = sanitizeJianyingDraftName(draftName)

	rootDir = filepath.Join(jianyingDraftRootDir, uuid.NewString())
	draftDir := filepath.Join(rootDir, draftName)
	resourcesDir := filepath.Join(draftDir, "Resources")
	if err := os.MkdirAll(resourcesDir, 0755); err != nil {
		return "", fmt.Errorf("草稿目录创建失败：%w", err)
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(rootDir)
		}
	}()

	var (
		videoMaterials []any
		audioMaterials []any
		textMaterials  []any
		videoSegments  []any
		audioSegments  []any
		textSegments   []any
	)
	videoTrackEndUs := int64(0)
	audioTrackEndUs := int64(0)

	// 素材下载与主轨/音频轨段落构建，按 spec.Items 顺序。
	for index, item := range spec.Items {
		path, downloadErr := downloadRenderItem(ctx, item.Source, resourcesDir, index)
		if downloadErr != nil {
			return "", safeMessageError{message: fmt.Sprintf("第 %d 个素材下载失败：%s", index+1, safeErrorMessage(downloadErr))}
		}
		relativePath := "Resources/" + filepath.Base(path)
		materialID := uuid.NewString()

		switch item.Kind {
		case model.RenderItemKindAudio:
			durationUs := int64(item.DurationMs) * 1000
			audioMaterials = append(audioMaterials, jianyingAudioMaterial(materialID, filepath.Base(path), relativePath, durationUs))
			audioSegments = append(audioSegments, jianyingMediaSegment(materialID, durationUs, durationUs, audioTrackEndUs))
			audioTrackEndUs += durationUs
		default: // video / image 均放主轨
			materialType := "video"
			durationUs := int64(item.DurationMs) * 1000
			if item.Kind == model.RenderItemKindVideo {
				durationUs = jianyingResolveVideoDurationUs(ctx, item, path)
			} else {
				materialType = "photo"
			}
			videoMaterials = append(videoMaterials, jianyingVideoMaterial(materialID, filepath.Base(path), relativePath, materialType, item.Kind == model.RenderItemKindVideo, durationUs))
			videoSegments = append(videoSegments, jianyingMediaSegment(materialID, durationUs, durationUs, videoTrackEndUs))
			videoTrackEndUs += durationUs
		}
	}

	if len(videoSegments) == 0 && len(audioSegments) == 0 {
		return "", safeMessageError{message: "时间轴没有可导出的素材"}
	}

	// SRT 对白 -> 文本轨段落（逐条字幕一个 text segment，绝对时间）。
	textTrackEndUs := int64(0)
	for _, entry := range parseSrtEntries(spec.Srt) {
		materialID := uuid.NewString()
		textMaterials = append(textMaterials, jianyingTextMaterial(materialID, entry.Text))
		startUs := int64(entry.StartMs) * 1000
		durationUs := int64(entry.EndMs-entry.StartMs) * 1000
		textSegments = append(textSegments, jianyingMediaSegment(materialID, durationUs, durationUs, startUs))
		if end := startUs + durationUs; end > textTrackEndUs {
			textTrackEndUs = end
		}
	}

	totalDurationUs := max64(videoTrackEndUs, audioTrackEndUs, textTrackEndUs)
	draftID := uuid.NewString()
	nowUnix := time.Now().Unix()

	content := jianyingDraftContent(draftID, spec, videoMaterials, audioMaterials, textMaterials, videoSegments, audioSegments, textSegments, totalDurationUs, nowUnix)
	files := map[string]any{
		"draft_content.json":   content,
		"draft_meta_info.json": jianyingDraftMetaInfo(draftID, draftName, totalDurationUs, nowUnix),
		"draft_info.json":      jianyingDraftInfo(draftID, draftName, totalDurationUs, nowUnix),
	}
	for name, value := range files {
		raw, marshalErr := json.MarshalIndent(value, "", "  ")
		if marshalErr != nil {
			return "", fmt.Errorf("草稿文件生成失败：%w", marshalErr)
		}
		if writeErr := os.WriteFile(filepath.Join(draftDir, name), raw, 0644); writeErr != nil {
			return "", fmt.Errorf("草稿文件写入失败：%w", writeErr)
		}
	}
	return rootDir, nil
}

// sanitizeJianyingDraftName 清洗草稿名，防止路径穿越与非法字符。
func sanitizeJianyingDraftName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' || r == '\x00' {
			return '-'
		}
		return r
	}, name)
	name = strings.Trim(name, " .")
	if name == "" {
		name = "jianying-draft"
	}
	if len(name) > 64 {
		name = name[:64]
	}
	return name
}

// jianyingResolveVideoDurationUs 视频片段时长（微秒）：
// durationMs 显式指定 > FFmpeg 探测（可用时）> MP4 mvhd 解析 > 兜底 5 秒。
// 不依赖 FFmpeg：无 FFmpeg 时走 MP4 头解析，解析不出再兜底。
func jianyingResolveVideoDurationUs(ctx context.Context, item model.TimelineItem, path string) int64 {
	if item.DurationMs > 0 {
		return int64(item.DurationMs) * 1000
	}
	if status := FFmpegStatus(); status.Available {
		if output, probeErr := ProbeMedia(ctx, path); len(output) > 0 || probeErr == nil {
			if probe, parseErr := parseRenderMediaProbe(output); parseErr == nil && probe.DurationSeconds > 0 {
				return int64(probe.DurationSeconds * 1_000_000)
			}
		}
	}
	if seconds := probeMP4DurationSeconds(path); seconds > 0 {
		return int64(seconds * 1_000_000)
	}
	return jianyingFallbackVideoDurationUs
}

// probeMP4DurationSeconds 按 ISO BMFF 公开标准解析 MP4 的 moov/mvhd 得到时长（秒）。
// 仅手写 box 遍历，不依赖第三方库；非 MP4 或解析失败返回 0。
func probeMP4DurationSeconds(path string) float64 {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()
	reader := bufio.NewReaderSize(file, 64*1024)
	var findBox func(r io.Reader, limit int64, name string) ([]byte, bool)
	readBox := func(r io.Reader) (boxType string, payload []byte, ok bool) {
		var header [8]byte
		if _, err := io.ReadFull(r, header[:]); err != nil {
			return "", nil, false
		}
		size := int64(binary.BigEndian.Uint32(header[:4]))
		boxType = string(header[4:8])
		payloadSize := size - 8
		if size == 1 {
			var large [8]byte
			if _, err := io.ReadFull(r, large[:]); err != nil {
				return "", nil, false
			}
			size = int64(binary.BigEndian.Uint64(large[:]))
			payloadSize = size - 16
		} else if size == 0 {
			return boxType, nil, false // box 延伸至文件末尾，不支持
		}
		if payloadSize < 0 || payloadSize > 16*1024*1024 {
			return "", nil, false
		}
		payload = make([]byte, payloadSize)
		if _, err := io.ReadFull(r, payload); err != nil {
			return "", nil, false
		}
		return boxType, payload, true
	}
	findBox = func(r io.Reader, limit int64, name string) ([]byte, bool) {
		var consumed int64
		for limit <= 0 || consumed < limit {
			boxType, payload, ok := readBox(r)
			if !ok {
				return nil, false
			}
			consumed += int64(len(payload)) + 8
			if boxType == name {
				return payload, true
			}
		}
		return nil, false
	}
	moov, ok := findBox(reader, 0, "moov")
	if !ok {
		return 0
	}
	mvhd, ok := findBox(strings.NewReader(string(moov)), int64(len(moov)), "mvhd")
	if !ok || len(mvhd) < 4 {
		return 0
	}
	version := mvhd[0]
	body := mvhd[4:]
	if version == 1 {
		// version 1：8 字节创建时间 + 8 字节修改时间 + 4 字节 timescale + 8 字节 duration。
		if len(body) < 28 {
			return 0
		}
		timescale := binary.BigEndian.Uint32(body[16:20])
		duration := binary.BigEndian.Uint64(body[20:28])
		if timescale == 0 {
			return 0
		}
		return float64(duration) / float64(timescale)
	}
	// version 0：4 字节创建时间 + 4 字节修改时间 + 4 字节 timescale + 4 字节 duration。
	if len(body) < 20 {
		return 0
	}
	timescale := binary.BigEndian.Uint32(body[12:16])
	duration := binary.BigEndian.Uint32(body[16:20])
	if timescale == 0 {
		return 0
	}
	return float64(duration) / float64(timescale)
}

// ---- SRT 解析（纯文本解析，不依赖第三方库）----

type jianyingSrtEntry struct {
	Text    string
	StartMs int
	EndMs   int
}

var jianyingSrtTimeRegexp = regexp.MustCompile(`^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*$`)

// parseSrtEntries 解析 SRT 文本，忽略序号行，逐条返回字幕。无效条目直接跳过。
func parseSrtEntries(raw string) []jianyingSrtEntry {
	raw = strings.TrimPrefix(raw, "\uFEFF")
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	blocks := regexp.MustCompile(`\r?\n\s*\r?\n`).Split(raw, -1)
	entries := make([]jianyingSrtEntry, 0, len(blocks))
	for _, block := range blocks {
		lines := strings.Split(strings.TrimSpace(block), "\n")
		timeLineIndex := -1
		for i, line := range lines {
			if strings.Contains(line, "-->") {
				timeLineIndex = i
				break
			}
		}
		if timeLineIndex < 0 {
			continue
		}
		parts := strings.SplitN(lines[timeLineIndex], "-->", 2)
		startMs, okStart := parseSrtTimestampMs(strings.TrimSpace(parts[0]))
		if len(parts) < 2 {
			continue
		}
		endMs, okEnd := parseSrtTimestampMs(strings.TrimSpace(parts[1]))
		if !okStart || !okEnd || endMs <= startMs {
			continue
		}
		textLines := make([]string, 0, len(lines))
		for _, line := range lines[timeLineIndex+1:] {
			if trimmed := strings.TrimSpace(line); trimmed != "" {
				textLines = append(textLines, trimmed)
			}
		}
		text := strings.TrimSpace(strings.Join(textLines, "\n"))
		if text == "" {
			continue
		}
		entries = append(entries, jianyingSrtEntry{Text: text, StartMs: startMs, EndMs: endMs})
	}
	return entries
}

// parseSrtTimestampMs 支持 HH:MM:SS,mmm / MM:SS.mmm 等常见 SRT 时间戳写法。
func parseSrtTimestampMs(value string) (int, bool) {
	value = strings.TrimSpace(value)
	// 兼容 "SS.mmm" 纯秒数写法。
	if !strings.Contains(value, ":") {
		seconds, err := strconv.ParseFloat(value, 64)
		if err != nil || seconds < 0 {
			return 0, false
		}
		return int(seconds * 1000), true
	}
	match := jianyingSrtTimeRegexp.FindStringSubmatch(value)
	if match == nil {
		return 0, false
	}
	hours, _ := strconv.Atoi(match[1])
	minutes, _ := strconv.Atoi(match[2])
	seconds, _ := strconv.Atoi(match[3])
	ms, _ := strconv.Atoi(match[4])
	ms *= intPow10(3 - len(match[4]))
	return hours*3600000 + minutes*60000 + seconds*1000 + ms, true
}

func intPow10(n int) int {
	result := 1
	for i := 0; i < n; i++ {
		result *= 10
	}
	return result
}

// ---- draft JSON 组装（公开格式的最小可用子集，字段含义参见剪映公开草稿格式说明）----

func jianyingRange(startUs, durationUs int64) map[string]any {
	return map[string]any{"duration": durationUs, "start": startUs}
}

// jianyingMediaSegment 视频/音频/文本段共用结构：
// target_timerange 为时间轴位置，source_timerange 为素材内截取范围。
func jianyingMediaSegment(materialID string, sourceDurationUs, targetDurationUs, targetStartUs int64) map[string]any {
	return map[string]any{
		"cartoon":          false,
		"clip":             map[string]any{"alpha": 1.0, "flip": map[string]any{"horizontal": false, "vertical": false}, "rotation": 0.0, "scale": map[string]any{"x": 1.0, "y": 1.0}, "transform": map[string]any{"x": 0.0, "y": 0.0}},
		"common_keyframes": []any{},
		"enable_lut":       true,
		"enable_smart_mask": false,
		"extra_material_refs": []any{},
		"group_id":            "",
		"id":                  uuid.NewString(),
		"intensifies_audio":   false,
		"intensifies_video":   false,
		"is_placeholder":      false,
		"is_tone_modify":      false,
		"keyframe_refs":       []any{},
		"material_id":         materialID,
		"render_index":        0,
		"responsive_layout": map[string]any{
			"enable_landscape":   false,
			"enable_vertical":    false,
			"horizontal_pos_layout": 0,
			"size_layout":           0,
			"target_follow":         "",
			"vertical_pos_layout":   0,
		},
		"reverse":           false,
		"source_timerange":  jianyingRange(0, sourceDurationUs),
		"speed":             1.0,
		"target_timerange":  jianyingRange(targetStartUs, targetDurationUs),
		"template_id":       "",
		"template_scene":    "default",
		"uniform_scale":     1.0,
		"visible":           true,
		"volume":            1.0,
	}
}

// jianyingVideoMaterial 视频/图片素材（图片 type 为 photo）。path 使用相对草稿根目录的斜杠路径。
func jianyingVideoMaterial(id, name, path, materialType string, hasAudio bool, durationUs int64) map[string]any {
	return map[string]any{
		"audio_fading":  nil,
		"audio_url":     "",
		"category_id":   "",
		"category_name": "local",
		"check_flag":    63487,
		"crop": map[string]any{
			"lower_left_x": 0.0, "lower_left_y": 1.0,
			"lower_right_x": 1.0, "lower_right_y": 1.0,
			"upper_left_x": 0.0, "upper_left_y": 0.0,
			"upper_right_x": 1.0, "upper_right_y": 0.0,
		},
		"crop_ratio":             "free",
		"crop_scale":             "xy",
		"duration":               durationUs,
		"extra_type_option":      0,
		"formula_id":             "",
		"freeze":                 nil,
		"gameplay":               nil,
		"has_audio":              hasAudio,
		"height":                 0,
		"id":                     id,
		"intensifies_audio":      false,
		"intensifies_video":      false,
		"is_unified_beauty_mode": false,
		"local_id":               "",
		"local_material_id":      "",
		"material_id":            "",
		"material_name":          name,
		"material_url":           "",
		"matting":                map[string]any{"flag": 0},
		"media_path":             "",
		"object_locked":          nil,
		"path":                   path,
		"quality_level":          "",
		"reverse":                false,
		"roughcut_times":         nil,
		"smart_match_info":       nil,
		"stable":                 map[string]any{"matrix_path": "", "stable_level": 0, "time_range": jianyingRange(0, 0)},
		"team_id":                "",
		"type":                   materialType,
		"video_algorithm": map[string]any{
			"algorithms":               []any{},
			"complement_frame_config":  nil,
			"deflicker":                nil,
			"motion_blur_config":       nil,
			"noise_reduction":          nil,
			"path":                     "",
			"quality_enhance":          nil,
			"time_range":               nil,
		},
		"width": 0,
	}
}

// jianyingAudioMaterial 音频素材。
func jianyingAudioMaterial(id, name, path string, durationUs int64) map[string]any {
	return map[string]any{
		"app_id":                       0,
		"app_source":                   -1,
		"audio_url":                    "",
		"duration":                     durationUs,
		"effect_id":                    "",
		"formula_id":                   "",
		"id":                           id,
		"intensifies_path":             "",
		"is_ugc":                       false,
		"local_id":                     "",
		"local_material_id":            "",
		"music_id":                     "",
		"name":                         name,
		"path":                         path,
		"query":                        "",
		"request_id":                   "",
		"resource_id":                  "",
		"search_id":                    "",
		"sound_category_mappings":      []any{},
		"source":                       0,
		"source_platform":              0,
		"team_id":                      "",
		"text_id":                      "",
		"tone_category":                "",
		"tone_effect":                  "",
		"tone_platform":                "",
		"tone_second_category":         "",
		"tone_second_category_name":    "",
		"tone_speaker":                 "",
		"tone_type":                    "",
		"type":                         "local",
		"video_id":                     "",
		"wave_points":                  []any{},
	}
}

// jianyingTextMaterial 字幕文本素材（recognize_type=subtitle）。
func jianyingTextMaterial(id, content string) map[string]any {
	return map[string]any{
		"add_type":                      0,
		"alignment":                     1,
		"background_alpha":              1.0,
		"background_color":              "",
		"background_height":             0.14,
		"background_horizontal_offset":  0.0,
		"background_horizontal_scale":   1.0,
		"background_round_radius":       0.0,
		"background_style":              0,
		"background_vertical_offset":    0.004,
		"background_vertical_scale":     1.0,
		"background_width":              0.14,
		"bold_width":                    0.0,
		"border_alpha":                  1.0,
		"border_color":                  "",
		"border_width":                  0.08,
		"check_flag":                    7,
		"combo_info":                    map[string]any{"text_templates": []any{}},
		"content":                       content,
		"fixed_width":                   -1.0,
		"fixed_width_position":          1.0,
		"font_path":                     "",
		"font_resource_id":              "",
		"font_size":                     8.0,
		"font_source_platform":          0,
		"font_team_id":                  "",
		"font_title":                    "system",
		"font_url":                      "",
		"fonts":                         []any{},
		"force_apply_line_max_width":    false,
		"global_alpha":                  1.0,
		"group_id":                      "",
		"has_shadow":                    true,
		"id":                            id,
		"initial_scale":                 1.0,
		"inner_padding":                 -1.0,
		"is_rich_text":                  false,
		"italic_degree":                 0,
		"ktv_color":                     "",
		"language":                      "",
		"layer_weight":                  1,
		"letter_spacing":                0.0,
		"line_feed":                     1,
		"line_max_width":                0.82,
		"line_spacing":                  0.02,
		"name":                          "",
		"original_size_last_updated_time": 0,
		"preset_category":               "",
		"preset_category_id":            "",
		"preset_has_set_alignment":      false,
		"preset_id":                     "",
		"preset_index":                  0,
		"preset_name":                   "",
		"recognize_task_id":             "",
		"recognize_type":                "subtitle",
		"relevance_segment":             []any{},
		"shadow_alpha":                  0.9,
		"shadow_angle":                  -45.0,
		"shadow_color":                  "",
		"shadow_distance":               5.0,
		"shadow_point":                  map[string]any{"x": 0.6363961030678928, "y": -0.6363961030678928},
		"shadow_smoothing":              0.45,
		"shape_clip_x":                  false,
		"shape_width":                   0.14,
		"skew_degree":                   0,
		"subtitle":                      true,
		"subtitle_template":             "",
		"text_alpha":                    1.0,
		"text_color":                    "#FFFFFF",
		"text_curve":                    nil,
		"text_preset_resource_id":       "",
		"text_special_case":             "",
		"text_to_audio_ids":             []any{},
		"text_tracking":                 "",
		"tts_auto_update":               false,
		"type":                          "subtitle",
		"typesetting":                   0,
		"underline":                     false,
		"underline_offset":              0.22,
		"underline_width":               0.05,
		"use_effect_default_color":      true,
		"words":                         map[string]any{"end_time": []any{}, "start_time": []any{}, "text": []any{}, "time": []any{}},
	}
}

// jianyingTrack 组装一条轨道。
func jianyingTrack(trackType string, segments []any) map[string]any {
	return map[string]any{
		"attribute":       0,
		"flag":            0,
		"id":              uuid.NewString(),
		"is_default_name": true,
		"name":            "",
		"segments":        segments,
		"type":            trackType,
	}
}

// jianyingEmptyMaterials materials 对象的空集合骨架（公开格式中的常见键）。
func jianyingEmptyMaterials() map[string]any {
	materials := map[string]any{}
	for _, key := range []string{
		"audios", "canvases", "color_curves", "crops", "digital_humans", "drafts",
		"effects", "filters", "green_screens", "handwrites", "hsls", "images",
		"log_color_wheels", "manual_deformations", "masks", "material_animations",
		"material_colors", "multi_language_refs", "placeholders", "plugin_effects",
		"primary_color_wheels", "realtimes", "shapes", "smart_crops", "smart_relumins",
		"sound_channel_mappings", "speeds", "stickers", "tails", "text_templates",
		"texts", "time_marks", "transitions", "video_effects", "video_trackings",
		"videos", "vocal_beautifuls", "vocal_separations",
	} {
		materials[key] = []any{}
	}
	return materials
}

// jianyingDraftContent 组装 draft_content.json 最小子集。
func jianyingDraftContent(draftID string, spec model.TimelineSpec, videoMaterials, audioMaterials, textMaterials, videoSegments, audioSegments, textSegments []any, totalDurationUs int64, nowUnix int64) map[string]any {
	materials := jianyingEmptyMaterials()
	materials["videos"] = videoMaterials
	materials["audios"] = audioMaterials
	materials["texts"] = textMaterials
	materials["canvases"] = []any{
		map[string]any{
			"album_image":       "",
			"color":             "#000000FF",
			"form":              "canvas_color",
			"height":            spec.Height,
			"id":                uuid.NewString(),
			"image":             "",
			"image_id":          "",
			"image_name":        "",
			"source_platform":   0,
			"team_id":           "",
			"type":              "canvas_color",
			"width":             spec.Width,
		},
	}

	tracks := []any{jianyingTrack("video", videoSegments)}
	if len(audioSegments) > 0 {
		tracks = append(tracks, jianyingTrack("audio", audioSegments))
	}
	if len(textSegments) > 0 {
		tracks = append(tracks, jianyingTrack("text", textSegments))
	}

	// platform 字段仅作占位，取公开格式中已知的桌面端示例值。
	platform := map[string]any{
		"app_id":      3704,
		"app_source":  "win",
		"app_version": "5.9.0",
		"device_id":   "",
		"harddisk_id": "",
		"mac_address": "",
		"os":          "windows",
	}

	return map[string]any{
		"canvas_config": map[string]any{
			"height": spec.Height,
			"ratio":  "original",
			"width":  spec.Width,
		},
		"color_space": 0,
		"config": map[string]any{
			"adjust_max_index":            1,
			"attachment_info":             []any{},
			"combination_max_index":       1,
			"export_range":                nil,
			"extract_audio_last_index":    1,
			"lyrics_recognition_id":       "",
			"lyrics_sync":                 false,
			"lyrics_videoinfo":            []any{},
			"maintrack_adsorb":            true,
			"material_save_mode":          0,
			"mirror":                      false,
			"multi_language_current":      "none",
			"multi_language_list":         []any{},
			"multi_language_main":         "none",
			"multi_language_mode":         "none",
			"multi_language_mode_config":  map[string]any{},
			"original_sound_last_index":   1,
			"record_audio":                false,
			"sticker_max_index":           1,
			"subtitle_recognition_id":     "",
			"subtitle_sync":               true,
			"subtitle_taskid":             "",
			"subtitle_translation_id":     "",
			"subtitle_translation_language": "",
			"subtitle_translation_language_model": "",
			"system_font_list":            []any{},
			"video_mute":                  false,
			"zoom_info_params":            nil,
		},
		"cover":                       nil,
		"create_time":                 nowUnix,
		"duration":                    totalDurationUs,
		"extra_info":                  "",
		"fps":                         float64(spec.FPS),
		"free_render_index_mode_on":   false,
		"group_container":             nil,
		"id":                          draftID,
		"keyframe_graph_list":         []any{},
		"keyframes": map[string]any{
			"adjusts":   []any{},
			"audios":    []any{},
			"effects":   []any{},
			"filters":   []any{},
			"handwrites": []any{},
			"stickers":  []any{},
			"texts":     []any{},
			"videos":    []any{},
		},
		"last_modified_platform":      platform,
		"materials":                   materials,
		"mutable_config":              nil,
		"name":                        "",
		"new_version":                 "",
		"platform":                    platform,
		"relationships":               []any{},
		"render_index_track_mode_on":  false,
		"retouch_cover":               nil,
		"source":                      "default",
		"static_cover_image_path":     "",
		"tracks":                      tracks,
		"version":                     jianyingDraftContentVersion,
	}
}

// jianyingDraftMetaInfo 组装 draft_meta_info.json。
func jianyingDraftMetaInfo(draftID, draftName string, totalDurationUs, nowUnix int64) map[string]any {
	return map[string]any{
		"draft_cloud_materials_purchase_info": []any{},
		"draft_cloud_purchase_info":           "",
		"draft_cloud_template_id":             "",
		"draft_cloud_tutorial_info":           "",
		"draft_cloud_videocut_purchase_info":  "",
		"draft_cooperation_info":              []any{},
		"draft_fold_path":                     "",
		"draft_id":                            draftID,
		"draft_is_ai_packaging_used":          false,
		"draft_is_ai_translate_used":          false,
		"draft_is_article_video_draft":        false,
		"draft_is_from_deeplink":              "false",
		"draft_is_invisible":                  false,
		"draft_materials":                     []any{},
		"draft_materials_copied_info":         []any{},
		"draft_name":                          draftName,
		"draft_new_version":                   "",
		"draft_removable_storage_device":      "",
		"draft_root_path":                     "",
		"draft_segment_backup_path":           "",
		"draft_timeline_materials_size_":      0,
		"draft_type":                          "",
		"tm_draft_cloud_completed":            "",
		"tm_draft_cloud_modified":             0,
		"tm_draft_create":                     strconv.FormatInt(nowUnix, 10),
		"tm_draft_modified":                   nowUnix,
		"tm_draft_removed":                    0,
		"tm_duration":                         totalDurationUs,
	}
}

// jianyingDraftInfo 组装 draft_info.json（当前剪映版本打开草稿所需的最简信息）。
func jianyingDraftInfo(draftID, draftName string, totalDurationUs, nowUnix int64) map[string]any {
	meta := jianyingDraftMetaInfo(draftID, draftName, totalDurationUs, nowUnix)
	meta["tm_draft_create"] = nowUnix
	meta["draft_cloud_purchase_info"] = ""
	meta["draft_cover"] = ""
	meta["draft_deeplink_info"] = nil
	meta["draft_enterprise_info"] = map[string]any{
		"draft_enterprise_extra":           "",
		"draft_enterprise_id":              "",
		"draft_enterprise_name":            "",
		"enterprise_material":              []any{},
		"tm_draft_enterprise_modified":     0,
		"tm_enterprise_material_added":     0,
		"verified":                         false,
	}
	meta["draft_is_invisible"] = false
	return meta
}

func max64(values ...int64) int64 {
	result := int64(0)
	for _, value := range values {
		if value > result {
			result = value
		}
	}
	return result
}
