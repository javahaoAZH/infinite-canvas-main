package handler

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

// DramaAssetManifest 读取项目资产清单（唯一事实源，缺失时返回空清单）。
func DramaAssetManifest(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	manifest, err := service.LoadAssetManifest(r.URL.Query().Get("project"))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, manifest)
}

// DramaAssetUpsertEntry 登记/更新清单条目（MCP 与界面共用）。
func DramaAssetUpsertEntry(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var body struct {
		Project string         `json:"project"`
		Entry   map[string]any `json:"entry"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		Fail(w, "参数格式不正确")
		return
	}
	entry, err := service.UpsertAssetEntry(body.Project, body.Entry)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, entry)
}

// DramaAssetReview 审核登记：已确认/需修改，轮次与意见留档。
func DramaAssetReview(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var body struct {
		Project    string `json:"project"`
		ID         string `json:"id"`
		Reviewer   string `json:"reviewer"`
		Conclusion string `json:"conclusion"`
		Comment    string `json:"comment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		Fail(w, "参数格式不正确")
		return
	}
	entry, err := service.ReviewAssetEntry(body.Project, body.ID, body.Reviewer, body.Conclusion, body.Comment)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, entry)
}

// DramaAssetBind 绑定生成产物为新版本（multipart：files 多文件、source 可选复跑参数）。
func DramaAssetBind(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		Fail(w, "上传过大或格式不正确")
		return
	}
	project := strings.TrimSpace(r.FormValue("project"))
	id := strings.TrimSpace(r.FormValue("id"))
	note := strings.TrimSpace(r.FormValue("note"))
	headers := r.MultipartForm.File["files"]
	if len(headers) == 0 {
		Fail(w, "请上传至少一个产物文件")
		return
	}
	files := map[string][]byte{}
	for _, header := range headers {
		file, err := header.Open()
		if err != nil {
			FailError(w, err)
			return
		}
		data, err := io.ReadAll(file)
		file.Close()
		if err != nil {
			FailError(w, err)
			return
		}
		files[header.Filename] = data
	}
	var sourceJSON []byte
	if source, header, err := r.FormFile("source"); err == nil {
		data, err := io.ReadAll(source)
		source.Close()
		if err != nil {
			FailError(w, err)
			return
		}
		sourceJSON = data
		_ = header
	}
	entry, err := service.BindAssetFiles(project, id, files, sourceJSON, note)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, entry)
}

// DramaAssetWriteFile 写项目文件夹受控路径（分镜稿 md 等文本或 base64 二进制）。
func DramaAssetWriteFile(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var body struct {
		Project string `json:"project"`
		Path    string `json:"path"`
		Text    string `json:"text"`
		Base64  string `json:"base64"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		Fail(w, "参数格式不正确")
		return
	}
	data := []byte(body.Text)
	if body.Base64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(body.Base64)
		if err != nil {
			Fail(w, "base64 解码失败")
			return
		}
		data = decoded
	}
	if err := service.WriteAssetProjectFile(body.Project, body.Path, data); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"written": true, "path": body.Path})
}

// DramaAssetCheck 开工前检查：该集缺产出/未确认/依赖阻塞清单。
func DramaAssetCheck(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	result, err := service.CheckEpisodeAssets(r.URL.Query().Get("project"), strings.TrimSpace(r.URL.Query().Get("episode")))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// DramaAssetServe 流式下发项目文件夹受控路径文件（界面缩略图/分镜稿预览）。
func DramaAssetServe(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	target, err := service.AssetFileAbs(r.URL.Query().Get("project"), r.URL.Query().Get("path"))
	if err != nil {
		FailError(w, err)
		return
	}
	if contentType := mime.TypeByExtension(filepath.Ext(target)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeFile(w, r, target)
}
