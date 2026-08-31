package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const renderJobRootDir = "data/render-jobs"
const renderInterruptedMessage = "服务重启，任务中断，可重新提交"

// 任务级超时与单素材下载上限，避免任务挂死和磁盘被恶意素材占满。
const renderTaskTimeout = 2 * time.Hour
const renderItemDownloadLimit = int64(2) * 1024 * 1024 * 1024

// 进度阶段：下载 0-10%，探测 10-20%，编码 20-90%，收尾 90-100%。
var (
	renderExecutorOnce sync.Once
	renderQueue        chan string
	renderSemaphore    = make(chan struct{}, 1) // 有界执行器：并发 1
)

// 执行中任务 ID → context 取消函数，删除进行中任务时先取消，避免执行器把已删除任务写回。
var (
	renderRunningMu      sync.Mutex
	renderRunningCancels = map[string]context.CancelFunc{}
)

func registerRenderRunning(id string, cancel context.CancelFunc) {
	renderRunningMu.Lock()
	defer renderRunningMu.Unlock()
	renderRunningCancels[id] = cancel
}

func unregisterRenderRunning(id string) {
	renderRunningMu.Lock()
	defer renderRunningMu.Unlock()
	delete(renderRunningCancels, id)
}

func cancelRenderRunning(id string) {
	renderRunningMu.Lock()
	cancel := renderRunningCancels[id]
	renderRunningMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// StartRenderExecutor 启动渲染任务执行器，并把重启前残留的执行中任务置为失败。
func StartRenderExecutor() {
	renderExecutorOnce.Do(func() {
		if err := repository.FailInterruptedRenderTasks(renderInterruptedMessage, now()); err != nil {
			log.Printf("reset interrupted render tasks failed err=%v", err)
		}
		renderQueue = make(chan string, 100)
		go runRenderExecutor()
	})
}

func runRenderExecutor() {
	for taskID := range renderQueue {
		renderSemaphore <- struct{}{}
		go func(id string) {
			defer func() { <-renderSemaphore }()
			executeRenderTask(id)
		}(taskID)
	}
}

// CreateRenderTask 校验时间轴并创建渲染任务，随后入队执行。
func CreateRenderTask(userID string, spec model.TimelineSpec) (model.RenderTask, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return model.RenderTask{}, safeMessageError{message: "请先登录"}
	}
	if err := normalizeTimelineSpec(&spec); err != nil {
		return model.RenderTask{}, err
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		return model.RenderTask{}, safeMessageError{message: "时间轴配置序列化失败"}
	}
	current := now()
	task := model.RenderTask{
		ID:           "render-" + uuid.NewString(),
		UserID:       userID,
		Status:       "queued",
		TimelineJSON: string(raw),
		Size:         fmt.Sprintf("%dx%d", spec.Width, spec.Height),
		CreatedAt:    current,
		UpdatedAt:    current,
	}
	saved, err := repository.SaveRenderTask(task)
	if err != nil {
		return saved, err
	}
	if renderQueue == nil {
		failRenderTask(&saved, errors.New("渲染服务未启动，请稍后重试"))
		return saved, safeMessageError{message: "渲染服务未启动，请稍后重试"}
	}
	select {
	case renderQueue <- saved.ID:
	default:
		failRenderTask(&saved, errors.New("渲染队列已满，请稍后重试"))
		return saved, safeMessageError{message: "渲染队列已满，请稍后重试"}
	}
	return saved, nil
}

// GetUserRenderTask 查询当前用户的渲染任务。
func GetUserRenderTask(userID string, id string) (model.RenderTask, bool, error) {
	return repository.GetUserRenderTask(strings.TrimSpace(userID), strings.TrimSpace(id))
}

// ListUserRenderTasks 查询当前用户的渲染任务列表。
func ListUserRenderTasks(userID string, limit int) ([]map[string]any, error) {
	tasks, err := repository.ListUserRenderTasks(strings.TrimSpace(userID), limit)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		result = append(result, RenderTaskResponse(task))
	}
	return result, nil
}

