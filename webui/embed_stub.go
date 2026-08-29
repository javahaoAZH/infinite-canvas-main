//go:build !desktop

package webui

import "io/fs"

// Enabled 普通构建不内嵌前端静态产物。
func Enabled() bool { return false }

// FS 普通构建下无内嵌资源。
func FS() fs.FS { return nil }
