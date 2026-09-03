package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/pelletier/go-toml/v2"
)

const (
	chatGPTMCPKey  = "infinite-canvas-drama"
	chatGPTMCPPort = 9802
)

var chatGPTChannelMu sync.Mutex

type ChatGPTChannelState struct {
	Supported      bool   `json:"supported"`
	Registered     bool   `json:"registered"`
	Mode           string `json:"mode"` // "exe" | "node" | "unsupported"
	McpConfigPath  string `json:"mcpConfigPath"`
	CodexCLIPath   string `json:"codexCliPath"`
	ExecutablePath string `json:"executablePath"`
	Port           int    `json:"port"`
}

type codexMCPConfig struct {
	MCPServers map[string]codexMCPEntry `toml:"mcp_servers"`
}

type codexMCPEntry struct {
	Command string   `toml:"command"`
	Args    []string `toml:"args"`
}

func chatGPTConfigPath() (string, error) {
	if root := strings.TrimSpace(os.Getenv("CODEX_HOME")); root != "" {
		return filepath.Join(root, "config.toml"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", safeMessageError{message: fmt.Sprintf("无法获取用户主目录：%v", err)}
	}
	return filepath.Join(home, ".codex", "config.toml"), nil
}

func codexCLIPath() string {
	name := "codex"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if path, err := exec.LookPath(name); err == nil {
		return path
	}
	if runtime.GOOS != "windows" {
		return ""
	}
	localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if localAppData == "" {
		return ""
	}
	patterns := []string{
		filepath.Join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"),
		filepath.Join(localAppData, "OpenAI", "Codex", "bin", "*", "codex.exe"),
	}
	var newest string
	var newestTime time.Time
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		for _, match := range matches {
			info, err := os.Stat(match)
			if err == nil && (newest == "" || info.ModTime().After(newestTime)) {
				newest, newestTime = match, info.ModTime()
			}
		}
	}
	return newest
}

func chatGPTAdapterCommand(token string) (string, []string, string, error) {
	mode, mjsPath, err := qoderMode()
	if err != nil {
		return "", nil, "unsupported", err
	}
	if mode == "unsupported" {
		return "", nil, mode, safeMessageError{message: "当前为开发模式且缺少 mcp-adapter/drama-mcp.mjs，请用编译后的 exe 或补齐适配器脚本"}
	}
	if mode == "node" {
		return "node", []string{mjsPath, "--token", token, "--port", fmt.Sprint(chatGPTMCPPort)}, mode, nil
	}
	if adapter := qoderStandaloneAdapterPath(); adapter != "" {
		return adapter, []string{"--token", token, "--port", fmt.Sprint(chatGPTMCPPort)}, mode, nil
	}
	exePath, err := qoderExecutablePath()
	if err != nil {
		return "", nil, mode, err
	}
	return exePath, []string{"mcp-adapter", "--token", token, "--port", fmt.Sprint(chatGPTMCPPort)}, mode, nil
}

func isDramaCodexEntry(entry codexMCPEntry) bool {
	if strings.Contains(entry.Command, "drama-mcp") {
		return true
	}
	for _, arg := range entry.Args {
		if strings.Contains(arg, "mcp-adapter") || strings.Contains(arg, "drama-mcp") {
			return true
		}
	}
	return false
}

func sameCodexEntry(entry codexMCPEntry, command string, args []string) bool {
	if entry.Command != command || len(entry.Args) != len(args) {
		return false
	}
	for index := range args {
		if entry.Args[index] != args[index] {
			return false
		}
	}
	return true
}

func readCodexMCPEntry(path string) (codexMCPEntry, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return codexMCPEntry{}, false, nil
	}
	if err != nil {
		return codexMCPEntry{}, false, err
	}
	var config codexMCPConfig
	if err := toml.Unmarshal(data, &config); err != nil {
		return codexMCPEntry{}, false, safeMessageError{message: fmt.Sprintf("%s 不是有效的 TOML，请先在 ChatGPT/Codex 设置中修复", path)}
	}
	entry, ok := config.MCPServers[chatGPTMCPKey]
	return entry, ok, nil
}

func ChatGPTChannelStatus() (*ChatGPTChannelState, error) {
	chatGPTChannelMu.Lock()
	defer chatGPTChannelMu.Unlock()
	return chatGPTChannelStatusLocked()
}

func chatGPTChannelStatusLocked() (*ChatGPTChannelState, error) {
	configPath, err := chatGPTConfigPath()
	if err != nil {
		return nil, err
	}
	exePath, _ := qoderExecutablePath()
	mode, _, modeErr := qoderMode()
	cliPath := codexCLIPath()
	state := &ChatGPTChannelState{
		Supported:      modeErr == nil && mode != "unsupported" && cliPath != "",
		Mode:           mode,
		McpConfigPath:  configPath,
		CodexCLIPath:   cliPath,
		ExecutablePath: exePath,
		Port:           chatGPTMCPPort,
	}
	entry, ok, err := readCodexMCPEntry(configPath)
	if err != nil {
		return state, err
	}
	state.Registered = ok && isDramaCodexEntry(entry)
	return state, nil
}

func runCodexMCP(cliPath, token string, args ...string) error {
	output, err := exec.Command(cliPath, args...).CombinedOutput()
	if err == nil {
		return nil
	}
	message := string(output)
	if token != "" {
		message = strings.ReplaceAll(message, token, "******")
	}
	message = strings.TrimSpace(message)
	if len(message) > 1000 {
		message = message[:1000]
	}
	if message == "" {
		message = err.Error()
	}
	return safeMessageError{message: fmt.Sprintf("ChatGPT/Codex MCP 配置失败：%s", message)}
}

func ChatGPTChannelApply(enabled bool, token string) (*ChatGPTChannelState, error) {
	chatGPTChannelMu.Lock()
	defer chatGPTChannelMu.Unlock()
	if enabled && strings.TrimSpace(token) == "" {
		return nil, safeMessageError{message: "启用 ChatGPT 桌面通道时必须提供 Token"}
	}
	configPath, err := chatGPTConfigPath()
	if err != nil {
		return nil, err
	}
	cliPath := codexCLIPath()
	if cliPath == "" {
		return nil, safeMessageError{message: "未检测到 Codex CLI，无法自动写入 ChatGPT 桌面端共享的 MCP 配置"}
	}
	entry, exists, err := readCodexMCPEntry(configPath)
	if err != nil {
		return nil, err
	}
	if exists && !isDramaCodexEntry(entry) {
		return nil, safeMessageError{message: fmt.Sprintf("MCP 名称 %s 已被其他配置占用，请先在 ChatGPT/Codex 中处理", chatGPTMCPKey)}
	}
	if !enabled {
		if exists {
			if err := runCodexMCP(cliPath, token, "mcp", "remove", chatGPTMCPKey); err != nil {
				return nil, err
			}
		}
		return chatGPTChannelStatusLocked()
	}
	command, args, _, err := chatGPTAdapterCommand(token)
	if err != nil {
		return nil, err
	}
	if exists && sameCodexEntry(entry, command, args) {
		return chatGPTChannelStatusLocked()
	}
	if exists {
		if err := runCodexMCP(cliPath, token, "mcp", "remove", chatGPTMCPKey); err != nil {
			return nil, err
		}
	}
	cliArgs := append([]string{"mcp", "add", chatGPTMCPKey, "--", command}, args...)
	if err := runCodexMCP(cliPath, token, cliArgs...); err != nil {
		return nil, err
	}
	return chatGPTChannelStatusLocked()
}