// DeleteUserRenderTask 删除当前用户的渲染任务记录；
// 进行中任务先取消执行，执行器后续写库为条件更新，不会把已删除任务复活。
func DeleteUserRenderTask(userID string, id string) error {
	id = strings.TrimSpace(id)
	cancelRenderRunning(id)
	return repository.DeleteUserRenderTask(strings.TrimSpace(userID), id)
}

// RenderTaskResponse 渲染任务响应，形状对齐 VideoTaskResponse 便于前端复用轮询逻辑。
func RenderTaskResponse(task model.RenderTask) map[string]any {
	result := map[string]any{
		"id":           task.ID,
		"object":       "render",
		"status":       task.Status,
		"progress":     task.Progress,
		"seconds":      task.Seconds,
		"size":         task.Size,
		"fileId":       task.OutputFileID,
		"created_at":   task.CreatedAt,
		"updated_at":   task.UpdatedAt,
		"started_at":   task.StartedAt,
		"completed_at": task.CompletedAt,
		"createdAt":    task.CreatedAt,
		"updatedAt":    task.UpdatedAt,
	}
	if task.OutputFileID != "" {
		contentURL := "/api/files/" + task.OutputFileID + "/content"
		result["url"] = contentURL
		result["video_url"] = contentURL
		result["data"] = []map[string]any{{"url": contentURL}}
	} else if strings.TrimSpace(task.LocalPath) != "" {
		outputURL := "/api/v1/render/tasks/" + task.ID + "/output"
		result["url"] = outputURL
		result["video_url"] = outputURL
		result["data"] = []map[string]any{{"url": outputURL}}
		result["localPath"] = task.LocalPath
	}
	if task.Status == "failed" {
		// ErrorDetail 可能含服务端路径等敏感信息，仅落库，不下发给客户端。
		message := strings.TrimSpace(task.Error)
		if message == "" {
			message = "渲染失败，请稍后重试"
		}
		result["error"] = map[string]any{"message": message}
	}
	return result
}

func normalizeTimelineSpec(spec *model.TimelineSpec) error {
	if len(spec.Items) == 0 {
		return safeMessageError{message: "请至少选择一个素材"}
	}
	if len(spec.Items) > 100 {
		return safeMessageError{message: "单次成片素材不能超过 100 个"}
	}
	if spec.FPS <= 0 || spec.FPS > 120 {
		spec.FPS = 30
	}
	if spec.Width <= 0 || spec.Width > 3840 {
		spec.Width = 1280
	}
	if spec.Height <= 0 || spec.Height > 3840 {
		spec.Height = 720
	}
	spec.Width -= spec.Width % 2
	spec.Height -= spec.Height % 2
	for i := range spec.Items {
		item := &spec.Items[i]
		item.Kind = strings.ToLower(strings.TrimSpace(item.Kind))
		item.Source = strings.TrimSpace(item.Source)
		switch item.Kind {
		case model.RenderItemKindVideo, model.RenderItemKindImage, model.RenderItemKindAudio:
		default:
			return safeMessageError{message: fmt.Sprintf("第 %d 个素材类型无效", i+1)}
		}
		if item.Source == "" {
			return safeMessageError{message: fmt.Sprintf("第 %d 个素材缺少来源", i+1)}
		}
		if item.Kind != model.RenderItemKindVideo && item.DurationMs <= 0 {
			return safeMessageError{message: fmt.Sprintf("第 %d 个素材需要填写展示时长", i+1)}
		}
		if item.DurationMs > 3600000 {
			return safeMessageError{message: fmt.Sprintf("第 %d 个素材展示时长过长", i+1)}
		}
	}
	return nil
}

