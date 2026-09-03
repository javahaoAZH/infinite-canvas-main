package mcpadapter

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/mark3labs/mcp-go/server"
)

// Run 是 mcp-adapter 子命令入口：桌面 MCP 客户端 STDIO ↔ WS(127.0.0.1:port) 漫剧页面透传，
// 行为与 mcp-adapter/drama-mcp.mjs 一致，不碰 DB/调度器。
func Run(token string, port int) {
	if token == "" {
		fmt.Fprintln(os.Stderr, "缺少 --token 参数：请在桌面 MCP 注册配置中传入漫剧页面的通道令牌")
		os.Exit(1)
	}
	if port <= 0 {
		port = 9801
	}

	hub := newHub(token)
	if err := hub.listenAndServe(port); err != nil {
		fmt.Fprintf(os.Stderr, "适配器 WebSocket 启动失败（127.0.0.1:%d）：%v\n", port, err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "drama-mcp 适配器已启动：MCP(STDIO) ↔ WS(127.0.0.1:%d)，等待漫剧页面连接\n", port)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// SIGTERM / SIGINT 优雅退出
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()

	// stdin EOF（父进程 Qoder 退出）时 Listen 返回，随后优雅关闭
	stdio := server.NewStdioServer(newMCPServer(hub))
	stdio.Listen(ctx, os.Stdin, os.Stdout)
	hub.shutdown()
}
