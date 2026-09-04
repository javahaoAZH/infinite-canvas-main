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
		server.WithInstructions("此服务器控制用户当前打开的无限画布漫剧工作区。小说原文是事实源；先建立覆盖台账与含角色、场景、道具、特效、风格、声音的全量资产圣经。每项资产记录参考职责、生图提示词、禁止变化和逐图验收项。四视图只锁体型服装轮廓；人物进入表演或分镜前必须确认面部身份控制包。每镜必须有原文证据、唯一职责、出场角色、起止状态、连续性、首帧/动态提示词、质检和完整 assetRefs；每个引用标注身份/结构/姿态构图/场景空间/道具结构/风格/特效合成/声音职责、主次及精确文件。主身份参考必须实际进入生成请求，辅助参考不得覆盖身份。参考预算依次优先主身份、对应角度/姿态、场景/核心道具、风格/特效；超限先制作布局帧，禁止静默截断。表演资产必须绑定原文场景、动作、视线、接触道具、光源和前后状态；表情只改软组织与行为，禁止骨相漂移。复杂图按身份→姿态构图→场景道具→光色单变量迭代。失败稿不得绑定或成为后续参考；审查、开工检查和代表帧人工确认未通过时禁止批量生产。"),
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
		"drama_review_shots": true, "drama_get_production_gates": true, "drama_get_production_status": true, "drama_get_render_status": true,
		"drama_asset_list": true, "drama_episode_check": true,
	}[name]
	destructive := map[string]bool{
		"drama_apply_shots": true, "drama_control_production": true,
		"drama_api_request": true, "drama_inject_image": true,
		"drama_reset_workspace": true,
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