func executeRenderTask(taskID string) {
	task, found, err := repository.GetRenderTask(taskID)
	if err != nil {
		log.Printf("load render task failed id=%s err=%v", taskID, err)
		return
	}
	if !found || task.Status != "queued" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), renderTaskTimeout)
	defer cancel()
	registerRenderRunning(taskID, cancel)
	defer unregisterRenderRunning(taskID)
	jobDir := filepath.Join(renderJobRootDir, task.ID)
	defer os.RemoveAll(jobDir)

	if status := FFmpegStatus(); !status.Available {
		failRenderTask(&task, errors.New(status.Reason))
		return
	}
	var spec model.TimelineSpec
	if err := json.Unmarshal([]byte(task.TimelineJSON), &spec); err != nil || len(spec.Items) == 0 {
		failRenderTask(&task, errors.New("时间轴配置解析失败"))
		return
	}
	task.StartedAt = now()
	if !saveRenderProgress(&task, "preparing", 2) {
		return
	}

	// 阶段一：流式下载素材到临时目录。
	downloaded := make([]string, len(spec.Items))
	for i, item := range spec.Items {
		if ctx.Err() != nil {
			failRenderTask(&task, ctx.Err())
			return
		}
		path, err := downloadRenderItem(ctx, item.Source, jobDir, i)
		if err != nil {
			failRenderTask(&task, fmt.Errorf("第 %d 个素材下载失败：%w", i+1, err))
			return
		}
		downloaded[i] = path
		if !saveRenderProgress(&task, "preparing", 2+8*(i+1)/len(spec.Items)) {
			return
		}
	}

	// 阶段二：探测各段媒体信息。
	probes := make([]renderMediaProbe, len(spec.Items))
	totalSeconds := 0.0
	for i, path := range downloaded {
		output, probeErr := ProbeMedia(ctx, path)
		if len(output) == 0 && probeErr != nil {
			failRenderTask(&task, fmt.Errorf("第 %d 个素材探测失败：%v", i+1, safeErrorMessage(probeErr)))
			return
		}
		probe, err := parseRenderMediaProbe(output)
		if err != nil {
			failRenderTask(&task, fmt.Errorf("第 %d 个素材无法识别媒体信息", i+1))
			return
		}
		probes[i] = probe
		duration := plannedRenderItemSeconds(spec.Items[i], probe)
		if duration <= 0 {
			failRenderTask(&task, fmt.Errorf("第 %d 个素材无法确定时长", i+1))
			return
		}
		totalSeconds += duration
	}
	if !saveRenderProgress(&task, "rendering", 20) {
		return
	}

	// 阶段三：编码/合并。同参数素材走 concat demuxer 免重编码，否则统一重编码归一化。
	workOutput := filepath.Join(jobDir, "rendered.mp4")
	lastProgressAt := time.Now()
	reportEncode := func(value float64) {
		overall := int(value)
		if overall > 89 {
			overall = 89
		}
		if overall <= task.Progress || overall-task.Progress < 1 || time.Since(lastProgressAt) < time.Second {
			return
		}
		lastProgressAt = time.Now()
		saveRenderProgress(&task, "rendering", overall)
	}
	if renderCanCopy(spec, probes) {
		listPath := filepath.Join(jobDir, "concat.txt")
		if err := writeRenderConcatList(listPath, downloaded); err != nil {
			failRenderTask(&task, err)
			return
		}
		if _, err := ConcatClips(ctx, listPath, workOutput); err != nil {
			failRenderTask(&task, fmt.Errorf("素材合并失败：%w", err))
			return
		}
	} else {
		segments := make([]string, 0, len(spec.Items))
		offsetSeconds := 0.0
		for i := range spec.Items {
			if ctx.Err() != nil {
				failRenderTask(&task, ctx.Err())
				return
			}
			segmentPath := filepath.Join(jobDir, fmt.Sprintf("segment-%03d.mp4", i))
			duration := plannedRenderItemSeconds(spec.Items[i], probes[i])
			err := encodeRenderSegment(ctx, spec, spec.Items[i].Kind, downloaded[i], probes[i], duration, totalSeconds, offsetSeconds, segmentPath, reportEncode)
			if err != nil {
				failRenderTask(&task, fmt.Errorf("第 %d 个素材编码失败：%w", i+1, err))
				return
			}
			offsetSeconds += duration
			segments = append(segments, segmentPath)
		}
		listPath := filepath.Join(jobDir, "concat.txt")
		if err := writeRenderConcatList(listPath, segments); err != nil {
			failRenderTask(&task, err)
			return
		}
		if _, err := ConcatClips(ctx, listPath, workOutput); err != nil {
			failRenderTask(&task, fmt.Errorf("片段合并失败：%w", err))
			return
		}
	}
	if !saveRenderProgress(&task, "rendering", 90) {
		return
	}

	// 阶段四：可选烧字幕。
	finalOutput := workOutput
	if strings.TrimSpace(spec.Srt) != "" && spec.BurnSubtitle {
		srtPath := filepath.Join(jobDir, "subtitle.srt")
		if err := os.WriteFile(srtPath, []byte(spec.Srt), 0644); err != nil {
			failRenderTask(&task, fmt.Errorf("字幕写入失败：%w", err))
			return
		}
		subtitled := filepath.Join(jobDir, "subtitled.mp4")
		if _, err := BurnSubtitles(ctx, workOutput, srtPath, subtitled, "", ""); err != nil {
			failRenderTask(&task, fmt.Errorf("字幕烧录失败：%w", err))
			return
		}
		finalOutput = subtitled
	}

	// 阶段五：保存成片。优先注册进对象存储（/api/files/:id/content 可访问）；
	// 未配置对象存储时落到本地磁盘 <LOCAL_MEDIA_DIR>/<项目名>/，按项目分文件夹。
	outputFile, err := os.Open(finalOutput)
	if err != nil {
		failRenderTask(&task, fmt.Errorf("成片读取失败：%w", err))
		return
	}
	fileInfo, err := outputFile.Stat()
	if err != nil {
		outputFile.Close()
		failRenderTask(&task, fmt.Errorf("成片读取失败：%w", err))
		return
	}
	user, found, err := repository.GetUserByID(task.UserID)
	if err != nil || !found {
		outputFile.Close()
		failRenderTask(&task, errors.New("用户不存在，无法保存成片"))
		return
	}
	userCtx := WithUser(context.Background(), model.AuthUser{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, Role: user.Role})
	uploaded, uploadErr := UploadStorageObjectStream(userCtx, "render-"+task.ID+".mp4", "video/mp4", outputFile, fileInfo.Size())
	outputFile.Close()
	if uploadErr == nil {
		task.OutputFileID = uploaded.ID
	} else {
		log.Printf("render output object storage unavailable, save to local disk id=%s err=%v", task.ID, uploadErr)
		savedPath, saveErr := saveRenderOutputLocally(finalOutput, spec.Folder)
		if saveErr != nil {
			failRenderTask(&task, fmt.Errorf("成片保存失败：%w", saveErr))
			return
		}
		task.LocalPath = savedPath
	}

	current := now()
	task.Status = "completed"
	task.Progress = 100
	task.Seconds = strconv.FormatFloat(totalSeconds, 'f', 1, 64)
	task.CompletedAt = current
	task.UpdatedAt = current
	if affected, err := repository.UpdateRenderTask(task); err != nil {
		log.Printf("save render task failed id=%s err=%v", task.ID, err)
	} else if affected == 0 {
		log.Printf("render task deleted before completion, discard result id=%s", task.ID)
	}
}

