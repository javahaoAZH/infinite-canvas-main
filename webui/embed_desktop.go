//go:build desktop

package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:out
var outFS embed.FS

// Enabled 桌面构建内嵌了前端静态产物。
func Enabled() bool { return true }

// FS 返回内嵌的前端静态资源文件系统（根为 out/）。
func FS() fs.FS {
	sub, err := fs.Sub(outFS, "out")
	if err != nil {
		panic(err)
	}
	return sub
}
