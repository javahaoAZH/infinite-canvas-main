//go:build desktop

package main

import (
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"runtime"

	webview2 "github.com/jchv/go-webview2"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/router"
)

// runServer 桌面模式：启动 HTTP 服务后打开 WebView2 独立窗口，窗口关闭则退出进程。
func runServer() error {
	// 桌面形态只监听回环地址，避免把带默认管理员凭据的服务暴露到局域网。
	listener, err := net.Listen("tcp", "127.0.0.1:"+config.Cfg.Port)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: router.New()}
	go func() { _ = server.Serve(listener) }()

	url := "http://127.0.0.1:" + config.Cfg.Port
	// Windows 消息循环要求固定线程，锁定当前主 goroutine。
	runtime.LockOSThread()
	window := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "无限画布",
			Width:  1440,
			Height: 900,
		},
	})
	if window == nil {
		fmt.Println("未检测到 WebView2 运行时，已改用系统默认浏览器打开:", url)
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		select {}
	}
	defer window.Destroy()
	window.Navigate(url)
	window.Run()
	return nil
}
