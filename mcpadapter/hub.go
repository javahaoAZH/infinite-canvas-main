package mcpadapter

// Qoder ↔ AI 漫剧软件 MCP 适配器的 Go 端口（行为逐行对照 mcp-adapter/drama-mcp.mjs）：
//   Qoder(MCP 客户端) --STDIO--> 本适配器 --WebSocket(127.0.0.1:9801)--> 漫剧页面（drama-bridge.ts）

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	// 单次工具调用超时，与 drama-mcp.mjs CALL_TIMEOUT_MS 一致
	callTimeout = 120 * time.Second
	// 页面未连接时的中文错误，与 drama-mcp.mjs PAGE_NOT_CONNECTED 一致
	pageNotConnected = "漫剧页面未连接：请打开漫剧页面并开启「Qoder 通道」开关"
)

// 放行 Origin 校验：本服务仅绑定 127.0.0.1 回环地址，且页面连接需通过 hello 令牌门禁（不匹配时 4401 关闭），
// 安全姿态与不校验 Origin 的 node 版适配器（drama-mcp.mjs）一致；
// 浏览器 Origin（http://localhost:8080）与 Host（127.0.0.1:9801）不一致时若用默认校验会被 403 拒绝。
var upgrader = websocket.Upgrader{
	CheckOrigin: func(*http.Request) bool { return true },
}

// 页面入站消息（drama-bridge.ts 协议：hello / result）
type pageInbound struct {
	Type  string          `json:"type"`
	Token string          `json:"token"`
	ID    string          `json:"id"`
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error json.RawMessage `json:"error"`
}

// 一次调用等待页面返回的结果
type pageResult struct {
	ok    bool
	data  json.RawMessage
	errTx string
}

// 进行中的工具调用：等待结果 + 超时定时器
type pendingCall struct {
	respCh chan pageResult
	timer  *time.Timer
}

// Hub 管理漫剧页面 WebSocket 连接（同一时间只保留最新一条，新页面接入会顶掉旧页面）
type Hub struct {
	token string

	mu       sync.Mutex
	page     *websocket.Conn
	pageMu   sync.Mutex // 串行化对页面连接的写入
	pending  map[string]*pendingCall
	listener net.Listener
}

func newHub(token string) *Hub {
	return &Hub{token: token, pending: make(map[string]*pendingCall)}
}

// listenAndServe 在 127.0.0.1:port 监听页面连接，失败由上层中文报错退出
func (h *Hub) listenAndServe(port int) error {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err
	}
	h.listener = listener
	go http.Serve(listener, http.HandlerFunc(h.serveConn))
	return nil
}

func (h *Hub) serveConn(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	go h.readPump(conn)
}

func (h *Hub) readPump(conn *websocket.Conn) {
	defer conn.Close()
	authed := false
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg pageInbound
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}
		if !authed {
			if msg.Type == "hello" && msg.Token == h.token {
				authed = true
				if old := h.swapPage(conn); old != nil {
					// 新认证页面顶替旧页面
					h.writeClose(old, websocket.FormatCloseMessage(4400, "已有新的页面连接"))
					old.Close()
				}
				h.writeJSON(conn, map[string]any{"type": "ready"})
			} else {
				h.writeClose(conn, websocket.FormatCloseMessage(4401, "令牌不匹配"))
				return
			}
			continue
		}
		if msg.Type == "result" && msg.ID != "" {
			h.finishCall(msg)
		}
	}
	// 连接关闭：若为当前页面连接则清空槽位并拒绝全部进行中调用（同 mjs；被顶替的旧页面不触发）
	h.mu.Lock()
	isPage := h.page == conn
	if isPage {
		h.page = nil
	}
	h.mu.Unlock()
	if isPage {
		h.drainPending("漫剧页面连接已断开")
	}
}

func (h *Hub) swapPage(conn *websocket.Conn) *websocket.Conn {
	h.mu.Lock()
	defer h.mu.Unlock()
	old := h.page
	h.page = conn
	return old
}

// writeClose 发送关闭帧（4400/4401/1001）
func (h *Hub) writeClose(conn *websocket.Conn, payload []byte) {
	h.pageMu.Lock()
	defer h.pageMu.Unlock()
	conn.WriteMessage(websocket.CloseMessage, payload)
}

func (h *Hub) writeJSON(conn *websocket.Conn, message any) {
	h.pageMu.Lock()
	defer h.pageMu.Unlock()
	conn.WriteJSON(message)
}

// finishCall 处理页面返回的 result 消息
func (h *Hub) finishCall(msg pageInbound) {
	h.mu.Lock()
	call := h.pending[msg.ID]
	if call == nil {
		h.mu.Unlock()
		return
	}
	delete(h.pending, msg.ID)
	h.mu.Unlock()
	if call.timer != nil {
		call.timer.Stop()
	}
	errText := ""
	if len(msg.Error) > 0 {
		json.Unmarshal(msg.Error, &errText)
	}
	call.respCh <- pageResult{ok: msg.OK, data: msg.Data, errTx: errText}
}

// callPage 工具调用转发到页面并等待结果（120 秒超时；页面未连接直接报中文错误）
func (h *Hub) callPage(tool string, args map[string]any) (json.RawMessage, error) {
	h.mu.Lock()
	page := h.page
	if page == nil {
		h.mu.Unlock()
		return nil, errors.New(pageNotConnected)
	}
	id := uuid.NewString()
	call := &pendingCall{respCh: make(chan pageResult, 1)}
	h.pending[id] = call
	h.mu.Unlock()

	call.timer = time.AfterFunc(callTimeout, func() {
		h.mu.Lock()
		if h.pending[id] != call {
			h.mu.Unlock()
			return
		}
		delete(h.pending, id)
		h.mu.Unlock()
		call.respCh <- pageResult{errTx: fmt.Sprintf("工具调用超时（%d 秒）：%s", int(callTimeout.Seconds()), tool)}
	})

	if args == nil {
		args = map[string]any{}
	}
	h.pageMu.Lock()
	err := page.WriteJSON(map[string]any{"type": "call", "id": id, "tool": tool, "args": args})
	h.pageMu.Unlock()
	if err != nil {
		h.removeCall(id, call)
		return nil, errors.New(pageNotConnected)
	}

	result := <-call.respCh
	if !result.ok {
		text := result.errTx
		if text == "" {
			text = "工具执行失败"
		}
		return nil, errors.New(text)
	}
	if result.data == nil {
		return []byte("null"), nil
	}
	return result.data, nil
}

func (h *Hub) removeCall(id string, call *pendingCall) {
	h.mu.Lock()
	if h.pending[id] == call {
		delete(h.pending, id)
	}
	h.mu.Unlock()
	if call.timer != nil {
		call.timer.Stop()
	}
}

// drainPending 拒绝全部进行中的调用（页面断开 / 退出时）
func (h *Hub) drainPending(errText string) {
	h.mu.Lock()
	pending := h.pending
	h.pending = make(map[string]*pendingCall)
	h.mu.Unlock()
	for _, call := range pending {
		if call.timer != nil {
			call.timer.Stop()
		}
		select {
		case call.respCh <- pageResult{errTx: errText}:
		default:
		}
	}
}

// shutdown 优雅退出：关监听、以 1001 关闭页面连接、拒绝全部进行中的调用
func (h *Hub) shutdown() {
	if h.listener != nil {
		h.listener.Close()
	}
	h.mu.Lock()
	page := h.page
	h.page = nil
	h.mu.Unlock()
	if page != nil {
		h.writeClose(page, websocket.FormatCloseMessage(1001, ""))
		page.Close()
	}
	h.drainPending("漫剧页面连接已断开")
}
