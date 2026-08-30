package mcpadapter

import (
	"context"
	"encoding/json"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// newMCPServer 构建 STDIO MCP 服务器（serverInfo 同 drama-mcp.mjs：drama-bridge 0.1.0）：
// tools/list 返回工具表，tools/call 全部透传 hub.callPage。
// 启用输入 schema 校验，与 node 版 zod 校验对等：非法参数直接报 -32602，而不是透传后被页面静默 clamp。
func newMCPServer(hub *Hub) *server.MCPServer {
	srv := server.NewMCPServer("drama-bridge", "0.1.0", server.WithInputSchemaValidation())
	for _, def := range toolDefs {
		tool := mcp.NewToolWithRawSchema(def.name, def.description, json.RawMessage(def.inputSchema))
		srv.AddTool(tool, makeToolHandler(hub, def.name))
	}
	return srv
}

// makeToolHandler 结果封装与 drama-mcp.mjs 一致：
// 成功 {content:[{type:"text",text:格式化 JSON 字符串}]}，失败同结构 + isError
func makeToolHandler(hub *Hub, name string) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := request.GetArguments()
		data, err := hub.callPage(name, args)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		text, _ := json.MarshalIndent(data, "", "  ")
		return mcp.NewToolResultText(string(text)), nil
	}
}