// localMediaBaseDir 本地媒体根目录（默认 D:/InfiniteCanvas），成片与暂存素材都落到磁盘可见目录。
func localMediaBaseDir() string {
	dir := strings.TrimSpace(config.Cfg.LocalMediaDir)
	if dir == "" {
		dir = "D:/InfiniteCanvas"
	}
	return dir
}

// sanitizeFolderName 把项目名转成安全的文件夹名。
func sanitizeFolderName(name string) string {
	name = strings.TrimSpace(name)
	re := regexp.MustCompile(`[\\/:*?"<>|]+`)
	name = strings.TrimSpace(re.ReplaceAllString(name, "_"))
	if name == "" {
		name = "未命名项目"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	return name
}

// copyLocalFile 复制本地文件（渲染素材 file: 来源用）。
func copyLocalFile(src string, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// StageLocalRenderMedia 把前端上传的本地媒体暂存到 <根目录>/<项目名>/media/，返回 file: 来源供渲染读取。
func StageLocalRenderMedia(folder string, filename string, contentType string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("素材为空")
	}
	if int64(len(data)) > renderItemDownloadLimit {
		return "", errors.New("素材过大")
	}
	dir := filepath.Join(localMediaBaseDir(), sanitizeFolderName(folder), "media")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		ext = renderExtForMimeType(contentType)
	}
	if ext == "" {
		ext = ".bin"
	}
	target := filepath.Join(dir, uuid.NewString()+ext)
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return "", err
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		abs = target
	}
	return "file:" + abs, nil
}

