package main

import (
	"flag"
	"log"
	"os"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/mcpadapter"
	"github.com/tigerowo/infinite-canvas/service"
)

func main() {
	// Qoder 通道 MCP 适配器子命令：STDIO MCP ↔ WS 页面透传，不碰 DB/调度器
	if len(os.Args) > 1 && os.Args[1] == "mcp-adapter" {
		fs := flag.NewFlagSet("mcp-adapter", flag.ExitOnError)
		token := fs.String("token", "", "漫剧页面通道令牌")
		port := fs.Int("port", 9801, "WebSocket 监听端口")
		fs.Parse(os.Args[2:])
		mcpadapter.Run(*token, *port)
		return
	}
	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := service.EnsureDefaultAdmin(); err != nil {
		log.Fatal(err)
	}
	service.StartPromptSyncScheduler()
	service.StartCanvasProjectCleanupScheduler()
	service.StartRenderExecutor()
	handler.StartVideoTaskPoller()
	if err := runServer(); err != nil {
		log.Fatal(err)
	}
}
