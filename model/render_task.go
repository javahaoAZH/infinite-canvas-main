package model

// RenderTaskItemKind 时间轴素材类型。
const (
	RenderItemKindVideo = "video"
	RenderItemKindImage = "image"
	RenderItemKindAudio = "audio"
)

// TimelineItem 时间轴片段，source 支持存储 storageKey（server:文件ID）、文件 ID 或 http(s) 外链。
type TimelineItem struct {
	Kind       string `json:"kind"`
	Source     string `json:"source"`
	DurationMs int    `json:"durationMs"`
}

// TimelineSpec 一键成片时间轴描述。
type TimelineSpec struct {
	FPS          int            `json:"fps"`
	Width        int            `json:"width"`
	Height       int            `json:"height"`
	Items        []TimelineItem `json:"items"`
	Srt          string         `json:"srt"`
	BurnSubtitle bool           `json:"burnSubtitle"`
}

// RenderTask 画布一键成片任务。
type RenderTask struct {
	ID           string `json:"id" gorm:"primaryKey"`
	UserID       string `json:"userId" gorm:"index"`
	Status       string `json:"status" gorm:"index:idx_render_tasks_status_created_at,priority:1"`
	Progress     int    `json:"progress"`
	TimelineJSON string `json:"timelineJson" gorm:"type:text"`
	OutputFileID string `json:"outputFileId"`
	Seconds      string `json:"seconds"`
	Size         string `json:"size"`
	Error        string `json:"error" gorm:"type:text"`
	ErrorDetail  string `json:"errorDetail" gorm:"type:text"`
	CreatedAt    string `json:"createdAt" gorm:"index;index:idx_render_tasks_status_created_at,priority:2"`
	UpdatedAt    string `json:"updatedAt" gorm:"index"`
	StartedAt    string `json:"startedAt"`
	CompletedAt  string `json:"completedAt"`
}
