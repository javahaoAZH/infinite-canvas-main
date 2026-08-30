package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// FFmpegDetection FFmpeg 探测结果。
type FFmpegDetection struct {
	Available bool   `json:"available"`
	Path      string `json:"path"`
	Version   string `json:"version"`
	Source    string `json:"source"`
	Reason    string `json:"reason"`
}

// FFmpegStatus 按 私有配置 → 环境变量 → 系统 PATH 顺序探测 FFmpeg，
// 对找到的路径执行 -version 验证并解析版本字符串首行。
func FFmpegStatus() FFmpegDetection {
	candidates := []struct {
		path   string
		source string
	}{
		{strings.TrimSpace(privateProductionSetting().FFmpegPath), "settings"},
		{strings.TrimSpace(config.Cfg.FFMPEGPath), "env"},
	}
	lastReason := ""
	for _, candidate := range candidates {
		if candidate.path == "" {
			continue
		}
		version, err := probeFFmpegVersion(candidate.path)
		if err == nil {
			return FFmpegDetection{Available: true, Path: candidate.path, Version: version, Source: candidate.source}
		}
		lastReason = "指定路径的 FFmpeg 无法执行，请检查路径是否正确，或在设置中留空改用自动探测。"
	}
	if path, err := exec.LookPath("ffmpeg"); err == nil {
		if version, verifyErr := probeFFmpegVersion(path); verifyErr == nil {
			return FFmpegDetection{Available: true, Path: path, Version: version, Source: "path"}
		}
	}
	if lastReason == "" {
		lastReason = "未检测到 FFmpeg，请安装后重试，或在设置中手动指定 ffmpeg 可执行文件路径。"
	}
	return FFmpegDetection{Reason: lastReason}
}

// SaveRenderFFmpegPath 仅更新私有配置中的 Production.FFmpegPath。
// 保存前防御性校验：非空路径必须能执行 -version 且输出包含 "ffmpeg"，
// 避免把任意可执行文件写进全局配置被服务端执行。
func SaveRenderFFmpegPath(ffmpegPath string) (string, error) {
	ffmpegPath = strings.TrimSpace(ffmpegPath)
	if ffmpegPath != "" {
		version, err := probeFFmpegVersion(ffmpegPath)
		if err != nil || !strings.Contains(strings.ToLower(version), "ffmpeg") {
			return "", safeMessageError{message: "指定路径不是有效的 FFmpeg 可执行文件，请检查后重试"}
		}
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return "", err
	}
	settings = normalizeSettings(settings)
	settings.Private.Production.FFmpegPath = ffmpegPath
	if _, err := repository.SaveSettings(settings, now()); err != nil {
		return "", err
	}
	return settings.Private.Production.FFmpegPath, nil
}

// RunFFmpeg 使用探测到的 FFmpeg 执行参数列表，合并 stderr 便于错误诊断。
func RunFFmpeg(ctx context.Context, args []string) ([]byte, error) {
	status := FFmpegStatus()
	if !status.Available {
		return nil, safeMessageError{message: status.Reason}
	}
	return runFFmpegBinary(ctx, status.Path, args)
}

// ConcatClips 使用 concat 封装合并视频片段，listFile 为 concat 清单文件路径。
func ConcatClips(ctx context.Context, listFile string, outputPath string) ([]byte, error) {
	return RunFFmpeg(ctx, []string{
		"-y",
		"-f", "concat",
		"-safe", "0",
		"-i", listFile,
		"-c", "copy",
		outputPath,
	})
}

// defaultSubtitleFontName 烧录字幕的默认中文字体，避免无字体时中文变乱码或方块。
const defaultSubtitleFontName = "Microsoft YaHei"

// BurnSubtitles 将字幕烧录进视频，fontDir 为预留字体目录参数位，可为空；
// fontName 为空时默认使用 Microsoft YaHei 以兼容中文字幕。
func BurnSubtitles(ctx context.Context, inputPath string, subtitlePath string, outputPath string, fontDir string, fontName string) ([]byte, error) {
	if strings.TrimSpace(fontName) == "" {
		fontName = defaultSubtitleFontName
	}
	filter := "subtitles=" + escapeFFmpegFilterPath(subtitlePath) + ":fontname=" + escapeFFmpegFilterText(fontName)
	if strings.TrimSpace(fontDir) != "" {
		filter += ":fontsdir=" + escapeFFmpegFilterPath(fontDir)
	}
	return RunFFmpeg(ctx, []string{
		"-y",
		"-i", inputPath,
		"-vf", filter,
		"-c:a", "copy",
		outputPath,
	})
}

// ProbeMedia 探测媒体信息，优先使用与 FFmpeg 同目录的 ffprobe 输出 JSON，
// 找不到 ffprobe 时降级使用 ffmpeg -i。
func ProbeMedia(ctx context.Context, inputPath string) ([]byte, error) {
	status := FFmpegStatus()
	if !status.Available {
		return nil, safeMessageError{message: status.Reason}
	}
	if probePath, ok := resolveFFprobePath(status.Path); ok {
		return runFFmpegBinary(ctx, probePath, []string{"-v", "error", "-show_format", "-show_streams", "-of", "json", inputPath})
	}
	return runFFmpegBinary(ctx, status.Path, []string{"-hide_banner", "-i", inputPath})
}

func privateProductionSetting() model.ProductionSetting {
	settings, err := repository.GetSettings()
	if err != nil {
		return model.ProductionSetting{}
	}
	return normalizePrivateSetting(settings.Private).Production
}

func probeFFmpegVersion(binaryPath string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binaryPath, "-version")
	hideCommandWindow(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	line := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
	if line == "" {
		return "", errors.New("empty version output")
	}
	return line, nil
}

func runFFmpegBinary(ctx context.Context, binaryPath string, args []string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, binaryPath, args...)
	hideCommandWindow(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return output, normalizeFFmpegError(err, output)
	}
	return output, nil
}

func normalizeFFmpegError(err error, output []byte) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return safeMessageError{message: "FFmpeg 执行超时或已被取消"}
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return safeMessageError{message: fmt.Sprintf("FFmpeg 执行失败（退出码 %d）：%s", exitErr.ExitCode(), tailFFmpegOutput(output))}
	}
	return safeMessageError{message: "FFmpeg 执行失败，请检查可执行文件路径和参数"}
}

func tailFFmpegOutput(output []byte) string {
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) > 3 {
		lines = lines[len(lines)-3:]
	}
	return strings.TrimSpace(strings.Join(lines, " "))
}

func resolveFFprobePath(ffmpegPath string) (string, bool) {
	name := "ffprobe"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	candidate := filepath.Join(filepath.Dir(ffmpegPath), name)
	if _, err := os.Stat(candidate); err == nil {
		return candidate, true
	}
	if path, err := exec.LookPath("ffprobe"); err == nil {
		return path, true
	}
	return "", false
}

// escapeFFmpegFilterPath 转义滤镜参数中的路径，避免特殊字符破坏滤镜表达式。
func escapeFFmpegFilterPath(value string) string {
	escaped := strings.NewReplacer("\\", "\\\\", ":", "\\:", "'", "\\'").Replace(filepath.ToSlash(value))
	return "'" + escaped + "'"
}

// escapeFFmpegFilterText 转义滤镜参数中的普通文本（如字体名），不做路径斜杠转换。
func escapeFFmpegFilterText(value string) string {
	escaped := strings.NewReplacer("\\", "\\\\", ":", "\\:", "'", "\\'").Replace(value)
	return "'" + escaped + "'"
}
