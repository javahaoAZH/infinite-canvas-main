package handler

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

const ffmpegDownloadURL = "https://www.ffmpeg.org/download.html"

type renderFFmpegStatusResponse struct {
	Available   bool   `json:"available"`
	Path        string `json:"path"`
	Version     string `json:"version"`
	Source      string `json:"source"`
	Reason      string `json:"reason"`
	DownloadURL string `json:"downloadUrl"`
}

type renderFFmpegPathRequest struct {
	Path string `json:"path"`
}

// RenderFFmpegStatus 探测本机 FFmpeg 可用性。
func RenderFFmpegStatus(w http.ResponseWriter, r *http.Request) {
	status := service.FFmpegStatus()
	OK(w, renderFFmpegStatusResponse{
		Available:   status.Available,
		Path:        status.Path,
		Version:     status.Version,
		Source:      status.Source,
		Reason:      status.Reason,
		DownloadURL: ffmpegDownloadURL,
	})
}

// SaveRenderFFmpegPath 保存私有配置中的 FFmpeg 路径。
func SaveRenderFFmpegPath(w http.ResponseWriter, r *http.Request) {
	var request renderFFmpegPathRequest
	_ = json.NewDecoder(r.Body).Decode(&request)
	path, err := service.SaveRenderFFmpegPath(request.Path)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"path": path})
}

type exportJianyingDraftRequest struct {
	Timeline  model.TimelineSpec `json:"timeline"`
	DraftName string             `json:"draftName"`
}

// ExportJianyingDraft 导出剪映草稿工程（zip 文件流，不走 {code,data,msg}）。
func ExportJianyingDraft(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var request exportJianyingDraftRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "时间轴配置格式错误")
		return
	}
	rootDir, err := service.BuildJianyingDraft(r.Context(), user.ID, request.Timeline, request.DraftName)
	if err != nil {
		FailError(w, err)
		return
	}
	defer os.RemoveAll(rootDir)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="jianying-draft-%d.zip"`, time.Now().Unix()))
	if err := zipDirectory(w, rootDir); err != nil {
		// 响应头已写出，无法再返回 JSON，仅记录日志。
		log.Printf("export jianying draft zip failed: %v", err)
	}
}

// zipDirectory 将目录流式打包写入响应（保留目录内相对路径）。
func zipDirectory(writer io.Writer, rootDir string) error {
	zipWriter := zip.NewWriter(writer)
	defer zipWriter.Close()
	return filepath.WalkDir(rootDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative, relErr := filepath.Rel(rootDir, path)
		if relErr != nil {
			return relErr
		}
		file, createErr := zipWriter.Create(filepath.ToSlash(relative))
		if createErr != nil {
			return createErr
		}
		source, openErr := os.Open(path)
		if openErr != nil {
			return openErr
		}
		defer source.Close()
		_, copyErr := io.Copy(file, source)
		return copyErr
	})
}
