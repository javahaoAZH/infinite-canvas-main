// 算力服务器执行状态轮询器（模块级单例）：自适应轮询 /v1/comfy/queue（有运行中任务 5s，否则 15s），
// 缓存队列摘要（累计计数 + 运行中任务精简字段），供弹窗与画布同步复用；页面隐藏时暂停轮询。
// 订阅方通过 subscribeComfyStatus 感知快照变化（drama-canvas-sync 借此触发防抖重建）。
import { comfyWorkflowModelName, fetchComfyQueue, type ComfyJob, type ComfyQueueResponse } from "@/services/api/comfy-workflows";
import { getEffectiveConfig } from "@/stores/use-config-store";
import { useDirectorStore } from "@/stores/use-director-store";

// 运行中任务的精简字段：只留画布摘要需要的内容，避免缓存大对象
export type ComfyRunningJob = {
    jobId: string;
    workflow: string; // 工作流名（去 .json 后缀）
    kind: string;
    status: string;
    progress: number; // 0-100
    currentNode: string;
};

export type ComfyStatusSnapshot = {
    reachable: boolean; // false = 最近一次轮询失败（静默，不打断展示）
    completed: number;
    failed: number;
    running: ComfyRunningJob[];
};

const POLL_ACTIVE_INTERVAL_MS = 5000; // 最近一次快照有运行中任务（queued/running）
const POLL_IDLE_INTERVAL_MS = 15000; // 无运行中任务时降频

// source → model：弹窗与导演台两个来源各自登记，全部退出才真正停表
const sources = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;
let visibilityBound = false;
let current: ComfyStatusSnapshot | null = null;

const listeners = new Set<() => void>();

export function getComfyStatusSnapshot(): ComfyStatusSnapshot | null {
    return current;
}

// 快照摘要签名：运行中 job_id 列表 + 10% 桶化进度 + counts，供 projectSignature 并入
export function comfyStatusSignature(): string {
    if (!current) return "off";
    const running = current.running.map((job) => `${job.jobId}:${Math.floor(job.progress / 10) * 10}`).join(",");
    return `${current.reachable ? 1 : 0}|${current.completed}|${current.failed}|${running}`;
}

export function subscribeComfyStatus(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function jobProgress(job: ComfyJob): number {
    if (typeof job.progress_percent === "number") return Math.min(100, Math.max(0, Math.floor(job.progress_percent)));
    const value = job.progress?.value;
    const max = job.progress?.max;
    if (typeof value === "number" && typeof max === "number" && max > 0) return Math.min(100, Math.max(0, Math.floor((value / max) * 100)));
    return 0;
}

function buildSnapshot(response: ComfyQueueResponse): ComfyStatusSnapshot {
    const items = Array.isArray(response.items) ? response.items : [];
    const running = items
        .filter((job) => job.status === "queued" || job.status === "running")
        .map((job) => ({
            jobId: job.job_id,
            workflow: job.workflow ? comfyWorkflowModelName(job.workflow) : "",
            kind: job.kind || "",
            status: job.status || "",
            progress: jobProgress(job),
            currentNode: job.current_node || "",
        }));
    return { reachable: true, completed: response.counts?.completed || 0, failed: response.counts?.failed || 0, running };
}

function applySnapshot(snapshot: ComfyStatusSnapshot) {
    current = snapshot;
    listeners.forEach((listener) => listener());
}

async function pollOnce() {
    if (inflight) return;
    const model = [...sources.values()].find((value) => value.trim()) || "";
    if (!model) return;
    inflight = true;
    try {
        applySnapshot(buildSnapshot(await fetchComfyQueue(model)));
    } catch {
        // 失败静默：保留可达性变化供画布节点提示，计数与运行中列表清零
        applySnapshot({ reachable: false, completed: 0, failed: 0, running: [] });
    } finally {
        inflight = false;
    }
}

function ensureTimer() {
    if (timer) return;
    void pollOnce();
    scheduleNextPoll();
}

// 自适应间隔：按最近一次快照是否含运行中任务选 5s/15s，用 setTimeout 链逐次调度
function scheduleNextPoll() {
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        if (typeof document !== "undefined" && document.hidden) {
            scheduleNextPoll();
            return;
        }
        void pollOnce();
        scheduleNextPoll();
    }, current?.running.length ? POLL_ACTIVE_INTERVAL_MS : POLL_IDLE_INTERVAL_MS);
}

function stopTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
}

// 页面重新可见时立即补一次轮询，避免等待下一个间隔
function bindVisibility() {
    if (visibilityBound || typeof document === "undefined") return;
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && sources.size > 0) void pollOnce();
    });
}

export function startComfyStatusPolling(model: string, source = "modal") {
    sources.set(source, model);
    bindVisibility();
    ensureTimer();
}

export function stopComfyStatusPolling(source = "modal") {
    sources.delete(source);
    if (sources.size === 0) stopTimer();
}

let watcherInitialized = false;

// 导演台生产期间自动启停轮询：有 running 计划即启动（model 取当前生效配置的出图模型），结束即停
export function initComfyStatusWatcher() {
    if (watcherInitialized) return;
    watcherInitialized = true;
    useDirectorStore.subscribe((state) => {
        const producing = Boolean(state.runningProjectId) || Object.values(state.plans).some((plan) => plan.status === "running");
        if (producing) {
            const config = getEffectiveConfig();
            startComfyStatusPolling(config.imageModel || config.model, "director");
        } else {
            stopComfyStatusPolling("director");
        }
    });
}
