// Qoder / ChatGPT ↔ 漫剧软件通信桥（页面侧 WS 客户端）：模块级单例，分别管理到本地适配器
// 9801 / 9802 的连接、自动重连与状态订阅；适配器下发的工具调用由 BRIDGE_TOOLS 处理器执行——只读写 Zustand store
// 与 services（不碰 React），页面 UI 经 store 订阅实时刷新。配置（enabled/token/adapterPath）存 localStorage（极小配置）。
import { nanoid } from "nanoid";

import { ART_STYLES, DRAMA_SKILL_CATALOG, GENRE_CARDS, SCENE_PRESETS, resolveArtStyleLabel } from "@/app/(user)/drama/prompts";
import { notifyDataChanged, registerRefresh } from "@/app/(user)/drama/services/bridge-refresh";
import { applyStructuredScript, createDramaRender, updateDramaShots, type DramaShotPatch, type StructuredScriptInput } from "@/app/(user)/drama/services/drama-generation";
import { reviewShots } from "@/app/(user)/drama/services/drama-review";
import { DEFAULT_DIRECTOR_OPTIONS } from "@/app/(user)/drama/services/director-planner";
import { maybeRestartDirector, startDirector } from "@/app/(user)/drama/services/director-runner";
import { apiGet, apiPost } from "@/services/api/request";
import { bindAssetFiles, checkEpisodeAssets, fetchAssetManifest, reviewAssetEntry, upsertAssetEntry, upsertEpisodeBoard, writeAssetProjectFile, type AssetEntry, type ShotRecord } from "@/services/api/drama-assets";
import { getRenderTask, type RenderTaskResponse } from "@/services/api/render";
import { resolveMediaUrl } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { getEffectiveConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useDirectorStore, type DirectorPlanOptions } from "@/stores/use-director-store";
import { CHARACTER_VIEW_ORDER, type CharacterViewKind } from "@/stores/use-asset-store";
import { useDramaStore, type DramaMedia, type DramaProject } from "@/stores/use-drama-store";
import { useUserStore } from "@/stores/use-user-store";

export type BridgeStatus = "disconnected" | "connecting" | "connected";
export type BridgeRegistered = "ok" | "failed" | "";
export type DramaBridgeConfig = { enabled: boolean; token: string; adapterPath: string; chatGPTEnabled: boolean; chatGPTToken: string };
export type BridgeSnapshot = { enabled: boolean; status: BridgeStatus; registered: BridgeRegistered; registerError: string };
export type QoderChannelStatus = { supported: boolean; registered: boolean; mode: "exe" | "node" | "unsupported"; mcpJsonPath: string; executablePath: string };
export type ChatGPTChannelStatus = { supported: boolean; registered: boolean; mode: "exe" | "node" | "unsupported"; mcpConfigPath: string; codexCliPath: string; executablePath: string; port: number };

// 查询后端自动注册状态（公共接口，无需登录态）
export function fetchQoderChannelStatus() {
    return apiGet<QoderChannelStatus>("/api/qoder-channel/status");
}

export function fetchChatGPTChannelStatus() {
    return apiGet<ChatGPTChannelStatus>("/api/chatgpt-channel/status");
}

const BRIDGE_STORAGE_KEY = "infinite-canvas:drama_bridge";
const RECONNECT_INTERVAL_MS = 3000;
// drama_api_request 限制：请求体 ≤2MB，响应序列化 >1MB 截断
const API_REQUEST_MAX_BODY_BYTES = 2 * 1024 * 1024;
const API_RESPONSE_MAX_CHARS = 1024 * 1024;

type BridgeInboundMessage = { type?: string; id?: string; tool?: string; args?: Record<string, unknown> };

// ---- 配置读写 ----

