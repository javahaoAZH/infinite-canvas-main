//go:build !desktop

package main

import (
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/router"
)

// runServer 普通服务模式：直接阻塞监听 HTTP。
func runServer() error {
	return router.New().Run(":" + config.Cfg.Port)
}
