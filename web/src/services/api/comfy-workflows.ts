import axios from "axios";

import { channelIdForActiveModel, getEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

// 算力服务器 comfyui2api 的 ComfyUI 工作流条目
export type ComfyWorkflowItem = {
    name: string;
    kind: string;
    available: boolean;
    load_error?: string | null;
    parameter_error?: string | null;
};

export type ComfyWorkflowsResponse = {
    workflows_dir?: string;
    items: ComfyWorkflowItem[];
};

// 代理请求头：镜像 video.ts 的 aiHeaders 账号代理分支（Authorization + 非空时的 X-User-Model-Channel-ID），
// 否则后端 proxyAIGetRequest 无法定位用户本地渠道（如算力服务器），会回退到空的管理员渠道报「AI 接口请求失败」
function comfyProxyHeaders(token: string): Record<string, string> {
    const config = getEffectiveConfig();
    const channelId = channelIdForActiveModel(config);
    return { Authorization: `Bearer ${token}`, ...(channelId ? { "X-User-Model-Channel-ID": channelId } : {}) };
}

// 后端代理失败时返回 HTTP 200 + {code:1,msg} 统一信封，需显式识别并报错，避免被当作正常透传 JSON
function assertComfyProxyError(data: object) {
    const envelope = data as { code?: number; msg?: string };
    if (typeof envelope.code === "number" && envelope.code !== 0) throw new Error(envelope.msg || "AI 接口请求失败");
}

// 拉取算力服务器上的 ComfyUI 工作流清单。经后端 /v1/comfy/workflows 代理（按 model 选渠道并透传鉴权），
// 规避浏览器直连算力服务器的跨域限制。后端原样转发 comfyui2api 的 JSON，故不走统一 {code,data} 封装。
export async function fetchComfyWorkflows(model: string): Promise<ComfyWorkflowsResponse> {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("请先登录后再查看算力工作流");
    if (!model.trim()) throw new Error("缺少用于定位算力渠道的模型名");
    const response = await axios.get("/api/v1/comfy/workflows", {
        params: { model },
        headers: comfyProxyHeaders(token),
        timeout: 20000,
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`读取算力工作流失败：${response.status}`);
    const data = response.data as ComfyWorkflowsResponse | null;
    if (!data || typeof data !== "object") throw new Error("算力工作流返回格式错误");
    assertComfyProxyError(data);
    if (!Array.isArray(data.items)) throw new Error("算力工作流返回格式错误");
    return data;
}

// 工作流文件名去掉 .json 后缀，得到与软件模型名一致的名称
export function comfyWorkflowModelName(name: string): string {
    return name.replace(/\.json$/i, "");
}

// comfyui2api 队列计数：已确认字段为 completed/failed，其余状态计数宽松接收
type ComfyQueueCounts = { completed?: number; failed?: number } & Record<string, number | undefined>;

// comfyui2api 单个执行任务（字段按上游探测结果宽松定义）
export type ComfyJob = {
    job_id: string;
    status?: string; // completed/failed，运行态预计 queued/running
    progress_percent?: number; // 0-100 整数
    progress?: { value?: number; max?: number; prompt_id?: string; node?: unknown } | null;
    current_node?: string;
    error?: string | null;
    outputs?: Array<{ filename?: string; url?: string; media_type?: string }>;
    kind?: string; // txt2img/img2img/img2video 等
    workflow?: string; // 工作流文件名
    created_at_utc?: string;
    started_at_utc?: string;
    finished_at_utc?: string;
};

export type ComfyQueueResponse = {
    counts?: ComfyQueueCounts;
    items?: ComfyJob[];
};

export type ComfyJobResponse = {
    job?: ComfyJob;
};

// 队列快照（全量历史，可能较大）。同样经后端代理透传，不走 {code,data} 封装。
export async function fetchComfyQueue(model: string): Promise<ComfyQueueResponse> {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("请先登录后再查看算力任务");
    if (!model.trim()) throw new Error("缺少用于定位算力渠道的模型名");
    const response = await axios.get("/api/v1/comfy/queue", {
        params: { model },
        headers: comfyProxyHeaders(token),
        timeout: 20000,
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`读取算力任务队列失败：${response.status}`);
    const data = response.data as ComfyQueueResponse | null;
    if (!data || typeof data !== "object") throw new Error("算力任务队列返回格式错误");
    assertComfyProxyError(data);
    return data;
}

// 单任务详情（响应小，适合作轮询主接口）
export async function fetchComfyJob(model: string, jobId: string): Promise<ComfyJobResponse> {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("请先登录后再查看算力任务");
    if (!model.trim()) throw new Error("缺少用于定位算力渠道的模型名");
    if (!jobId.trim()) throw new Error("缺少算力任务 ID");
    const response = await axios.get(`/api/v1/comfy/jobs/${encodeURIComponent(jobId)}`, {
        params: { model },
        headers: comfyProxyHeaders(token),
        timeout: 20000,
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`读取算力任务详情失败：${response.status}`);
    const data = response.data as ComfyJobResponse | null;
    if (!data || typeof data !== "object") throw new Error("算力任务详情返回格式错误");
    assertComfyProxyError(data);
    return data;
}