export function loadBridgeConfig(): DramaBridgeConfig {
    if (typeof window === "undefined") return { enabled: false, token: "", adapterPath: "", chatGPTEnabled: false, chatGPTToken: "" };
    try {
        const parsed = JSON.parse(window.localStorage.getItem(BRIDGE_STORAGE_KEY) || "{}") as Partial<DramaBridgeConfig>;
        return {
            enabled: parsed.enabled === true,
            token: typeof parsed.token === "string" ? parsed.token : "",
            adapterPath: typeof parsed.adapterPath === "string" ? parsed.adapterPath : "",
            chatGPTEnabled: parsed.chatGPTEnabled === true,
            chatGPTToken: typeof parsed.chatGPTToken === "string" ? parsed.chatGPTToken : "",
        };
    } catch {
        return { enabled: false, token: "", adapterPath: "", chatGPTEnabled: false, chatGPTToken: "" };
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

// ---- 连接管理（模块级单例）：Qoder 9801 与 ChatGPT 9802 可同时在线 ----

type BridgeRuntime = {
    kind: "qoder" | "chatgpt";
    wsUrl: string;
    registerUrl: string;
    connectWanted: boolean;
    socket: WebSocket | null;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    status: BridgeStatus;
    registered: BridgeRegistered;
    registerError: string;
    listeners: Set<(snapshot: BridgeSnapshot) => void>;
};

const qoderRuntime: BridgeRuntime = createBridgeRuntime("qoder", 9801, "/api/qoder-channel");
const chatGPTRuntime: BridgeRuntime = createBridgeRuntime("chatgpt", 9802, "/api/chatgpt-channel");
// 最近一次成片任务（内存态）：drama_get_project 的 renderUrl 从这里取，仅 http(s) 返回
let lastRenderTask: RenderTaskResponse | null = null;

function createBridgeRuntime(kind: BridgeRuntime["kind"], port: number, registerUrl: string): BridgeRuntime {
    return { kind, wsUrl: `ws://127.0.0.1:${port}`, registerUrl, connectWanted: false, socket: null, reconnectTimer: null, status: "disconnected", registered: "", registerError: "", listeners: new Set() };
}

function runtimeSnapshot(runtime: BridgeRuntime): BridgeSnapshot {
    return { enabled: runtime.connectWanted, status: runtime.status, registered: runtime.registered, registerError: runtime.registerError };
}

export function getBridgeSnapshot(): BridgeSnapshot {
    return runtimeSnapshot(qoderRuntime);
}

export function getChatGPTBridgeSnapshot(): BridgeSnapshot {
    return runtimeSnapshot(chatGPTRuntime);
}

export function onBridgeStatusChange(listener: (snapshot: BridgeSnapshot) => void): () => void {
    qoderRuntime.listeners.add(listener);
    return () => qoderRuntime.listeners.delete(listener);
}

export function onChatGPTBridgeStatusChange(listener: (snapshot: BridgeSnapshot) => void): () => void {
    chatGPTRuntime.listeners.add(listener);
    return () => chatGPTRuntime.listeners.delete(listener);
}

function notify(runtime: BridgeRuntime) {
    const snapshot = runtimeSnapshot(runtime);
    runtime.listeners.forEach((listener) => listener(snapshot));
}

function setStatus(runtime: BridgeRuntime, next: BridgeStatus) {
    if (runtime.status === next) return;
    runtime.status = next;
    notify(runtime);
}

function scheduleReconnect(runtime: BridgeRuntime) {
    if (!runtime.connectWanted || runtime.reconnectTimer) return;
    runtime.reconnectTimer = setTimeout(() => {
        runtime.reconnectTimer = null;
        openSocket(runtime);
    }, RECONNECT_INTERVAL_MS);
}

function closeSocket(runtime: BridgeRuntime) {
    if (!runtime.socket) return;
    const ws = runtime.socket;
    runtime.socket = null;
    try {
        ws.close();
    } catch {
        // 忽略关闭异常
    }
}

function openSocket(runtime: BridgeRuntime) {
    if (typeof window === "undefined" || !runtime.connectWanted) return;
    const config = loadBridgeConfig();
    const token = runtime.kind === "qoder" ? config.token : config.chatGPTToken;
    if (!token) return;
    setStatus(runtime, "connecting");
    let ws: WebSocket;
    try {
        ws = new WebSocket(runtime.wsUrl);
    } catch {
        scheduleReconnect(runtime);
        return;
    }
    runtime.socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, client: "infinite-canvas-drama", version: 1 }));
    ws.onmessage = (event) => {
        let message: BridgeInboundMessage;
        try {
            message = JSON.parse(String(event.data)) as BridgeInboundMessage;
        } catch {
            return;
        }
        if (message.type === "ready") {
            setStatus(runtime, "connected");
            return;
        }
        if (message.type === "call" && message.id && message.tool) void handleCall(ws, message.id, message.tool, message.args || {});
    };
    ws.onclose = () => {
        if (runtime.socket === ws) runtime.socket = null;
        setStatus(runtime, "disconnected");
        scheduleReconnect(runtime);
    };
    ws.onerror = () => {
        // 连接失败由 onclose 统一走重连
    };
}

