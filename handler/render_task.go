package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

// CreateRenderTaskHandler 创建画布一键成片任务。
func CreateRenderTaskHandler(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var request struct {
		Timeline model.TimelineSpec `json:"timeline"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "时间轴配置格式错误")
		return
	}
	task, err := service.CreateRenderTask(user.ID, request.Timeline)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, service.RenderTaskResponse(task))
}

// UserRenderTasks 查询当前用户的成片任务列表。
func UserRenderTasks(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	tasks, err := service.ListUserRenderTasks(user.ID, 50)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, tasks)
}

// GetUserRenderTask 查询单个成片任务（前端轮询用）。
func GetUserRenderTask(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	task, found, err := service.GetUserRenderTask(user.ID, strings.TrimSpace(id))
	if err != nil {
		FailError(w, err)
		return
	}
	if !found {
		Fail(w, "渲染任务不存在")
		return
	}
	OK(w, service.RenderTaskResponse(task))
}

// DeleteUserRenderTask 删除当前用户的成片任务记录。
func DeleteUserRenderTask(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	id = strings.TrimSpace(id)
	if id == "" {
		Fail(w, "渲染任务不存在")
		return
	}
	if err := service.DeleteUserRenderTask(user.ID, id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"deleted": true})
}

// StageRenderMedia 前端把本地媒体（浏览器 blob）暂存到本地磁盘项目文件夹，返回 file: 来源供一键成片读取。
func StageRenderMedia(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		Fail(w, "素材过大或上传格式不正确")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请上传素材文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		FailError(w, err)
		return
	}
	folder := strings.TrimSpace(r.FormValue("folder"))
	source, err := service.StageLocalRenderMedia(folder, header.Filename, header.Header.Get("Content-Type"), data)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"source": source})
}

// ServeRenderOutput 流式返回保存在本地磁盘的成片文件。
func ServeRenderOutput(w http.ResponseWriter, r *http.Request, id string) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	localPath, err := service.RenderOutputLocalPath(id)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	w.Header().Set("Content-Type", "video/mp4")
	http.ServeFile(w, r, localPath)
}
