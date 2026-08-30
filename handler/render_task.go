package handler

import (
	"encoding/json"
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
