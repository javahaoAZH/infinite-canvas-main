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

