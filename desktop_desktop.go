//go:build desktop

package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/router"
)

// Win32 窗口常量与懒加载调用：无边框窗口 + 前端自绘标题栏接管最小化/最大化/关闭/拖动
var (
	user32                = syscall.NewLazyDLL("user32.dll")
	procGetWindowLongPtr  = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr  = user32.NewProc("SetWindowLongPtrW")
	procShowWindow        = user32.NewProc("ShowWindow")
	procIsZoomed          = user32.NewProc("IsZoomed")
	procReleaseCapture    = user32.NewProc("ReleaseCapture")
	procSendMessage       = user32.NewProc("SendMessageW")
	procDestroyWindow     = user32.NewProc("DestroyWindow")
)

const (
	gwlStyle        = -16
	wsCaption       = 0x00C00000
	swHide          = 0
	swShow          = 9
	swMinimize      = 6
	swMaximize      = 3
	swRestore       = 9
	wmNcLButtonDown = 0x00A1
	htCaption       = 2
)

var (
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procDwmSetAttribute     = syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
	// probeClient 单实例探测用短超时客户端
	probeClient = &http.Client{Timeout: 400 * time.Millisecond}
)

const (
	swpNoSize       = 0x0001
	swpNoMove       = 0x0002
	swpNoZOrder     = 0x0004
	swpFrameChanged = 0x0020
	wmSize          = 0x0005
)

type winRect struct{ Left, Top, Right, Bottom int32 }

// refreshWebViewBounds 去标题栏后客户区变高，WebView2 渲染面仍停旧边界会在顶部留下未绘制透空带；
// 补发 WM_SIZE 让其按新客户区重新布局。
func refreshWebViewBounds(hwnd uintptr) {
	var r winRect
	procGetWindowRect := user32.NewProc("GetWindowRect")
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	w := uint32(r.Right - r.Left)
	h := uint32(r.Bottom - r.Top)
	procSendMessage.Call(hwnd, uintptr(wmSize), 0, uintptr(w|h<<16))
}

// makeFrameless 去掉原生标题栏（保留边框缩放与任务栏行为），视觉交给前端标题栏（菜单+窗口控制），对标 Codex 桌面版单行顶栏。
func makeFrameless(hwnd uintptr) {
	idx := int64(gwlStyle)
	style, _, _ := procGetWindowLongPtr.Call(hwnd, uintptr(idx))
	procSetWindowLongPtr.Call(hwnd, uintptr(idx), style &^ uintptr(wsCaption))
	// 改样式后必须强制重算非客户区，否则原生标题栏残留在窗口上（双标题栏）
	procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, uintptr(swpNoSize|swpNoMove|swpNoZOrder|swpFrameChanged))
	// DWM 沉浸式暗色：让 WS_THICKFRAME 的 7px 不可见调整边框按暗色主题绘制，
	// 否则边框未绘制呈透空带（窗口四周露出背后内容）
	dark := int32(1)
	procDwmSetAttribute.Call(hwnd, uintptr(20), uintptr(unsafe.Pointer(&dark)), 4)
	// Win11：直接钉死标题/边框颜色为深色——浅色系统主题下 DWM 会把顶边框绘制成白色色带
	captionColor := int32(0x00202020) // COLORREF 0x00BBGGRR
	borderColor := int32(0x00202020)
	procDwmSetAttribute.Call(hwnd, uintptr(35), uintptr(unsafe.Pointer(&captionColor)), 4)
	procDwmSetAttribute.Call(hwnd, uintptr(34), uintptr(unsafe.Pointer(&borderColor)), 4)
}

// compatPort 旧默认端口：保留兼容监听，避免历史书签/IDE 内置浏览器/第三方内嵌 WebView 指向空端口报连接拒绝。
const compatPort = "8080"