// saveRenderOutputLocally 把成片保存到 <根目录>/<项目名>/ 下的本地文件，返回绝对路径。
func saveRenderOutputLocally(finalOutput string, folder string) (string, error) {
	dir := filepath.Join(localMediaBaseDir(), sanitizeFolderName(folder))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := fmt.Sprintf("%s-%s.mp4", sanitizeFolderName(folder), time.Now().Format("20060102-150405"))
	target := filepath.Join(dir, name)
	src, err := os.Open(finalOutput)
	if err != nil {
		return "", err
	}
	defer src.Close()
	dst, err := os.Create(target)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return "", err
	}
	if err := dst.Close(); err != nil {
		return "", err
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		abs = target
	}
	return abs, nil
}

// RenderOutputLocalPath 返回成片在本机的保存路径（本地保存模式），供流式下发。
func RenderOutputLocalPath(taskID string) (string, error) {
	task, found, err := repository.GetRenderTask(strings.TrimSpace(taskID))
	if err != nil {
		return "", err
	}
	if !found {
		return "", errors.New("渲染任务不存在")
	}
	if strings.TrimSpace(task.LocalPath) == "" {
		return "", errors.New("该成片没有本地文件")
	}
	return task.LocalPath, nil
}

// downloadRenderItem 流式下载素材到临时目录：存储对象走 storage 服务，http(s) 外链先过 SSRF 校验。
func downloadRenderItem(ctx context.Context, source string, jobDir string, index int) (string, error) {
	if err := os.MkdirAll(jobDir, 0755); err != nil {
		return "", err
	}
	if strings.HasPrefix(source, "file:") {
		src := strings.TrimSpace(strings.TrimPrefix(source, "file:"))
		if src == "" {
			return "", errors.New("本地素材路径无效")
		}
		info, err := os.Stat(src)
		if err != nil || info.IsDir() {
			return "", errors.New("本地素材不存在")
		}
		if info.Size() > renderItemDownloadLimit {
			return "", errors.New("本地素材过大")
		}
		dest := filepath.Join(jobDir, fmt.Sprintf("item-%03d%s", index, renderExtFromPath(src)))
		if err := copyLocalFile(src, dest); err != nil {
			return "", err
		}
		return dest, nil
	}
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		parsed, err := url.Parse(source)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return "", errors.New("素材链接无效")
		}
		dest := filepath.Join(jobDir, fmt.Sprintf("item-%03d%s", index, renderExtFromPath(parsed.Path)))
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
		if err != nil {
			return "", err
		}
		// SafeProxyHTTPClient 的拨号层拦截本地/内网地址。
		response, err := SafeProxyHTTPClient().Do(request)
		if err != nil {
			return "", err
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return "", fmt.Errorf("素材下载失败：%s", response.Status)
		}
		if err := renderCopyToFile(dest, response.Body); err != nil {
			return "", err
		}
		return dest, nil
	}
	fileID := strings.TrimPrefix(strings.TrimSpace(source), "server:")
	if fileID == "" {
		return "", errors.New("素材来源无效")
	}
	download, err := DownloadStorageObject(fileID, "")
	if err != nil {
		return "", fmt.Errorf("存储文件读取失败：%w", err)
	}
	defer download.Stream.Close()
	ext := renderExtForMimeType(download.Object.MimeType)
	if ext == "" {
		ext = renderExtFromPath(download.Object.ObjectKey)
	}
	dest := filepath.Join(jobDir, fmt.Sprintf("item-%03d%s", index, ext))
	if err := renderCopyToFile(dest, download.Stream); err != nil {
		return "", err
	}
	return dest, nil
}

