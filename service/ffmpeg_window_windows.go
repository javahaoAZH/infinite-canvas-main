//go:build windows

package service

import (
	"os/exec"
	"syscall"
)

// hideCommandWindow Windows 下隐藏控制台窗口，避免桌面端执行时弹出黑框。
func hideCommandWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
