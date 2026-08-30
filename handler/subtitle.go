package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

// 单次请求允许的对白条目上限，防止超大请求体。
const maxSubtitleDialogueEntries = 1000

// SubtitlesFromDialogue 将对白条目组装为 SRT 文本返回给前端。
func SubtitlesFromDialogue(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Dialogue []service.DialogueEntry `json:"dialogue"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "对白数据格式错误")
		return
	}
	if len(request.Dialogue) == 0 {
		Fail(w, "请先添加至少一条对白")
		return
	}
	if len(request.Dialogue) > maxSubtitleDialogueEntries {
		Fail(w, "单次对白条目过多，请分批处理")
		return
	}
	srt, err := service.BuildSRT(request.Dialogue)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"srt": srt})
}