// renderCopyToFile 流式写盘并限制单素材大小上限，超限返回中文错误。
func renderCopyToFile(dest string, stream io.Reader) error {
	file, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer file.Close()
	written, err := io.Copy(file, io.LimitReader(stream, renderItemDownloadLimit+1))
	if err != nil {
		return err
	}
	if written > renderItemDownloadLimit {
		return safeMessageError{message: "素材文件超过大小上限（2GB）"}
	}
	return nil
}

func renderExtFromPath(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".mp4", ".mov", ".webm", ".mkv", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".png", ".jpg", ".jpeg", ".webp":
		return ext
	default:
		return ".bin"
	}
}

func renderExtForMimeType(mimeType string) string {
	switch strings.ToLower(strings.Split(mimeType, ";")[0]) {
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	case "video/x-matroska":
		return ".mkv"
	case "audio/mpeg":
		return ".mp3"
	case "audio/mp4", "audio/x-m4a":
		return ".m4a"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return ".wav"
	case "audio/aac":
		return ".aac"
	case "audio/ogg":
		return ".ogg"
	case "audio/flac":
		return ".flac"
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

// renderMediaProbe 媒体探测结果。
type renderMediaProbe struct {
	DurationSeconds float64
	Width           int
	Height          int
	FPS             float64
	VideoCodec      string
	AudioCodec      string
	HasAudio        bool
}

var (
	renderDurationRegexp    = regexp.MustCompile(`Duration:\s*(\d+):(\d+):([0-9.]+)`)
	renderVideoStreamRegexp = regexp.MustCompile(`Stream #\d+[:.]\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: (\w+)[^\n]*?(\d{2,5})x(\d{2,5})`)
	renderFPSRegexp         = regexp.MustCompile(`([0-9.]+)\s*fps`)
	renderAudioStreamRegexp = regexp.MustCompile(`Stream #\d+[:.]\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio: (\w+)`)
)

// parseRenderMediaProbe 同时支持 ffprobe JSON 输出与 ffmpeg -i 文本输出。
func parseRenderMediaProbe(output []byte) (renderMediaProbe, error) {
	var probe renderMediaProbe
	var parsed struct {
		Streams []struct {
			CodecType    string `json:"codec_type"`
			CodecName    string `json:"codec_name"`
			Width        int    `json:"width"`
			Height       int    `json:"height"`
			AvgFrameRate string `json:"avg_frame_rate"`
			Duration     string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(output, &parsed) == nil && len(parsed.Streams) > 0 {
		for _, stream := range parsed.Streams {
			switch stream.CodecType {
			case "video":
				// 跳过封面图等无尺寸附挂流。
				if probe.VideoCodec == "" && stream.Width > 0 {
					probe.VideoCodec = stream.CodecName
					probe.Width = stream.Width
					probe.Height = stream.Height
					probe.FPS = parseRenderFraction(stream.AvgFrameRate)
				}
			case "audio":
				probe.HasAudio = true
				if probe.AudioCodec == "" {
					probe.AudioCodec = stream.CodecName
				}
			}
			if probe.DurationSeconds == 0 {
				if value, err := strconv.ParseFloat(strings.TrimSpace(stream.Duration), 64); err == nil {
					probe.DurationSeconds = value
				}
			}
		}
		if value, err := strconv.ParseFloat(strings.TrimSpace(parsed.Format.Duration), 64); err == nil && value > 0 {
			probe.DurationSeconds = value
		}
		return probe, nil
	}
	text := string(output)
	if !strings.Contains(text, "Duration:") && !strings.Contains(text, "Stream #") {
		return probe, errors.New("无法识别媒体信息")
	}
	if match := renderDurationRegexp.FindStringSubmatch(text); match != nil {
		hours, _ := strconv.ParseFloat(match[1], 64)
		minutes, _ := strconv.ParseFloat(match[2], 64)
		seconds, _ := strconv.ParseFloat(match[3], 64)
		probe.DurationSeconds = hours*3600 + minutes*60 + seconds
	}
	if match := renderVideoStreamRegexp.FindStringSubmatch(text); match != nil {
		probe.VideoCodec = match[1]
		probe.Width, _ = strconv.Atoi(match[2])
		probe.Height, _ = strconv.Atoi(match[3])
	}
	if match := renderFPSRegexp.FindStringSubmatch(text); match != nil {
		probe.FPS, _ = strconv.ParseFloat(match[1], 64)
	}
	if match := renderAudioStreamRegexp.FindStringSubmatch(text); match != nil {
		probe.HasAudio = true
		probe.AudioCodec = match[1]
	}
	return probe, nil
}

func parseRenderFraction(value string) float64 {
	parts := strings.SplitN(strings.TrimSpace(value), "/", 2)
	if len(parts) == 0 {
		return 0
	}
	numerator, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	if err != nil {
		return 0
	}
	if len(parts) == 1 {
		return numerator
	}
	denominator, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err != nil || denominator == 0 {
		return 0
	}
	return numerator / denominator
}

// plannedRenderItemSeconds 计算单段计划时长：视频用探测时长（可被 durationMs 覆盖/裁剪），图片/音频用 durationMs。
// 视频显式 durationMs 超过实际时长时按实际时长夹取，保证输出时长与任务报告一致。
func plannedRenderItemSeconds(item model.TimelineItem, probe renderMediaProbe) float64 {
	if item.Kind == model.RenderItemKindVideo {
		if item.DurationMs > 0 {
			requested := float64(item.DurationMs) / 1000
			if probe.DurationSeconds > 0 && requested > probe.DurationSeconds {
				return probe.DurationSeconds
			}
			return requested
		}
		return probe.DurationSeconds
	}
	return float64(item.DurationMs) / 1000
}

// renderCanCopy 判断是否全部素材可直接走 concat demuxer 免重编码。
func renderCanCopy(spec model.TimelineSpec, probes []renderMediaProbe) bool {
	hasAudio := probes[0].HasAudio
	for i, item := range spec.Items {
		if item.Kind != model.RenderItemKindVideo {
			return false
		}
		// 显式时长需要 -t 裁剪，免重编码路径无法精确裁剪，强制重编码。
		if item.DurationMs > 0 {
			return false
		}
		probe := probes[i]
		if probe.VideoCodec != "h264" || probe.Width != spec.Width || probe.Height != spec.Height {
			return false
		}
		if probe.FPS > 0 && math.Abs(probe.FPS-float64(spec.FPS)) > 0.6 {
			return false
		}
		if probe.HasAudio != hasAudio {
			return false
		}
		if probe.HasAudio && probe.AudioCodec != "aac" {
			return false
		}
	}
	return true
}

func renderNormalizeFilter(spec model.TimelineSpec) string {
	return fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=%d",
		spec.Width, spec.Height, spec.Width, spec.Height, spec.FPS)
}

// encodeRenderSegment 将单个素材重编码为统一参数的视频片段。
// 图片按时长转视频段；音频段生成黑底画面混入音轨；缺失音轨补静音，保证片段参数一致可无损拼接。
func encodeRenderSegment(ctx context.Context, spec model.TimelineSpec, kind string, inputPath string, probe renderMediaProbe, durationSeconds float64, totalSeconds float64, offsetSeconds float64, outputPath string, onProgress func(float64)) error {
	duration := strconv.FormatFloat(durationSeconds, 'f', 3, 64)
	var args []string
	switch kind {
	case model.RenderItemKindImage:
		args = []string{
			"-y", "-loop", "1", "-t", duration, "-i", inputPath,
			"-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
			"-vf", renderNormalizeFilter(spec),
			"-map", "0:v:0", "-map", "1:a:0",
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
			"-c:a", "aac", "-ar", "44100", "-ac", "2",
			"-t", duration, "-shortest", outputPath,
		}
	case model.RenderItemKindAudio:
		args = []string{
			"-y",
			"-f", "lavfi", "-i", fmt.Sprintf("color=c=black:s=%dx%d:r=%d", spec.Width, spec.Height, spec.FPS),
			"-i", inputPath,
			"-map", "0:v:0", "-map", "1:a:0", "-af", "apad",
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
			"-c:a", "aac", "-ar", "44100", "-ac", "2",
			"-t", duration, "-shortest", outputPath,
		}
	default:
		args = []string{"-y", "-i", inputPath}
		if probe.HasAudio {
			args = append(args, "-vf", renderNormalizeFilter(spec), "-map", "0:v:0", "-map", "0:a:0")
		} else {
			args = append(args, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
				"-vf", renderNormalizeFilter(spec), "-map", "0:v:0", "-map", "1:a:0", "-shortest")
		}
		args = append(args,
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
			"-c:a", "aac", "-ar", "44100", "-ac", "2",
			// durationMs 裁剪：保证输出时长与计划时长一致。
			"-t", duration, outputPath)
	}
	_, err := runRenderFFmpegWithProgress(ctx, args, durationSeconds, func(fraction float64) {
		if onProgress != nil && totalSeconds > 0 {
			onProgress(20 + 70*(offsetSeconds+fraction*durationSeconds)/totalSeconds)
		}
	})
	return err
}

// runRenderFFmpegWithProgress 执行 FFmpeg 并通过 -progress 输出解析进度。
func runRenderFFmpegWithProgress(ctx context.Context, args []string, durationSeconds float64, onProgress func(float64)) ([]byte, error) {
	status := FFmpegStatus()
	if !status.Available {
		return nil, safeMessageError{message: status.Reason}
	}
	full := append([]string{"-nostats", "-progress", "pipe:1"}, args...)
	cmd := exec.CommandContext(ctx, status.Path, full...)
	hideCommandWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Text()
		key, value, ok := strings.Cut(line, "=")
		if !ok || onProgress == nil || durationSeconds <= 0 {
			continue
		}
		var microseconds float64
		if key == "out_time_us" || key == "out_time_ms" {
			parsed, parseErr := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if parseErr != nil {
				continue
			}
			microseconds = parsed
			if key == "out_time_ms" {
				microseconds *= 1000
			}
			fraction := microseconds / (durationSeconds * 1_000_000)
			if fraction > 1 {
				fraction = 1
			}
			onProgress(fraction)
		}
	}
	waitErr := cmd.Wait()
	output := stderr.Bytes()
	if waitErr != nil {
		return output, normalizeFFmpegError(waitErr, output)
	}
	return output, nil
}

func writeRenderConcatList(listPath string, files []string) error {
	var builder strings.Builder
	for _, file := range files {
		escaped := strings.ReplaceAll(filepath.ToSlash(file), "'", `'\''`)
		builder.WriteString("file '" + escaped + "'\n")
	}
	return os.WriteFile(listPath, []byte(builder.String()), 0644)
}

// saveRenderProgress 条件更新任务进度；返回 false 表示任务已被删除，执行器应终止。
func saveRenderProgress(task *model.RenderTask, status string, progress int) bool {
	task.Status = status
	task.Progress = clampProgress(progress)
	task.UpdatedAt = now()
	affected, err := repository.UpdateRenderTask(*task)
	if err != nil {
		log.Printf("save render task progress failed id=%s err=%v", task.ID, err)
		return true
	}
	if affected == 0 {
		// 任务已被删除：取消执行，临时目录由 defer 清理。
		cancelRenderRunning(task.ID)
		log.Printf("render task deleted, abort id=%s", task.ID)
		return false
	}
	return true
}

func failRenderTask(task *model.RenderTask, err error) {
	if errors.Is(err, context.Canceled) {
		// 删除触发的取消：不回写数据库，避免把已删除任务复活。
		return
	}
	message := safeErrorMessage(err)
	if errors.Is(err, context.DeadlineExceeded) {
		message = "渲染超时，任务已终止"
	}
	current := now()
	task.Status = "failed"
	task.Error = message
	task.ErrorDetail = strings.TrimSpace(err.Error())
	task.CompletedAt = current
	task.UpdatedAt = current
	if affected, saveErr := repository.UpdateRenderTask(*task); saveErr != nil {
		log.Printf("save failed render task failed id=%s err=%v", task.ID, saveErr)
	} else if affected == 0 {
		log.Printf("render task deleted before failure recorded id=%s", task.ID)
	}
	log.Printf("render task failed id=%s err=%v", task.ID, err)
}

func safeErrorMessage(err error) string {
	if safe, ok := err.(interface{ SafeMessage() string }); ok {
		return safe.SafeMessage()
	}
	return err.Error()
}
