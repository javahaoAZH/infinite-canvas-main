// Qoder ↔ 漫剧软件通信桥（页面侧 WS 客户端）：模块级单例，管理到本地适配器（ws://127.0.0.1:9801）的
// 连接 / 自动重连 / 状态订阅；适配器下发的工具调用由 BRIDGE_TOOLS 处理器执行——只读写 Zustand store
// 与 services（不碰 React），页面 UI 经 store 订阅实时刷新。配置（enabled/token/adapterPath）存 localStorage（极小配置）。
import { nanoid } from "nanoid";

import { ART_STYLES, DRAMA_SKILL_CATALOG, GENRE_CARDS, SCENE_PRESETS, resolveArtStyleLabel } from "@/app/(user)/drama/prompts";
import { notifyDataChanged, registerRefresh } from "@/app/(user)/drama/services/bridge-refresh";
import { applyStructuredScript, createDramaRender, updateDramaShots } from "@/app/(user)/drama/services/drama-generation";
import { reviewShots } from "@/app/(user)/drama/services/drama-review";
import { DEFAULT_DIRECTOR_OPTIONS } from "@/app/(user)/drama/services/director-planner";
import { maybeRestartDirector, startDirector } from "@/app/(user)/drama/services/director-runner";
import { apiGet, apiPost } from "@/services/api/request";
import { getRenderTask, type RenderTaskResponse } from "@/services/api/render";
import { getEffectiveConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useDirectorStore, type DirectorPlanOptions } from "@/stores/use-director-store";
import { useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useUserStore } from "@/stores/use-user-store";

export type BridgeStatus = "disconnected" | "connecting" | "connected";
export type BridgeRegistered = "ok" | "failed" | "";
export type DramaBridgeConfig = { enabled: boolean; token: string; adapterPath: string };
export type BridgeSnapshot = { enabled: boolean; status: BridgeStatus; registered: BridgeRegistered; registerError: string };
export type QoderChannelStatus = { supported: boolean; registered: boolean; mode: "exe" | "node" | "unsupported"; mcpJsonPath: string; executablePath: string };

// 查询后端自动注册状态（公共接口，无需登录态）
export function fetchQoderChannelStatus() {
    return apiGet<QoderChannelStatus>("/api/qoder-channel/status");
}

const BRIDGE_STORAGE_KEY = "infinite-canvas:drama_bridge";
const BRIDGE_WS_URL = "ws://127.0.0.1:9801";
const RECONNECT_INTERVAL_MS = 3000;
// drama_api_request 限制：请求体 ≤2MB，响应序列化 >1MB 截断
const API_REQUEST_MAX_BODY_BYTES = 2 * 1024 * 1024;
const API_RESPONSE_MAX_CHARS = 1024 * 1024;

type BridgeInboundMessage = { type?: string; id?: string; tool?: string; args?: Record<string, unknown> };

// ---- 配置读写 ----

export function loadBridgeConfig(): DramaBridgeConfig {
    if (typeof window === "undefined") return { enabled: false, token: "", adapterPath: "" };
    try {
        const parsed = JSON.parse(window.localStorage.getItem(BRIDGE_STORAGE_KEY) || "{}") as Partial<DramaBridgeConfig>;
        return {
            enabled: parsed.enabled === true,
            token: typeof parsed.token === "string" ? parsed.token : "",
            adapterPath: typeof parsed.adapterPath === "string" ? parsed.adapterPath : "",
        };
    } catch {
        return { enabled: false, token: "", adapterPath: "" };
    }
}

function saveBridgeConfig(config: DramaBridgeConfig) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(config));
}

function generateToken(): string {
    // 随机令牌：优先 crypto.randomUUID（安全上下文），非安全上下文（http 局域网）回退 nanoid
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nanoid(32);
}

