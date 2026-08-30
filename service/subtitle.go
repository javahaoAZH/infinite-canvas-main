package service

import (
	"fmt"
	"sort"
	"strings"
)

// 单条字幕时长上限（5 分钟），防止异常时间戳拖垮播放器。
const maxSubtitleEntryDurationMs = 300000

// DialogueEntry 一条对白字幕条目，时间单位为毫秒。
type DialogueEntry struct {
	Text    string `json:"text"`
	StartMs int    `json:"startMs"`
	EndMs   int    `json:"endMs"`
}

// BuildSRT 将对白条目组装为 SRT 文本：按开始时间排序、序号从 1 开始、
// 时间戳为 HH:MM:SS,mmm 格式、条目之间以空行分隔。纯文本组装，不依赖第三方库。
func BuildSRT(entries []DialogueEntry) (string, error) {
	if len(entries) == 0 {
		return "", safeMessageError{message: "对白条目不能为空"}
	}
	sorted := make([]DialogueEntry, len(entries))
	copy(sorted, entries)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].StartMs < sorted[j].StartMs })

	var builder strings.Builder
	index := 0
	for position, entry := range sorted {
		number := position + 1
		text := sanitizeSRTText(entry.Text)
		if text == "" {
			continue
		}
		if entry.StartMs < 0 {
			return "", safeMessageError{message: fmt.Sprintf("第 %d 条字幕开始时间不能为负数", number)}
		}
		if entry.EndMs <= entry.StartMs {
			return "", safeMessageError{message: fmt.Sprintf("第 %d 条字幕结束时间必须晚于开始时间", number)}
		}
		if entry.EndMs-entry.StartMs > maxSubtitleEntryDurationMs {
			return "", safeMessageError{message: fmt.Sprintf("第 %d 条字幕持续时长过长，请检查时间设置", number)}
		}
		index++
		builder.WriteString(fmt.Sprintf("%d\n%s --> %s\n%s\n\n", index, formatSRTTimestamp(entry.StartMs), formatSRTTimestamp(entry.EndMs), text))
	}
	if index == 0 {
		return "", safeMessageError{message: "没有有效的字幕文本，请检查对白内容"}
	}
	return builder.String(), nil
}

// formatSRTTimestamp 将毫秒格式化为 SRT 时间戳 HH:MM:SS,mmm。
func formatSRTTimestamp(ms int) string {
	hours := ms / 3600000
	minutes := ms % 3600000 / 60000
	seconds := ms % 60000 / 1000
	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, seconds, ms%1000)
}

// sanitizeSRTText 清理字幕文本：去首尾空白、压平换行、移除控制字符，
// 并转义可能破坏 SRT 结构的 "-->" 序列。
func sanitizeSRTText(text string) string {
	var builder strings.Builder
	for _, r := range text {
		if r == '\n' || r == '\r' || r == '\t' {
			builder.WriteRune(' ')
			continue
		}
		if r < 0x20 {
			continue
		}
		builder.WriteRune(r)
	}
	cleaned := strings.TrimSpace(builder.String())
	cleaned = strings.ReplaceAll(cleaned, "-->", "-- >")
	return strings.Join(strings.Fields(cleaned), " ")
}
