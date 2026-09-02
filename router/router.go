package router

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/middleware"
	"github.com/tigerowo/infinite-canvas/webui"
)

func New() *gin.Engine {
	router := gin.Default()
	router.RedirectTrailingSlash = false
	_ = router.SetTrustedProxies(nil)
	api := router.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	api.POST("/auth/register", gin.WrapF(handler.Register))
	api.POST("/auth/login", gin.WrapF(handler.Login))
	api.GET("/auth/linux-do/authorize", gin.WrapF(handler.LinuxDoAuthorize))
	api.GET("/auth/linux-do/callback", gin.WrapF(handler.LinuxDoCallback))
	api.GET("/auth/me", middleware.OptionalAuth, gin.WrapF(handler.CurrentUser))
	api.GET("/settings", gin.WrapF(handler.Settings))
	api.GET("/qoder-channel/status", gin.WrapF(handler.QoderChannelStatus))
	api.POST("/qoder-channel", gin.WrapF(handler.QoderChannelApply))
	api.GET("/storage/config", gin.WrapF(handler.StorageConfig))
	api.GET("/media/references/:id", func(c *gin.Context) {
		handler.ReferenceMedia(c.Writer, c.Request, c.Param("id"))
	})
	api.HEAD("/media/references/:id", func(c *gin.Context) {
		handler.ReferenceMedia(c.Writer, c.Request, c.Param("id"))
	})
	api.GET("/files/:id", func(c *gin.Context) {
		handler.FileInfo(c.Writer, c.Request, c.Param("id"))
	})
	api.GET("/files/:id/content", func(c *gin.Context) {
		handler.FileContent(c.Writer, c.Request, c.Param("id"))
	})
	api.POST("/ai/direct-request", gin.WrapF(handler.PrepareDirectAIRequest))
	anonymousFiles := api.Group("/anonymous/files", middleware.AnonymousStorage)
	anonymousFiles.POST("/session", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	anonymousFiles.POST("", gin.WrapF(handler.UploadFile))
	anonymousFiles.DELETE("/:id", func(c *gin.Context) {
		handler.DeleteFile(c.Writer, c.Request, c.Param("id"))
	})
	v1 := api.Group("/v1", middleware.UserAuth)
	v1.POST("/images/generations", gin.WrapF(handler.AIImagesGenerations))
	v1.POST("/images/edits", gin.WrapF(handler.AIImagesEdits))
	v1.POST("/responses", gin.WrapF(handler.AIResponses))
	v1.POST("/chat/completions", gin.WrapF(handler.AIChatCompletions))
	v1.POST("/audio/speech", gin.WrapF(handler.AIAudioSpeech))
	v1.GET("/tts/voices", gin.WrapF(handler.AITTSVoices))
	v1.GET("/comfy/workflows", gin.WrapF(handler.AIComfyWorkflows))
	v1.GET("/comfy/queue", gin.WrapF(handler.AIComfyQueue))
	v1.GET("/comfy/jobs/:id", func(c *gin.Context) {
		handler.AIComfyJob(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/canvas/tasks/delete", gin.WrapF(handler.DeleteUserCanvasTasks))
	v1.POST("/canvas/image-tasks", gin.WrapF(handler.CreateCanvasImageTask))
	v1.GET("/canvas/image-tasks", gin.WrapF(handler.UserCanvasImageTasks))
	v1.POST("/canvas/image-tasks/status", gin.WrapF(handler.BatchCanvasImageTasks))
	v1.GET("/canvas/image-tasks/:id", func(c *gin.Context) {
		handler.GetCanvasImageTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/canvas/image-tasks/:id", func(c *gin.Context) {
		handler.DeleteUserCanvasImageTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/canvas/audio-tasks", gin.WrapF(handler.CreateCanvasAudioTask))
	v1.GET("/canvas/audio-tasks/:id", func(c *gin.Context) {
		handler.GetCanvasAudioTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/ai-logs", gin.WrapF(handler.ClientAICallLog))
	v1.POST("/videos", gin.WrapF(handler.AIVideos))
	v1.GET("/video-tasks", gin.WrapF(handler.UserVideoTasks))
	v1.DELETE("/video-tasks/:id", func(c *gin.Context) {
		handler.DeleteUserVideoTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/media/references", gin.WrapF(handler.UploadReferenceMedia))
	v1.GET("/render/ffmpeg-status", gin.WrapF(handler.RenderFFmpegStatus))
	v1.POST("/subtitles/from-dialogue", gin.WrapF(handler.SubtitlesFromDialogue))
	v1.POST("/render/tasks", gin.WrapF(handler.CreateRenderTaskHandler))
	v1.POST("/render/jianying-draft", gin.WrapF(handler.ExportJianyingDraft))
	v1.GET("/render/tasks", gin.WrapF(handler.UserRenderTasks))
	v1.GET("/render/tasks/:id", func(c *gin.Context) {
		handler.GetUserRenderTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/render/tasks/:id", func(c *gin.Context) {
		handler.DeleteUserRenderTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/render/tasks/:id/output", func(c *gin.Context) {
		handler.ServeRenderOutput(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/render/local-media", gin.WrapF(handler.StageRenderMedia))
	v1.GET("/drama-assets/manifest", gin.WrapF(handler.DramaAssetManifest))
	v1.PUT("/drama-assets/entry", gin.WrapF(handler.DramaAssetUpsertEntry))
	v1.POST("/drama-assets/review", gin.WrapF(handler.DramaAssetReview))
	v1.POST("/drama-assets/bind", gin.WrapF(handler.DramaAssetBind))
	v1.POST("/drama-assets/file", gin.WrapF(handler.DramaAssetWriteFile))
	v1.GET("/drama-assets/check", gin.WrapF(handler.DramaAssetCheck))
	v1.GET("/drama-assets/file", gin.WrapF(handler.DramaAssetServe))
	v1.GET("/videos/:id", func(c *gin.Context) {
		handler.AIVideo(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/videos/:id/content", func(c *gin.Context) {
		handler.AIVideoContent(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/workflows", gin.WrapF(handler.UserWorkflows))
	v1.POST("/workflows", gin.WrapF(handler.SaveUserWorkflow))
	v1.POST("/workflows/agent-draft", gin.WrapF(handler.DraftUserWorkflow))
	v1.DELETE("/workflows/:id", func(c *gin.Context) {
		handler.DeleteUserWorkflow(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/storage/measure", gin.WrapF(handler.MeasureUserStorageProvider))
	v1.POST("/files", gin.WrapF(handler.UploadFile))
	v1.POST("/files/direct", gin.WrapF(handler.RegisterDirectFile))
	v1.DELETE("/files/:id", func(c *gin.Context) {
		handler.DeleteFile(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/files/:id/record", func(c *gin.Context) {
		handler.DeleteDirectFileRecord(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/user-config", gin.WrapF(handler.UserConfig))
	v1.POST("/user-config/model", gin.WrapF(handler.SaveUserModelConfig))
	v1.POST("/user-config/storage", gin.WrapF(handler.SaveUserStorageProvider))
	v1.GET("/canvas/projects", gin.WrapF(handler.UserCanvasProjects))
	v1.POST("/canvas/projects", gin.WrapF(handler.SaveUserCanvasProject))
	v1.POST("/canvas/projects/sync", gin.WrapF(handler.SyncUserCanvasProjects))
	v1.POST("/canvas/projects/delete", gin.WrapF(handler.DeleteUserCanvasProjects))
	v1.GET("/user-data/image-history", gin.WrapF(handler.UserImageHistory))
	v1.POST("/user-data/image-history", gin.WrapF(handler.SaveUserImageHistory))
	v1.GET("/generation-logs/videos", gin.WrapF(handler.UserVideoGenerationLogs))
	v1.POST("/generation-logs/videos", gin.WrapF(handler.SaveUserVideoGenerationLogs))
	v1.POST("/generation-logs/videos/delete", gin.WrapF(handler.DeleteUserVideoGenerationLogs))
	v1.DELETE("/generation-logs/videos/:id", func(c *gin.Context) {
		handler.DeleteUserVideoGenerationLog(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/generation-logs/images", gin.WrapF(handler.UserImageGenerationLogs))
	v1.POST("/generation-logs/images", gin.WrapF(handler.SaveUserImageGenerationLogs))
	v1.POST("/generation-logs/images/delete", gin.WrapF(handler.DeleteUserImageGenerationLogs))
	v1.DELETE("/generation-logs/images/:id", func(c *gin.Context) {
		handler.DeleteUserImageGenerationLog(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/user-data/assets", gin.WrapF(handler.UserAssetData))
	v1.POST("/user-data/assets", gin.WrapF(handler.SaveUserAssetData))
	v1.GET("/cost/summary", gin.WrapF(handler.UserCostSummary))
	v1.GET("/media-proxy", gin.WrapF(handler.ProxyAuthorizedMedia))
	api.GET("/proxy-image", gin.WrapF(handler.ProxyImage))
	api.GET("/prompts", middleware.OptionalAuth, gin.WrapF(handler.Prompts))
	api.GET("/assets", middleware.OptionalAuth, gin.WrapF(handler.Assets))
	api.POST("/admin/login", gin.WrapF(handler.AdminLogin))

	admin := api.Group("/admin", middleware.AdminAuth)
	admin.GET("/users", gin.WrapF(handler.AdminUsers))
	admin.POST("/users", gin.WrapF(handler.AdminSaveUser))
	admin.POST("/users/:id/credits", func(c *gin.Context) {
		handler.AdminAdjustUserCredits(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/users/:id", func(c *gin.Context) {
		handler.AdminDeleteUser(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/credit-logs", gin.WrapF(handler.AdminCreditLogs))
	admin.POST("/credit-logs", gin.WrapF(handler.AdminSaveCreditLog))
	admin.DELETE("/credit-logs/:id", func(c *gin.Context) {
		handler.AdminDeleteCreditLog(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/ai-logs", gin.WrapF(handler.AdminAICallLogs))
	admin.DELETE("/ai-logs", gin.WrapF(handler.AdminDeleteAICallLogs))
	admin.GET("/settings", gin.WrapF(handler.AdminSettings))
	admin.POST("/render/ffmpeg-path", gin.WrapF(handler.SaveRenderFFmpegPath))
	admin.POST("/settings", gin.WrapF(handler.AdminSaveSettings))
	admin.POST("/settings/channel-models", gin.WrapF(handler.AdminChannelModels))
	admin.POST("/settings/channel-test", gin.WrapF(handler.AdminTestChannelModel))
	admin.POST("/storage/measure", gin.WrapF(handler.AdminMeasureStorageProvider))
	admin.GET("/prompt-categories", gin.WrapF(handler.AdminPromptCategories))
	admin.POST("/prompt-categories/sync", gin.WrapF(handler.AdminSyncPromptCategories))
	admin.POST("/prompt-categories/sync-all", gin.WrapF(handler.AdminSyncAllPromptCategories))
	admin.GET("/prompts", gin.WrapF(handler.AdminPrompts))
	admin.POST("/prompts", gin.WrapF(handler.AdminSavePrompt))
	admin.POST("/prompts/batch-delete", gin.WrapF(handler.AdminDeletePrompts))
	admin.DELETE("/prompts/:id", func(c *gin.Context) {
		handler.AdminDeletePrompt(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/assets", gin.WrapF(handler.AdminAssets))
	admin.POST("/assets", gin.WrapF(handler.AdminSaveAsset))
	admin.DELETE("/assets/:id", func(c *gin.Context) {
		handler.AdminDeleteAsset(c.Writer, c.Request, c.Param("id"))
	})

	if webui.Enabled() {
		router.NoRoute(spaHandler(webui.FS()))
	} else {
		router.NoRoute(middleware.NotFoundJSON)
	}

	return router
}

// spaHandler 托管内嵌的前端静态资源：无扩展名路径优先命中同名页面 html，
// 其次直接读取普通文件返回（不经 net/http FileServer，避免 */index.html 被 301），
// 目录命中时尝试其 index.html，非 /api 前缀的其余路径回退主站 index.html，
// /api 未命中仍返回 JSON 404。
func spaHandler(uiFS fs.FS) gin.HandlerFunc {
	indexHTML, err := fs.ReadFile(uiFS, "index.html")
	if err != nil {
		panic(err)
	}
	return func(c *gin.Context) {
		requestPath := c.Request.URL.Path
		if requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") {
			middleware.NotFoundJSON(c)
			return
		}
		name := strings.TrimPrefix(requestPath, "/")
		if name != "" && !strings.Contains(name, ".") {
			if page, err := fs.ReadFile(uiFS, name+".html"); err == nil {
				c.Data(http.StatusOK, "text/html; charset=utf-8", page)
				return
			}
		}
		if name != "" {
			if data, err := fs.ReadFile(uiFS, name); err == nil {
				c.Data(http.StatusOK, embeddedContentType(name), data)
				return
			}
			if data, err := fs.ReadFile(uiFS, path.Join(name, "index.html")); err == nil {
				c.Data(http.StatusOK, "text/html; charset=utf-8", data)
				return
			}
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	}
}

// embeddedContentType 按扩展名推断 MIME，未知类型按二进制流返回。
func embeddedContentType(name string) string {
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		return "application/octet-stream"
	}
	if strings.HasPrefix(contentType, "text/") && !strings.Contains(contentType, "charset") {
		contentType += "; charset=utf-8"
	}
	return contentType
}