// ---- 连接管理（模块级单例） ----

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectWanted = false;
let status: BridgeStatus = "disconnected";
// 自动注册（后端写 ~/.qoder/mcp.json）结果：fire-and-forget 请求回填，经 notify() 暴露给 UI
let registered: BridgeRegistered = "";
let registerError = "";
// 最近一次成片任务（内存态）：drama_get_project 的 renderUrl 从这里取，仅 http(s) 返回
let lastRenderTask: RenderTaskResponse | null = null;
const listeners = new Set<(snapshot: BridgeSnapshot) => void>();

export function getBridgeSnapshot(): BridgeSnapshot {
    return { enabled: connectWanted, status, registered, registerError };
}

export function onBridgeStatusChange(listener: (snapshot: BridgeSnapshot) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notify() {
    const snapshot = getBridgeSnapshot();
    listeners.forEach((listener) => listener(snapshot));
}

function setStatus(next: BridgeStatus) {
    if (status === next) return;
    status = next;
    notify();
}

function scheduleReconnect() {
    if (!connectWanted || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openSocket();
    }, RECONNECT_INTERVAL_MS);
}

function closeSocket() {
    if (!socket) return;
    const ws = socket;
    socket = null;
    try {
        ws.close();
    } catch {
        // 忽略关闭异常
    }
}

function openSocket() {
    if (typeof window === "undefined" || !connectWanted) return;
    const { token } = loadBridgeConfig();
    if (!token) return;
    setStatus("connecting");
    let ws: WebSocket;
    try {
        ws = new WebSocket(BRIDGE_WS_URL);
    } catch {
        scheduleReconnect();
        return;
    }
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, client: "infinite-canvas-drama", version: 1 }));
    ws.onmessage = (event) => {
        let message: BridgeInboundMessage;
        try {
            message = JSON.parse(String(event.data)) as BridgeInboundMessage;
        } catch {
            return;
        }
        if (message.type === "ready") {
            setStatus("connected");
            return;
        }
        if (message.type === "call" && message.id && message.tool) void handleCall(ws, message.id, message.tool, message.args || {});
    };
    ws.onclose = () => {
        if (socket === ws) socket = null;
        setStatus("disconnected");
        scheduleReconnect();
    };
    ws.onerror = () => {
        // 连接失败由 onclose 统一走重连
    };
}

// fire-and-forget 自动注册：请求结果写入快照 registered/registerError；开关行为本身不依赖该请求成功
function requestQoderChannelRegistration(enabled: boolean, token: string) {
    void apiPost<QoderChannelStatus>("/api/qoder-channel", { enabled, token })
        .then(() => {
            registered = enabled ? "ok" : "";
            registerError = "";
            notify();
        })
        .catch((error) => {
            registered = "failed";
            registerError = error instanceof Error && error.message ? error.message : "注册请求失败";
            notify();
        });
}

export function setBridgeEnabled(enabled: boolean) {
    const config = loadBridgeConfig();
    if (enabled && !config.token) config.token = generateToken();
    config.enabled = enabled;
    saveBridgeConfig(config);
    requestQoderChannelRegistration(enabled, config.token);
    if (enabled) {
        connectWanted = true;
        openSocket();
    } else {
        stopConnection();
    }
    notify();
}

function stopConnection() {
    connectWanted = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    closeSocket();
    setStatus("disconnected");
}

export function regenerateBridgeToken(): string {
    const config = loadBridgeConfig();
    config.token = generateToken();
    saveBridgeConfig(config);
    // 新令牌需重写注册条目（条目 args 内嵌令牌）
    requestQoderChannelRegistration(true, config.token);
    if (connectWanted) {
        // 换令牌后立即用新令牌重连
        closeSocket();
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        openSocket();
    }
    return config.token;
}

export function setBridgeAdapterPath(adapterPath: string) {
    const config = loadBridgeConfig();
    saveBridgeConfig({ ...config, adapterPath });
}

// ---- 工具调用分发 ----

