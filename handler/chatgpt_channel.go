package handler

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

type chatGPTChannelApplyRequest struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
}

func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func ChatGPTChannelStatus(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		Fail(w, "ChatGPT 桌面通道仅支持本机访问")
		return
	}
	status, err := service.ChatGPTChannelStatus()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, status)
}

func ChatGPTChannelApply(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		Fail(w, "ChatGPT 桌面通道仅支持本机访问")
		return
	}
	var request chatGPTChannelApplyRequest
	_ = json.NewDecoder(r.Body).Decode(&request)
	status, err := service.ChatGPTChannelApply(request.Enabled, request.Token)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, status)
}