// fire-and-forget 自动注册：请求结果写入各通道快照；开关行为本身不依赖该请求成功
function requestChannelRegistration(runtime: BridgeRuntime, enabled: boolean, token: string) {
    void apiPost(runtime.registerUrl, { enabled, token })
        .then(() => {
            runtime.registered = enabled ? "ok" : "";
            runtime.registerError = "";
            notify(runtime);
        })
        .catch((error) => {
            runtime.registered = "failed";
            runtime.registerError = error instanceof Error && error.message ? error.message : "注册请求失败";
            notify(runtime);
        });
}

export function setBridgeEnabled(enabled: boolean) {
    const config = loadBridgeConfig();
    if (enabled && !config.token) config.token = generateToken();
    config.enabled = enabled;
    saveBridgeConfig(config);
    requestChannelRegistration(qoderRuntime, enabled, config.token);
    if (enabled) {
        qoderRuntime.connectWanted = true;
        openSocket(qoderRuntime);
    } else {
        stopConnection(qoderRuntime);
    }
    notify(qoderRuntime);
}

export function setChatGPTBridgeEnabled(enabled: boolean) {
    const config = loadBridgeConfig();
    if (enabled && !config.chatGPTToken) config.chatGPTToken = generateToken();
    config.chatGPTEnabled = enabled;
    saveBridgeConfig(config);
    requestChannelRegistration(chatGPTRuntime, enabled, config.chatGPTToken);
    if (enabled) {
        chatGPTRuntime.connectWanted = true;
        openSocket(chatGPTRuntime);
    } else {
        stopConnection(chatGPTRuntime);
    }
    notify(chatGPTRuntime);
}

function stopConnection(runtime: BridgeRuntime) {
    runtime.connectWanted = false;
    if (runtime.reconnectTimer) {
        clearTimeout(runtime.reconnectTimer);
        runtime.reconnectTimer = null;
    }
    closeSocket(runtime);
    setStatus(runtime, "disconnected");
}

export function regenerateBridgeToken(): string {
    const config = loadBridgeConfig();
    config.token = generateToken();
    saveBridgeConfig(config);
    // 新令牌需重写注册条目（条目 args 内嵌令牌）
    requestChannelRegistration(qoderRuntime, true, config.token);
    if (qoderRuntime.connectWanted) {
        // 换令牌后立即用新令牌重连
        closeSocket(qoderRuntime);
        if (qoderRuntime.reconnectTimer) {
            clearTimeout(qoderRuntime.reconnectTimer);
            qoderRuntime.reconnectTimer = null;
        }
        openSocket(qoderRuntime);
    }
    return config.token;
}

