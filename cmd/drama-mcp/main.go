// drama-mcp 独立 MCP 适配器进程：与主程序 exe 解耦，重编/重启主程序不会弄断 MCP 通道。
// 用法：drama-mcp.exe --token <漫剧通道令牌> [--port 9801]
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/tigerowo/infinite-canvas/mcpadapter"
)

func main() {
	token := flag.String("token", "", "漫剧页面桌面 MCP 通道令牌")
	port := flag.Int("port", 9801, "漫剧页面 WebSocket 端口")
	flag.Parse()
	if *token == "" {
		fmt.Fprintln(os.Stderr, "缺少 --token 参数：请在桌面 MCP 注册配置中传入漫剧页面的通道令牌")
		os.Exit(1)
	}
	mcpadapter.Run(*token, *port)
}
