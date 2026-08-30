package service

import (
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

// ModelChannelProtocolDashScope 阿里云百炼（DashScope）原生渠道协议标识
const ModelChannelProtocolDashScope = "dashscope"

// IsDashScopeChannel 判断渠道是否为百炼原生渠道：仅以协议字段判定，避免误判存量 openai 协议 + 百炼兼容模式地址的渠道
func IsDashScopeChannel(channel model.ModelChannel) bool {
	return strings.EqualFold(strings.TrimSpace(channel.Protocol), ModelChannelProtocolDashScope)
}
