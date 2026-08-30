package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func SaveRenderTask(task model.RenderTask) (model.RenderTask, error) {
	db, err := DB()
	if err != nil {
		return task, err
	}
	return task, db.Save(&task).Error
}

// UpdateRenderTask 条件更新已存在的任务，返回受影响行数；
// 为 0 表示任务已被删除，执行器应终止而不是重新插入。
func UpdateRenderTask(task model.RenderTask) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	result := db.Model(&model.RenderTask{}).Where("id = ?", task.ID).Updates(map[string]any{
		"status":         task.Status,
		"progress":       task.Progress,
		"seconds":        task.Seconds,
		"size":           task.Size,
		"output_file_id": task.OutputFileID,
		"error":          task.Error,
		"error_detail":   task.ErrorDetail,
		"started_at":     task.StartedAt,
		"completed_at":   task.CompletedAt,
		"updated_at":     task.UpdatedAt,
	})
	return result.RowsAffected, result.Error
}

func GetRenderTask(id string) (model.RenderTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.RenderTask{}, false, err
	}
	var task model.RenderTask
	err = db.First(&task, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.RenderTask{}, false, nil
	}
	if err != nil {
		return model.RenderTask{}, false, err
	}
	return task, true, nil
}

func GetUserRenderTask(userID string, id string) (model.RenderTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.RenderTask{}, false, err
	}
	var task model.RenderTask
	err = db.First(&task, "user_id = ? AND id = ?", userID, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.RenderTask{}, false, nil
	}
	if err != nil {
		return model.RenderTask{}, false, err
	}
	return task, true, nil
}

func ListUserRenderTasks(userID string, limit int) ([]model.RenderTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	var tasks []model.RenderTask
	err = db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Find(&tasks).Error
	return tasks, err
}

func DeleteUserRenderTask(userID string, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("user_id = ? AND id = ?", userID, id).Delete(&model.RenderTask{}).Error
}

// FailInterruptedRenderTasks 把残留的执行中任务置为失败（服务重启等场景）。
func FailInterruptedRenderTasks(message string, completedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.RenderTask{}).
		Where("status IN ?", []string{"queued", "preparing", "rendering"}).
		Updates(map[string]any{
			"status":       "failed",
			"error":        message,
			"completed_at": completedAt,
			"updated_at":   completedAt,
		}).Error
}
