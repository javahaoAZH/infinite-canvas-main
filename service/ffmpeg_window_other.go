//go:build !windows

package service

import "os/exec"

// hideCommandWindow 非 Windows 平台无需隐藏窗口。
func hideCommandWindow(cmd *exec.Cmd) {}
