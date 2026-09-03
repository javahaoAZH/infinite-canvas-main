package mcpadapter

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// newMCPServer 构建 STDIO MCP 服务器（serverInfo 同 drama-mcp.mjs：drama-bridge 0.1.0）：
// tools/list 返回工具表，tools/call 全部透传 hub.callPage。
// 启用输入 schema 校验，与 node 版 zod 校验对等：非法参数直接报 -32602，而不是透传后被页面静默 clamp。
func newMCPServer(hub *Hub) *server.MCPServer {
	srv := server.NewMCPServer(
		"drama-bridge",
		"0.1.0",
		server.WithInputSchemaValidation(),
		server.WithInstructions("此服务器控制用户当前打开的无限画布漫剧工作区。修改项目前先读取项目并确认 projectId；整包替换分镜前先告知用户会清空已有媒体。启动批量生产或成片会调用外部模型并可能产生费用，应先确认范围。优先遵循 drama_get_skills 返回的制作规范。"),
	)
	for _, def := range toolDefs {
		tool := mcp.NewToolWithRawSchema(def.name, def.description, json.RawMessage(def.inputSchema))
		tool.Annotations = toolAnnotations(def.name)
		srv.AddTool(tool, makeToolHandler(hub, def.name))
	}
	return srv
}

func toolAnnotations(name string) mcp.ToolAnnotation {
	readOnly := map[string]bool{
		"drama_list_projects": true, "drama_get_project": true, "drama_get_skills": true,
		"drama_review_shots": true, "drama_get_production_status": true, "drama_get_render_status": true,
		"drama_asset_list": true, "drama_episode_check": true,
	}[name]
	destructive := map[string]bool{
		"drama_apply_shots": true, "drama_control_production": true,
		"drama_api_request": true, "drama_inject_image": true,
	}[name]
	openWorld := map[string]bool{
		"drama_start_production": true, "drama_control_production": true,
		"drama_start_render": true, "drama_api_request": true,
	}[name]
	return mcp.ToolAnnotation{
		ReadOnlyHint:    mcp.ToBoolPtr(readOnly),
		DestructiveHint: mcp.ToBoolPtr(destructive),
		OpenWorldHint:   mcp.ToBoolPtr(openWorld),
	}
}

// 本地文件 → base64 dataUrl 预处理（与 drama-mcp.mjs 一致，Go 透传版缺失会导致页面收到空 blob）：
// drama_asset_bind 的 files（本地路径数组）→ [{name,dataUrl}]；drama_inject_image 的 file（本地路径）→ dataUrl。
func preprocessArgs(name string, args map[string]any) (map[string]any, error) {
	switch name {
	case "drama_asset_bind":
		raw, ok := args["files"].([]any)
		if !ok {
			return args, nil
		}
		payloads := make([]any, 0, len(raw))
		for _, item := range raw {
			path, _ := item.(string)
			data, err := os.ReadFile(path)
			if err != nil {
				return nil, fmt.Errorf("读取本地产物失败：%s", path)
			}
			payloads = append(payloads, map[string]any{"name": filepath.Base(path), "dataUrl": "data:" + mimeByExt(path) + ";base64," + base64.StdEncoding.EncodeToString(data)})
		}
		args["files"] = payloads
	case "drama_inject_image":
		path, _ := args["file"].(string)
		if path == "" {
			return args, nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("读取本地图片失败：%s", path)
		}
		args["dataUrl"] = "data:" + mimeByExt(path) + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	return args, nil
}

func mimeByExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

// makeToolHandler 结果封装与 drama-mcp.mjs 一致：
// 成功 {content:[{type:"text",text:格式化 JSON 字符串}]}，失败同结构 + isError
func makeToolHandler(hub *Hub, name string) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args, perr := preprocessArgs(name, request.GetArguments())
		if perr != nil {
			return mcp.NewToolResultError(perr.Error()), nil
		}
		data, err := hub.callPage(name, args)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		text, _ := json.MarshalIndent(data, "", "  ")
		return mcp.NewToolResultText(string(text)), nil
	}
}