async function handleCall(ws: WebSocket, id: string, tool: string, args: Record<string, unknown>) {
    let payload: string;
    try {
        const handler = BRIDGE_TOOLS[tool];
        if (!handler) throw new Error(`未知工具：${tool}`);
        const data = await handler(args);
        payload = JSON.stringify({ type: "result", id, ok: true, data: data === undefined ? null : data });
    } catch (error) {
        payload = JSON.stringify({ type: "result", id, ok: false, error: error instanceof Error ? error.message : "工具执行失败" });
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
}

function activeProject(): DramaProject | null {
    const state = useDramaStore.getState();
    return state.projects.find((project) => project.id === state.activeId) || state.projects[0] || null;
}

function resolveProject(projectId?: unknown): DramaProject {
    if (typeof projectId === "string" && projectId) {
        const project = useDramaStore.getState().projects.find((item) => item.id === projectId);
        if (!project) throw new Error(`漫剧项目不存在：${projectId}`);
        return project;
    }
    const project = activeProject();
    if (!project) throw new Error("没有可用的漫剧项目，请先创建");
    return project;
}

function labelOf(list: Array<{ id: string; label: string }>, id: string, emptyLabel: string): string {
    return id ? list.find((item) => item.id === id)?.label || emptyLabel : emptyLabel;
}

function lastRenderUrl(): string {
    const url = lastRenderTask?.url || lastRenderTask?.video_url || "";
    return /^https?:\/\//.test(url) ? url : "";
}

// 16 个 MCP 工具的页面侧处理器：全部经 store action / services 函数写数据（绝不直接改内存对象），React 界面经 store 订阅实时刷新
const BRIDGE_TOOLS: Record<string, (args: Record<string, unknown>) => unknown> = {
    // 1. 项目列表（按 updatedAt 倒序）
    drama_list_projects: () => ({
        projects: [...useDramaStore.getState().projects]
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .map((project) => ({ id: project.id, title: project.title, step: project.step, shotCount: project.shots.length, characterCount: project.characters.length })),
    }),

    // 2. 项目详情：媒体只回布尔存在性（禁止传输 base64/blob），renderUrl 仅 http(s) 时返回
    drama_get_project: (args) => {
        const project = resolveProject(args.projectId);
        const { genre, scene, artStyle, customArtStyle } = useDramaStore.getState();
        const renderUrl = lastRenderUrl();
        return {
            id: project.id,
            title: project.title,
            script: project.script,
            genre,
            genreLabel: labelOf(GENRE_CARDS, genre, "不指定"),
            scene,
            sceneLabel: labelOf(SCENE_PRESETS, scene, "不指定"),
            artStyle,
            artStyleLabel: resolveArtStyleLabel(artStyle),
            customArtStyle,
            shots: project.shots.map((shot, index) => ({
                id: shot.id,
                index: index + 1,
                description: shot.description,
                dialogue: shot.dialogue,
                narration: shot.narration || "",
                seconds: shot.seconds,
                hasImage: Boolean(project.shotImages[shot.id]),
                hasVideo: Boolean(project.shotVideos[shot.id]),
                hasDialogueAudio: Boolean(project.shotAudios[shot.id]),
                hasNarrationAudio: Boolean(project.shotAudios[`${shot.id}:narration`]),
            })),
            characters: project.characters.map((character) => ({ id: character.id, name: character.name, description: character.description, viewCount: Object.keys(character.views).length })),
            ...(renderUrl ? { renderUrl } : {}),
        };
    },

    // 3. 新建项目：设为活跃项目，不在 /drama 时跳转过去，用户可实时看到大脑逐条写入
    drama_create_project: (args) => {
        const projectId = useDramaStore.getState().createProject(typeof args.title === "string" ? args.title : undefined);
        useDramaStore.getState().openProject(projectId);
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/drama")) window.location.assign("/drama");
        return { projectId };
    },

    // 4. 生成选项：非法 id 报错并列出全部合法 id
    drama_set_options: (args) => {
        const store = useDramaStore.getState();
        if (args.genre !== undefined) {
            const genre = String(args.genre);
            if (genre && !GENRE_CARDS.some((card) => card.id === genre)) throw new Error(`非法 genre：${genre}。合法值为空字符串（不指定）或 ${GENRE_CARDS.map((card) => card.id).join("、")}`);
            store.setGenre(genre);
        }
        if (args.scene !== undefined) {
            const scene = String(args.scene);
            if (scene && !SCENE_PRESETS.some((preset) => preset.id === scene)) throw new Error(`非法 scene：${scene}。合法值为空字符串（不指定）或 ${SCENE_PRESETS.map((preset) => preset.id).join("、")}`);
            store.setScene(scene);
        }
        if (args.artStyle !== undefined) {
            const artStyle = String(args.artStyle);
            if (artStyle !== "custom" && !ART_STYLES.some((style) => style.id === artStyle)) throw new Error(`非法 artStyle：${artStyle}。合法值为 custom（自定义）或 ${ART_STYLES.map((style) => style.id).join("、")}`);
            store.setArtStyle(artStyle);
        }
        if (args.customArtStyle !== undefined) store.setCustomArtStyle(String(args.customArtStyle));
        return { ok: true };
    },

    // 5. 写入剧本（script 必填非空；title 传入时才更新）
    drama_set_script: (args) => {
        const project = resolveProject(args.projectId);
        const script = typeof args.script === "string" ? args.script : "";
        if (!script.trim()) throw new Error("script 不能为空");
        const title = typeof args.title === "string" ? args.title.trim() : "";
        useDramaStore.getState().updateProject(project.id, { script, ...(title ? { title } : {}) });
        return { ok: true };
    },

    // 6. 结构化直写分镜与角色（Qoder 大脑入口，不走文本模型）：整包替换 + 清空三张媒体表
    drama_apply_shots: (args) => {
        const project = resolveProject(undefined);
        if (!Array.isArray(args.shots) || !args.shots.length) throw new Error("shots 不能为空数组");
        return applyStructuredScript(project.id, {
            shots: args.shots as Array<{ description?: string; dialogue?: string; narration?: string; seconds?: number }>,
            ...(Array.isArray(args.characters) ? { characters: args.characters as Array<{ name?: string; description?: string }> } : {}),
        });
    },

    // 7. 按 id 部分更新分镜（检测 → 修复 → 回写闭环）：不清媒体、保留未提及分镜
    drama_update_shots: (args) => {
        const project = resolveProject(undefined);
        if (!Array.isArray(args.shots) || !args.shots.length) throw new Error("shots 不能为空数组");
        return updateDramaShots(project.id, args.shots as Array<{ id: string; description?: string; dialogue?: string; narration?: string; seconds?: number }>);
    },

    // 8. 技能规范目录（题材卡 / 场景 / 画风 / 镜头词表 / 分镜与角色写法规范）
    drama_get_skills: () => DRAMA_SKILL_CATALOG,

    // 9. 用软件自己的审查器检查当前分镜：机械检查 + 语义审查，语义失败降级仅机械结果（degraded=true）
    drama_review_shots: async () => {
        const project = resolveProject(undefined);
        const result = await reviewShots(project, getEffectiveConfig());
        return {
            verdict: result.verdict,
            findings: result.findings.map((finding) => {
                // 定位：机械/语义 findings 的 location 形如「分镜 3 / 镜头 3 / Shot 3」，能解析出镜号则附带 shotId
                const match = finding.location.match(/(?:第|镜头?|[Ss]hot)\s*(\d+)/);
                const shot = match ? project.shots[Number(match[1]) - 1] : undefined;
                return {
                    level: finding.severity,
                    location: finding.location,
                    message: [finding.evidence ? `证据「${finding.evidence}」` : "", finding.impact].filter(Boolean).join("："),
                    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
                    ...(shot ? { shotId: shot.id } : {}),
                };
            }),
            degraded: Boolean(result.semanticError),
        };
    },

    // 10. 启动自动生产：buildDirectorPlan + confirmPlan + startDirector
    drama_start_production: (args) => {
        const project = resolveProject(undefined);
        if (!project.shots.length) throw new Error("项目还没有分镜，请先 drama_apply_shots 或 drama_set_script");
        const running = useDirectorStore.getState().runningProjectId;
        if (running && running !== project.id) throw new Error("有其他项目正在自动生产，请先终止后再开始");
        const raw = args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>) : {};
        const options: DirectorPlanOptions = {
            ...DEFAULT_DIRECTOR_OPTIONS,
            ...(raw.characterCandidates === 1 || raw.characterCandidates === 4 ? { characterCandidates: raw.characterCandidates } : {}),
            ...(typeof raw.autoAssignView === "boolean" ? { autoAssignView: raw.autoAssignView } : {}),
            ...(typeof raw.includeAudio === "boolean" ? { includeAudio: raw.includeAudio } : {}),
        };
        const plan = useDirectorStore.getState().buildPlan(project.id, options);
        if (!plan) throw new Error("漫剧项目不存在");
        useDirectorStore.getState().confirmPlan(project.id);
        startDirector(project.id);
        return { taskCount: plan.tasks.length, estimate: { text: plan.estimate.text, image: plan.estimate.image, video: plan.estimate.video, audio: plan.estimate.audio } };
    },

    // 11. 生产状态：无计划返回 {status:"none"}
    drama_get_production_status: () => {
        const project = activeProject();
        const plan = project ? useDirectorStore.getState().plans[project.id] : undefined;
        if (!plan) return { status: "none" };
        return {
            status: plan.status,
            progress: {
                done: plan.tasks.filter((task) => task.status === "success").length,
                total: plan.tasks.length,
                failed: plan.tasks.filter((task) => task.status === "failed").length,
                skipped: plan.tasks.filter((task) => task.status === "skipped").length,
            },
            tasks: plan.tasks.map((task) => ({ id: task.id, kind: task.kind, label: task.label, status: task.status, attempts: task.attempts, ...(task.error ? { error: task.error } : {}) })),
        };
    },

    // 12. 生产控制：retry/skip 必须带 taskId，实现后 maybeRestartDirector 按需拉起执行器
    drama_control_production: (args) => {
        const project = resolveProject(undefined);
        const action = typeof args.action === "string" ? args.action : "";
        const store = useDirectorStore.getState();
        const plan = store.plans[project.id];
        if (!plan) throw new Error("当前项目没有生产计划");
        if (action === "pause") {
            store.pauseRun(project.id);
        } else if (action === "resume") {
            store.resumeRun(project.id);
            startDirector(project.id);
        } else if (action === "abort") {
            store.abortRun(project.id);
        } else if (action === "retry" || action === "skip") {
            const taskId = typeof args.taskId === "string" ? args.taskId : "";
            if (!taskId) throw new Error(`${action} 必须提供 taskId`);
            const task = plan.tasks.find((item) => item.id === taskId);
            if (!task) throw new Error(`任务不存在：${taskId}`);
            if (action === "retry" && task.status !== "failed") throw new Error("只能重试失败的任务");
            if (action === "skip" && task.status !== "failed" && task.status !== "pending") throw new Error("只能跳过失败或待执行的任务");
            if (action === "retry") store.retryTask(project.id, taskId);
            else store.skipTask(project.id, taskId);
            maybeRestartDirector(project.id);
        } else {
            throw new Error(`未知 action：${action}，可选 pause / resume / abort / retry / skip`);
        }
        return { ok: true };
    },

    // 13. 一键成片（需登录、至少一个分镜视频）
    drama_start_render: async () => {
        const project = resolveProject(undefined);
        const task = await createDramaRender(project.id);
        lastRenderTask = task;
        return { taskId: task.id };
    },

    // 14. 成片任务状态（url 仅 http(s) 返回）
    drama_get_render_status: async (args) => {
        const taskId = typeof args.taskId === "string" ? args.taskId : "";
        if (!taskId) throw new Error("taskId 不能为空");
        const token = useUserStore.getState().token;
        if (!token) throw new Error("成片需要登录账号");
        const task = await getRenderTask(token, taskId);
        lastRenderTask = task;
        const url = [task.url, task.video_url].find((value) => typeof value === "string" && /^https?:\/\//.test(value)) || "";
        return { status: task.status, progress: task.progress, ...(url ? { url } : {}) };
    },

    // 15. 通用后端接口代理（同源 /api，带当前登录态）：返回后端原始 {code, data, msg} envelope
    drama_api_request: async (args) => {
        const method = (typeof args.method === "string" ? args.method : "").toUpperCase();
        if (method !== "GET" && method !== "POST" && method !== "PUT" && method !== "DELETE") {
            throw new Error(`不支持的 method：${String(args.method || "")}，可选 GET / POST / PUT / DELETE`);
        }
        const path = typeof args.path === "string" ? args.path : "";
        if (!path.startsWith("/api/")) throw new Error("path 必须以 /api/ 开头");
        if (path.includes("://")) throw new Error("path 不得包含 scheme 或主机名");
        if (path.includes("..")) throw new Error("path 不得包含 ..");
        const headers: Record<string, string> = {};
        const token = useUserStore.getState().token;
        if (token) headers.Authorization = `Bearer ${token}`;
        let body: string | undefined;
        if (method === "POST" || method === "PUT") {
            body = args.body === undefined ? "{}" : JSON.stringify(args.body);
            if (new TextEncoder().encode(body).length > API_REQUEST_MAX_BODY_BYTES) throw new Error("请求体过大：超过 2MB 上限，请减小后重试");
            headers["Content-Type"] = "application/json";
        }
        let response: Response;
        try {
            response = await fetch(path, { method, headers, body });
        } catch {
            throw new Error("后端接口请求失败，请确认后端服务已启动");
        }
        const raw = await response.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = undefined;
        }
        if (method !== "GET" && response.ok) notifyDataChanged(path);
        if (parsed === undefined || parsed === null) {
            return { httpStatus: response.status, note: "响应不是 JSON，已返回原始文本" + (raw.length > API_RESPONSE_MAX_CHARS ? "（超过 1MB，已截断）" : ""), text: raw.slice(0, API_RESPONSE_MAX_CHARS) };
        }
        const serialized = JSON.stringify(parsed);
        if (serialized.length > API_RESPONSE_MAX_CHARS) {
            return { httpStatus: response.status, note: "响应体超过 1MB，已截断为文本返回", text: serialized.slice(0, API_RESPONSE_MAX_CHARS) };
        }
        return parsed;
    },

    // 16. 前端本地配置读写：get 返回原始配置与当前生效配置；set 逐 key 校验后调 updateConfig（Zustand persist 自动落盘，UI 实时刷新）
    drama_local_config: (args) => {
        const action = typeof args.action === "string" ? args.action : "";
        if (action === "get") {
            return { config: useConfigStore.getState().config, effective: getEffectiveConfig() };
        }
        if (action === "set") {
            const patch = args.patch && typeof args.patch === "object" && !Array.isArray(args.patch) ? (args.patch as Record<string, unknown>) : null;
            if (!patch || !Object.keys(patch).length) throw new Error("set 操作需要提供非空的 patch 对象");
            const store = useConfigStore.getState();
            for (const [key, value] of Object.entries(patch)) {
                if (!(key in store.config)) throw new Error(`不支持的配置项: ${key}`);
                store.updateConfig(key as keyof AiConfig, value as never);
            }
            return { ok: true, config: useConfigStore.getState().config };
        }
        throw new Error(`未知 action：${action}，可选 get / set`);
    },
};

// 实时刷新接入：数据变更后重读全局公共设置（既有 load action）；漫剧项目列表为纯本地持久化，无既有刷新 action，不接入
registerRefresh(() => void useConfigStore.getState().loadPublicSettings());

// 模块加载即按持久化配置自启（设置弹窗挂在全局导航，任意页面都会加载本模块，保持连接不因路由切换断开）
if (typeof window !== "undefined" && loadBridgeConfig().enabled) {
    connectWanted = true;
    openSocket();
}
