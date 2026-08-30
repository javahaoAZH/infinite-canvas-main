package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const qoderMCPKey = "drama-mcp"

var (
	qoderChannelMu sync.Mutex
	utf8BOM        = []byte{0xEF, 0xBB, 0xBF}
)

type QoderChannelState struct {
	Supported      bool   `json:"supported"`
	Registered     bool   `json:"registered"`
	Mode           string `json:"mode"` // "exe" | "node" | "unsupported"
	McpJsonPath    string `json:"mcpJsonPath"`
	ExecutablePath string `json:"executablePath"`
}

func qoderExecutablePath() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", safeMessageError{message: fmt.Sprintf("无法获取可执行文件路径：%v", err)}
	}
	if resolved, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolved
	}
	return exePath, nil
}

func qoderMcpJsonPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", safeMessageError{message: fmt.Sprintf("无法获取用户主目录：%v", err)}
	}
	return filepath.Join(home, ".qoder", "mcp.json"), nil
}

// qoderAdapterMjsPath 返回相对当前工作目录的 mcp-adapter/drama-mcp.mjs（存在时才返回）。
func qoderAdapterMjsPath() string {
	mjs := filepath.Join("mcp-adapter", "drama-mcp.mjs")
	if _, err := os.Stat(mjs); err != nil {
		return ""
	}
	abs, err := filepath.Abs(mjs)
	if err != nil {
		return mjs
	}
	return abs
}

// qoderMode 判定注册模式：编译后的 exe、go run 开发模式下的 node、或不支持。
func qoderMode() (mode string, mjsPath string, err error) {
	exePath, err := qoderExecutablePath()
	if err != nil {
		return "", "", err
	}
	if !strings.Contains(exePath, "go-build") {
		return "exe", "", nil
	}
	mjsPath = qoderAdapterMjsPath()
	if mjsPath == "" {
		return "unsupported", "", nil
	}
	return "node", mjsPath, nil
}

// readQoderMcpJSON 读取 mcp.json 并剥离 UTF-8 BOM（Windows PowerShell 常见产物）后返回原始内容。
func readQoderMcpJSON(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return bytes.TrimPrefix(data, utf8BOM), nil
}

func isDramaMCPEntry(entry any) bool {
	obj, ok := entry.(map[string]any)
	if !ok {
		return false
	}
	args, _ := obj["args"].([]any)
	for _, arg := range args {
		value, _ := arg.(string)
		if strings.Contains(value, "mcp-adapter") || strings.Contains(value, "drama-mcp") {
			return true
		}
	}
	return false
}

// sameQoderEntry 判断已有条目是否与给定的 command/args 完全一致。
func sameQoderEntry(existing any, command string, args []string) bool {
	obj, ok := existing.(map[string]any)
	if !ok {
		return false
	}
	if cmd, _ := obj["command"].(string); cmd != command {
		return false
	}
	existingArgs, _ := obj["args"].([]any)
	if len(existingArgs) != len(args) {
		return false
	}
	for i, arg := range existingArgs {
		if value, _ := arg.(string); value != args[i] {
			return false
		}
	}
	return true
}

func QoderChannelStatus() (*QoderChannelState, error) {
	qoderChannelMu.Lock()
	defer qoderChannelMu.Unlock()
	return qoderChannelStatusLocked()
}

// qoderChannelStatusLocked 在已持有 qoderChannelMu 时读取状态。
func qoderChannelStatusLocked() (*QoderChannelState, error) {
	mcpJsonPath, err := qoderMcpJsonPath()
	if err != nil {
		return nil, err
	}
	exePath, _ := qoderExecutablePath()
	mode, _, err := qoderMode()
	if err != nil {
		return nil, err
	}
	status := &QoderChannelState{
		Supported:      mode != "unsupported",
		Mode:           mode,
		McpJsonPath:    mcpJsonPath,
		ExecutablePath: exePath,
	}
	data, err := readQoderMcpJSON(mcpJsonPath)
	if err != nil {
		return status, nil
	}
	var config map[string]any
	if json.Unmarshal(data, &config) != nil {
		return status, nil
	}
	servers, _ := config["mcpServers"].(map[string]any)
	status.Registered = isDramaMCPEntry(servers[qoderMCPKey])
	return status, nil
}

func QoderChannelApply(enabled bool, token string) (*QoderChannelState, error) {
	qoderChannelMu.Lock()
	defer qoderChannelMu.Unlock()

	if enabled && strings.TrimSpace(token) == "" {
		return nil, safeMessageError{message: "启用 Qoder 通道时必须提供 Token"}
	}
	mcpJsonPath, err := qoderMcpJsonPath()
	if err != nil {
		return nil, err
	}
	mode, mjsPath, err := qoderMode()
	if err != nil {
		return nil, err
	}
	if mode == "unsupported" {
		return nil, safeMessageError{message: "当前为开发模式且缺少 mcp-adapter/drama-mcp.mjs，请用编译后的 exe 或手动注册"}
	}

	config := map[string]any{"mcpServers": map[string]any{}}
	data, err := readQoderMcpJSON(mcpJsonPath)
	if err == nil {
		if json.Unmarshal(data, &config) != nil {
			backupPath := mcpJsonPath + ".bak"
			_ = os.WriteFile(backupPath, data, 0o644)
			return nil, safeMessageError{message: fmt.Sprintf("%s 不是有效的 JSON，已备份为 %s，请手动修复后再试", mcpJsonPath, backupPath)}
		}
	} else if !os.IsNotExist(err) {
		return nil, safeMessageError{message: fmt.Sprintf("读取 %s 失败：%v", mcpJsonPath, err)}
	}

	servers, ok := config["mcpServers"].(map[string]any)
	if !ok {
		servers = map[string]any{}
		config["mcpServers"] = servers
	}

	if enabled {
		command := "node"
		args := []string{mjsPath, "--token", token}
		if mode == "exe" {
			exePath, err := qoderExecutablePath()
			if err != nil {
				return nil, err
			}
			command = exePath
			args = []string{"mcp-adapter", "--token", token}
		}
		// Qoder 热加载对同 key 原地修改 args（如令牌重写）不敏感，不会重启适配器；
		// 因此已有条目需要更新时，先写一次删除该 key 的版本，再写新条目版本，
		// 让 Qoder 按“删除 + 新增”处理以触发热加载；条目相同则保持单次写入。
		existing := servers[qoderMCPKey]
		if isDramaMCPEntry(existing) && !sameQoderEntry(existing, command, args) {
			delete(servers, qoderMCPKey)
			if err := writeAtomicJSON(mcpJsonPath, config); err != nil {
				return nil, safeMessageError{message: fmt.Sprintf("写入 %s 失败：%v", mcpJsonPath, err)}
			}
		}
		servers[qoderMCPKey] = map[string]any{"command": command, "args": args}
	} else if isDramaMCPEntry(servers[qoderMCPKey]) {
		delete(servers, qoderMCPKey)
	}

	if err := writeAtomicJSON(mcpJsonPath, config); err != nil {
		return nil, safeMessageError{message: fmt.Sprintf("写入 %s 失败：%v", mcpJsonPath, err)}
	}
	return qoderChannelStatusLocked()
}

func writeAtomicJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".mcp.json.tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	// Qoder 对 mcp.json 的文件监控只响应“原位修改”事件，不响应临时文件 + rename 事件；
	// rename 已保证内容原子到位，这里再对同一文件原位写一遍相同内容，仅用于触发 Qoder 热加载。
	// 原位写失败可忽略（数据已由 rename 写入，不会丢失）。
	_ = os.WriteFile(path, data, 0o644)
	return nil
}