export function regenerateChatGPTBridgeToken(): string {
    const config = loadBridgeConfig();
    config.chatGPTToken = generateToken();
    saveBridgeConfig(config);
    requestChannelRegistration(chatGPTRuntime, true, config.chatGPTToken);
    if (chatGPTRuntime.connectWanted) {
        closeSocket(chatGPTRuntime);
        if (chatGPTRuntime.reconnectTimer) {
            clearTimeout(chatGPTRuntime.reconnectTimer);
            chatGPTRuntime.reconnectTimer = null;
        }
        openSocket(chatGPTRuntime);
    }
    return config.chatGPTToken;
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

// 资产工具公共前置：登录令牌；项目名缺省回退当前活跃项目名（清单以项目文件夹为源）
function requireBridgeToken(): string {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("操作资产清单需要先登录");
    return token;
}

function assetProjectArg(args: Record<string, unknown>): string {
    const direct = String(args.project || "").trim();
    if (direct) return direct;
    const state = useDramaStore.getState();
    const active = state.projects.find((item) => item.id === state.activeId);
    if (!active?.title) throw new Error("project 缺失且无活跃项目可回退");
    return active.title;
}

function dataUrlToBlob(dataUrl: string): Blob {
    const [meta, base64] = dataUrl.split(",");
    const mime = meta?.match(/:(.*?);/)?.[1] || "application/octet-stream";
    const binary = atob(base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

async function blobToBase64(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// 17 个 MCP 工具的页面侧处理器：全部经 store action / services 函数写数据（绝不直接改内存对象），React 界面经 store 订阅实时刷新
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
                ...(shot.shotSize ? { shotSize: shot.shotSize } : {}),
                ...(shot.camera ? { camera: shot.camera } : {}),
                ...(shot.transition ? { transition: shot.transition } : {}),
                ...(shot.action ? { action: shot.action } : {}),
                ...(shot.emotion ? { emotion: shot.emotion } : {}),
                ...(shot.characters?.length ? { characters: shot.characters } : {}),
                ...(shot.imagePrompt ? { imagePrompt: shot.imagePrompt } : {}),
                ...(shot.videoPrompt ? { videoPrompt: shot.videoPrompt } : {}),
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
            shots: args.shots as StructuredScriptInput["shots"],
            ...(Array.isArray(args.characters) ? { characters: args.characters as Array<{ name?: string; description?: string }> } : {}),
        });
    },

    // 7. 按 id 部分更新分镜（检测 → 修复 → 回写闭环）：不清媒体、保留未提及分镜
    drama_update_shots: (args) => {
        const project = resolveProject(undefined);
        if (!Array.isArray(args.shots) || !args.shots.length) throw new Error("shots 不能为空数组");
        return updateDramaShots(project.id, args.shots as DramaShotPatch[]);
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

    // 17. 图片注入（Qoder ImageGen 产物 → 项目）：适配器已读文件转 base64，页面上传后写入立绘候选或分镜图（幂等流水线只补跑缺口）
    drama_inject_image: async (args) => {
        const project = resolveProject(args.projectId);
        const dataUrl = typeof args.dataUrl === "string" ? args.dataUrl : "";
        if (!dataUrl.startsWith("data:image/")) throw new Error("dataUrl 缺失或不是图片 base64");
        const target = String(args.target || "");
        const uploaded = await uploadImage(dataUrl);
        const media: DramaMedia = { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType };
        if (target === "shotImage") {
            const shotId = typeof args.shotId === "string" ? args.shotId : "";
            const shot = project.shots.find((item) => item.id === shotId);
            if (!shot) throw new Error(`分镜不存在：${shotId}，可用 drama_get_project 查看分镜 id`);
            useDramaStore.getState().updateProject(project.id, { shotImages: { ...project.shotImages, [shotId]: media } });
            return { ok: true, target: "shotImage", shotId };
        }
        if (target === "character") {
            const characterName = typeof args.characterName === "string" ? args.characterName.trim() : "";
            const byId = typeof args.characterId === "string" ? project.characters.find((character) => character.id === args.characterId) : undefined;
            const byName = !byId && characterName ? project.characters.find((character) => character.name === characterName) : undefined;
            const character = byId || byName;
            if (!character) throw new Error(`角色不存在：${String(args.characterId || args.characterName || "")}，可用 drama_get_project 查看角色 id 与名称`);
            const candidates = [...character.candidates, media];
            const views = { ...character.views };
            let assignedView = "";
            // purge=true 时清空旧候选与旧视图（彻底替换，不留旧图），再写入新图
            const purge = args.purge === true;
            const candidateList = purge ? [media] : candidates;
            const viewMap: Partial<Record<CharacterViewKind, DramaMedia>> = purge ? {} : views;
            // 支持 viewKey 指定覆盖某个视图（替换旧立绘）；否则缺省自动分配到首个空视图
            const viewKey = typeof args.viewKey === "string" ? args.viewKey : "";
            if (viewKey && (CHARACTER_VIEW_ORDER as string[]).includes(viewKey)) {
                viewMap[viewKey as CharacterViewKind] = media;
                assignedView = viewKey;
            } else if (args.autoAssignView !== false) {
                const emptyView = CHARACTER_VIEW_ORDER.find((key) => !viewMap[key]);
                if (emptyView) {
                    viewMap[emptyView] = media;
                    assignedView = emptyView;
                }
            }
            useDramaStore.getState().updateProject(project.id, { characters: project.characters.map((item) => (item.id === character.id ? { ...item, candidates: candidateList, views: viewMap } : item)) });
            return { ok: true, target: "character", characterId: character.id, candidateCount: candidateList.length, ...(assignedView ? { assignedView } : {}) };
        }
        throw new Error(`未知 target：${target}，可选 character / shotImage`);
    },

    // 18. 资产清单查询（D 盘项目文件夹唯一事实源，可按分类/状态/优先级过滤）
    drama_asset_list: async (args) => {
        const token = requireBridgeToken();
        const project = assetProjectArg(args);
        const manifest = await fetchAssetManifest(token, project);
        let entries = manifest.条目 || [];
        if (args.category) entries = entries.filter((entry) => entry.分类 === args.category);
        if (args.status) entries = entries.filter((entry) => entry.状态 === args.status);
        if (args.priority) entries = entries.filter((entry) => entry.优先级 === args.priority);
        return { project, count: entries.length, entries, 分集: manifest.分集 || [], 季集: manifest.季集 || [] };
    },

    // 19. 登记/更新清单条目（按编号合并）
    drama_asset_upsert: async (args) => {
        const token = requireBridgeToken();
        const project = assetProjectArg(args);
        const entry = args.entry as Partial<AssetEntry> | undefined;
        if (!entry || typeof entry !== "object") throw new Error("entry 必填（对象）");
        return upsertAssetEntry(token, project, entry);
    },

    // 20. 绑定本地产物为新版本（旧版自动入 history/，状态→待审核）
    drama_asset_bind: async (args) => {
        const token = requireBridgeToken();
        const project = assetProjectArg(args);
        const id = String(args.id || "");
        const files = args.files as Array<{ name?: string; dataUrl?: string }> | undefined;
        if (!id || !files?.length) throw new Error("id 与 files 必填");
        const payloads = files.map((file) => ({ name: file.name || "asset.png", blob: dataUrlToBlob(String(file.dataUrl || "")) }));
        return bindAssetFiles(token, project, id, payloads, String(args.note || ""), args.source ? String(args.source) : undefined);
    },

    // 21. 批量审核确认（轮次留档）
    drama_asset_confirm: async (args) => {
        const token = requireBridgeToken();
        const project = assetProjectArg(args);
        const ids = args.ids as string[] | undefined;
        if (!ids?.length) throw new Error("ids 必填");
        const updated: AssetEntry[] = [];
        for (const id of ids) updated.push(await reviewAssetEntry(token, project, id, "MCP", "已确认", String(args.comment || "")));
        return { confirmed: updated.length, entries: updated };
    },

    // 22. 开工前检查：该集缺产出/未确认/依赖阻塞
    drama_episode_check: async (args) => {
        const token = requireBridgeToken();
        const project = assetProjectArg(args);
        const episode = String(args.episode || "");
        if (!episode) throw new Error("episode 必填（如 ep01）");
        return checkEpisodeAssets(token, project, episode);
    },

    // 23. 导出分集分镜稿＋归档分镜图到 分集/<ep>/shots/
    drama_episode_export: async (args) => {
        const token = requireBridgeToken();
        const project = assetProjectArg(args);
        const episode = String(args.episode || "");
        if (!episode) throw new Error("episode 必填（如 ep01）");
        const projectData = useDramaStore.getState().projects.find((item) => item.title === project);
        if (!projectData) throw new Error(`项目不在浏览器工作区：${project}`);
        // 回写分集时按镜号保留清单侧全部策划字段（场景/音效/音乐/帧类型/情绪强度/所属节拍/质检标准/所需资产），
        // 否则一次导出就会冲掉这些不在浏览器工作区里的字段；浏览器侧字段（描述/对白/旁白/秒/镜头语言/导演字段）以工作区为准覆盖
        const manifestNow = await fetchAssetManifest(token, project);
        const oldBoard = (manifestNow.分集 || []).find((item) => item.集 === episode);
        const oldShots = new Map((oldBoard?.镜头 || []).map((item) => [item.镜号, item]));
        const boardShots: ShotRecord[] = projectData.shots.map((shot, index) => {
            const old = oldShots.get(index + 1);
            return {
                ...(old || {}),
                镜号: index + 1,
                描述: shot.description,
                对白: shot.dialogue,
                旁白: shot.narration,
                秒: shot.seconds,
                景别: shot.shotSize,
                运镜: shot.camera,
                转场: shot.transition,
                动作: shot.action,
                情绪: shot.emotion,
                出场角色: shot.characters,
                出图提示词: shot.imagePrompt,
                图生视频提示词: shot.videoPrompt,
                所需资产: old?.所需资产 || [],
                产物: projectData.shotImages[shot.id] ? { 分镜图: `分集/${episode}/shots/镜头${String(index + 1).padStart(2, "0")}_分镜图.png` } : old?.产物,
            };
        });
        // 同步把分镜沉淀进清单 分集（生产数据落盘，界面「按季投产」视图直接读）
        await upsertEpisodeBoard(token, project, { ...(oldBoard || {}), 集: episode, 镜头: boardShots });
        // 分镜稿：十三列制作分镜表（镜号/场景/出场角色/景别/运镜/转场/秒/画面描述/动作/情绪/对白/旁白/分镜图）
        const lines = [
            `# ${projectData.title} ${episode} 分镜稿`,
            "",
            "| 镜号 | 场景 | 出场角色 | 景别 | 运镜 | 转场 | 秒 | 画面描述 | 动作 | 情绪 | 对白 | 旁白 | 分镜图 |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ];
        boardShots.forEach((shot) => {
            lines.push(
                `| ${shot.镜号} | ${shot.场景 || ""} | ${(shot.出场角色 || []).join("、")} | ${shot.景别 || ""} | ${shot.运镜 || ""} | ${shot.转场 || ""} | ${shot.秒 ?? ""} | ${shot.描述 || ""} | ${shot.动作 || ""} | ${shot.情绪 || ""} | ${shot.对白 || ""} | ${shot.旁白 || ""} | ${shot.产物?.分镜图 ? "有" : "无"} |`,
            );
        });
        await writeAssetProjectFile(token, project, `分集/${episode}/分镜稿.md`, lines.join("\n") + "\n");
        // 提示词与质检：长字段另出一份，供出图/图生视频/配音/验收各工种直接取用
        const detail = [`# ${projectData.title} ${episode} 提示词与质检`, ""];
        boardShots.forEach((shot) => {
            detail.push(
                `## 镜${shot.镜号}`,
                `- 帧类型：${shot.帧类型 || ""}｜情绪强度：${shot.情绪强度 || ""}｜所属节拍：${shot.所属节拍 || ""}`,
                `- 音效：${shot.音效 || ""}`,
                `- 音乐：${shot.音乐 || ""}`,
                `- 所需资产：${(shot.所需资产 || []).join("、")}`,
                `- 出图提示词：${shot.出图提示词 || "（未写，生成时回落为画面描述＋动作）"}`,
                `- 图生视频提示词：${shot.图生视频提示词 || "（未写，生成时回落为画面描述＋动作）"}`,
                `- 质检标准：${shot.质检标准 || ""}`,
                "",
            );
        });
        await writeAssetProjectFile(token, project, `分集/${episode}/提示词与质检.md`, detail.join("\n"));
        let archived = 0;
        for (const [index, shot] of projectData.shots.entries()) {
            const media = projectData.shotImages[shot.id];
            if (!media) continue;
            try {
                const url = await resolveMediaUrl(media.storageKey, media.url);
                const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                if (!response.ok) continue;
                await writeAssetProjectFile(token, project, `分集/${episode}/shots/镜头${String(index + 1).padStart(2, "0")}_分镜图.png`, await blobToBase64(await response.blob()));
                archived += 1;
            } catch {
                // 单镜归档失败不阻断导出
            }
        }
        return { episode, board: `分集/${episode}/分镜稿.md`, archivedShots: archived };
    },
};

// 实时刷新接入：数据变更后重读全局公共设置（既有 load action）；漫剧项目列表为纯本地持久化，无既有刷新 action，不接入
registerRefresh(() => void useConfigStore.getState().loadPublicSettings());

// 模块加载即按持久化配置自启（设置弹窗挂在全局导航，任意页面都会加载本模块，保持连接不因路由切换断开）
if (typeof window !== "undefined") {
    const config = loadBridgeConfig();
    if (config.enabled) {
        qoderRuntime.connectWanted = true;
        openSocket(qoderRuntime);
    }
    if (config.chatGPTEnabled) {
        chatGPTRuntime.connectWanted = true;
        openSocket(chatGPTRuntime);
    }
}
