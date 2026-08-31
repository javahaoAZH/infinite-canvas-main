import axios from "axios";

import { apiDelete, apiGet, apiPost } from "@/services/api/request";

export type RenderFFmpegStatus = {
    available: boolean;
    path: string;
    version: string;
    source: string;
    reason: string;
    downloadUrl: string;
};

export type RenderTimelineItem = {
    kind: "video" | "image" | "audio";
    source: string;
    durationMs?: number;
};

export type RenderTimelineSpec = {
    fps: number;
    width: number;
    height: number;
    items: RenderTimelineItem[];
    srt?: string;
    burnSubtitle?: boolean;
    folder?: string;
};

export type RenderTaskResponse = {
    id: string;
    status: "queued" | "preparing" | "rendering" | "completed" | "failed";
    progress: number;
    seconds?: string;
    size?: string;
    fileId?: string;
    url?: string;
    video_url?: string;
    localPath?: string;
    error?: { message?: string };
    createdAt?: string;
    updatedAt?: string;
    started_at?: string;
    completed_at?: string;
};

export const RENDER_POLL_INTERVAL_MS = 5000;

export function getRenderFFmpegStatus(token: string) {
    return apiGet<RenderFFmpegStatus>("/api/v1/render/ffmpeg-status", undefined, token);
}

export function saveRenderFFmpegPath(token: string, path: string) {
    return apiPost<{ path: string }>("/api/admin/render/ffmpeg-path", { path }, token);
}

export function createRenderTask(token: string, timeline: RenderTimelineSpec) {
    return apiPost<RenderTaskResponse>("/api/v1/render/tasks", { timeline }, token);
}

// 把浏览器本地媒体（blob）暂存到后端本地磁盘的项目文件夹，返回 file: 来源，供一键成片引擎读取
export async function stageLocalRenderMedia(token: string, blob: Blob, folder: string, filename: string): Promise<string> {
    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("folder", folder);
    const response = await fetch("/api/v1/render/local-media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    });
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string; data?: { source?: string } } | null;
    if (!response.ok || payload?.code !== 0 || !payload.data?.source) throw new Error(payload?.msg || "本地媒体暂存失败");
    return payload.data.source;
}

// 本地保存模式的成片产物为需登录鉴权的相对路径；对象存储的 http 外链不需要鉴权
export function isAuthedRenderOutputUrl(url: string) {
    return url.startsWith("/api/");
}

// 带鉴权拉取本地成片产物：相对路径需携带 Bearer token，返回 blob 供转 object URL 播放/下载
export async function fetchRenderOutputBlob(token: string, url: string) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`成片加载失败：${response.status}`);
    const blob = await response.blob();
    if (blob.type.includes("json")) throw new Error("成片加载失败");
    return blob;
}

export function listRenderTasks(token: string) {
    return apiGet<RenderTaskResponse[]>("/api/v1/render/tasks", undefined, token);
}

export function getRenderTask(token: string, id: string) {
    return apiGet<RenderTaskResponse>(`/api/v1/render/tasks/${encodeURIComponent(id)}`, undefined, token);
}

export function deleteRenderTask(token: string, id: string) {
    return apiDelete<{ deleted: boolean }>(`/api/v1/render/tasks/${encodeURIComponent(id)}`, token);
}

// 导出剪映草稿工程：直接返回 zip 二进制，失败时后端返回 {code, msg} JSON。
export async function exportJianyingDraft(token: string, timeline: RenderTimelineSpec, draftName?: string) {
    const response = await axios.post<Blob>("/api/v1/render/jianying-draft", { timeline, draftName }, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        responseType: "blob",
        validateStatus: () => true,
    });
    const blob = response.data;
    const ok = response.status >= 200 && response.status < 300 && !(blob.type || "").includes("application/json");
    if (!ok) {
        let reason = "剪映工程导出失败，请稍后重试";
        try {
            const parsed = JSON.parse(await blob.text()) as { msg?: string };
            if (parsed.msg) reason = parsed.msg;
        } catch {
            // 非 JSON 错误体，保留默认提示。
        }
        throw new Error(reason);
    }
    return blob;
}

