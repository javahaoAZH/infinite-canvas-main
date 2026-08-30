package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

type qoderChannelApplyRequest struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
}

func QoderChannelStatus(w http.ResponseWriter, r *http.Request) {
	status, err := service.QoderChannelStatus()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, status)
}

func QoderChannelApply(w http.ResponseWriter, r *http.Request) {
	var request qoderChannelApplyRequest
	_ = json.NewDecoder(r.Body).Decode(&request)
	status, err := service.QoderChannelApply(request.Enabled, request.Token)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, status)
}
