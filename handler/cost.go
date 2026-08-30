package handler

import (
	"net/http"
	"strconv"

	"github.com/tigerowo/infinite-canvas/service"
)

func UserCostSummary(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	summary, err := service.CurrentUserCostSummary(r.Context(), days)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, summary)
}