// killOrphanWebviews 清理上一次实例被强杀后残留的 msedgewebview2 子进程：
// 宿主已退出时这些僵尸窗口会停在错误页且 Reload 永远失败，启动时本进程的子进程尚未创建，匹配到的一律是残留。
func killOrphanWebviews() {
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		`Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -match 'webview-exe-name=InfiniteCanvas\.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)
	_ = cmd.Run()
}

// runServer 桌面模式：启动 HTTP 服务后打开 WebView2 独立窗口；
// 服务生命周期与窗口解耦：关窗仅隐藏窗口、服务继续跑，文件菜单「退出」才真退出；
// 新实例探测到已运行实例时唤醒其窗口并自退（单实例协调，避免双实例争抢数据库与端口）。
func runServer() error {
	for _, p := range []string{config.Cfg.Port, compatPort} {
		resp, err := probeClient.Get("http://127.0.0.1:" + p + "/api/health")
		if err != nil {
			continue
		}
		resp.Body.Close()
		if r2, err2 := probeClient.Get("http://127.0.0.1:" + p + "/api/__show-window"); err2 == nil {
			r2.Body.Close()
		}
		fmt.Println("检测到已在运行的实例，已唤醒其窗口，本进程退出")
		return nil
	}
	// 桌面形态只监听回环地址，避免把带默认管理员凭据的服务暴露到局域网。
	listener, err := net.Listen("tcp", "127.0.0.1:"+config.Cfg.Port)
	if err != nil {
		// 端口被占（其他工具/残留实例）时让位给 OS 分配空闲端口，保证桌面应用总能启动
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return err
		}
	}
	server := &http.Server{Handler: router.New()}
	go func() { _ = server.Serve(listener) }()
	// 兼容监听：旧地址（IDE 内置浏览器/书签/第三方内嵌 WebView 仍指向 8080）刷新即恢复，
	// 被占用时静默跳过（主端口已让位机制兼容）
	if compat, err := net.Listen("tcp", "127.0.0.1:"+compatPort); err == nil {
		go func() { _ = server.Serve(compat) }()
	}

	url := fmt.Sprintf("http://127.0.0.1:%d", listener.Addr().(*net.TCPAddr).Port)
	if startPath := os.Getenv("INFINITE_CANVAS_START_PATH"); len(startPath) > 0 && startPath[0] == '/' {
		url += startPath
	}
	// 先清残留 WebView 僵尸窗口，再创建新窗口
	killOrphanWebviews()
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
	// 无边框 + 窗口控制/拖动桥接：前端标题栏通过 window.winXxx 调用
	hwnd := uintptr(window.Window())
	makeFrameless(hwnd)
	refreshWebViewBounds(hwnd)
	_ = window.Bind("winMinimize", func() { procShowWindow.Call(hwnd, uintptr(swMinimize)) })
	_ = window.Bind("winMaximize", func() {
		if r, _, _ := procIsZoomed.Call(hwnd); r != 0 {
			procShowWindow.Call(hwnd, uintptr(swRestore))
		} else {
			procShowWindow.Call(hwnd, uintptr(swMaximize))
		}
	})
	_ = window.Bind("winClose", func() {
		// 关窗＝隐藏窗口、服务继续跑；真退出走文件菜单「退出」(winExit)
		procShowWindow.Call(hwnd, uintptr(swHide))
	})
	_ = window.Bind("winExit", func() { procDestroyWindow.Call(hwnd) })
	router.ShowWindowHook = func() {
		procShowWindow.Call(hwnd, uintptr(swShow))
		procSetForegroundWindow.Call(hwnd)
	}
	_ = window.Bind("winDrag", func() {
		procReleaseCapture.Call()
		procSendMessage.Call(hwnd, uintptr(wmNcLButtonDown), uintptr(htCaption), 0)
	})
	window.Navigate(url)
	// 诊断：周期性让 webview 自报当前 URL（Bind 回传 + beacon 双通道），
	// 定位错误页（chrome-error://chromewebdata/）与正常页面的切换时机
	_ = window.Bind("reportUrl", func(u string) {
		fmt.Println("[WEBVIEW-URL]", time.Now().Format("15:04:05"), u)
	})
	go func() {
		for i := 0; i < 600; i++ {
			time.Sleep(3 * time.Second)
			window.Dispatch(func() {
				window.Eval(`(function(){ try { fetch('/__webview-url?u=' + encodeURIComponent(location.href)); if (window.reportUrl) window.reportUrl(location.href); } catch(e) {} })()`)
			})
		}
	}()
	window.Run()
	return nil
}
