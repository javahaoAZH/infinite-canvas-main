// autodl.art ComfyUI 工作流渠道：模型名即 workflow_id，统一「提交任务 → 轮询结果」两段式调用。
// 认证为裸令牌（Authorization: <令牌>，非 Bearer）；产物 URL 有效期短，完成后需立即下载落本地（见 video.ts 缓存逻辑）。
import { imageToDataUrl } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { COMFYUI_WORKFLOW_INDEX_TTS, COMFYUI_WORKFLOW_LIP_SYNC_VIDEO, COMFYUI_WORKFLOW_MULTI_REF_VIDEO, COMFYUI_WORKFLOW_PROTOCOL } from "@/lib/model-channel";
import { localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { ReferenceImage } from "@/types/image";

// 工作流 ID 与协议常量统一在 model-channel 定义（避免 store 与 lib 循环引用），此处转导出保持既有引用不变
export { COMFYUI_WORKFLOW_INDEX_TTS, COMFYUI_WORKFLOW_LIP_SYNC_VIDEO, COMFYUI_WORKFLOW_MULTI_REF_VIDEO, COMFYUI_WORKFLOW_PROTOCOL };

export function isComfyUIWorkflowConfig(config: AiConfig, model?: string): boolean {
    if (config.channelMode !== "local") return false;
    const requestConfig = model ? { ...config, model } : config;
    return localChannelForActiveModel(requestConfig)?.protocol === COMFYUI_WORKFLOW_PROTOCOL;
}

function comfyUIChannel(config: AiConfig, model?: string) {
    const requestConfig = model ? { ...config, model } : config;
    return localChannelForActiveModel(requestConfig);
}

function comfyUIBaseUrl(config: AiConfig, model?: string) {
    const channel = comfyUIChannel(config, model);
    const base = (channel?.baseUrl || config.baseUrl).trim().replace(/\/+$/, "");
    // 容错不完整地址：只填到 /api/v1 或仅域名时自动补全工作流分组路径
    if (/\/comfyui$/i.test(base)) return base;
    if (/\/api\/v1$/i.test(base)) return `${base}/comfyui`;
    return `${base}/api/v1/comfyui`;
}

export function comfyUISubmitUrl(config: AiConfig, model: string) {
    return `${comfyUIBaseUrl(config, model)}/comfyui_workflow/${encodeURIComponent(model)}`;
}

export function comfyUIPollUrl(config: AiConfig, model: string, taskId: string) {
    return `${comfyUIBaseUrl(config, model)}/comfyui_workflow/result/${encodeURIComponent(taskId)}`;
}

// 裸令牌：autodl 文档要求 Authorization 直接放令牌，不加 Bearer 前缀
export function comfyUIHeaders(config: AiConfig, model?: string) {
    const channel = comfyUIChannel(config, model);
    const token = channel?.apiKey || config.apiKey;
    if (!token.trim()) throw new Error("请先配置 ComfyUI 渠道令牌");
    return { Authorization: token.trim(), "Content-Type": "application/json" };
}

// 分辨率与宽高比合并在同一字段：768p横=16:9、768p竖=9:16、768p(1:1)
export function normalizeComfyUIResolution(vquality: string, size: string) {
    const value = String(vquality || "").trim().toLowerCase();
    const tier = value === "low" || value === "480" || value === "480p" ? "480p"
        : value === "1080" || value === "1080p" || value === "high" ? "1080p"
            : "768p";
    const normalizedSize = String(size || "").trim().toLowerCase();
    const portrait = ["9:16", "2:3", "3:4", "720x1280", "1080x1920"].includes(normalizedSize);
    const square = ["1:1", "1024x1024", "1080x1080"].includes(normalizedSize);
    return square ? `${tier}(1:1)` : portrait ? `${tier}竖` : `${tier}横`;
}

export function normalizeComfyUIVideoDuration(secondsValue: string | number | undefined, maxSeconds: number) {
    const seconds = Math.floor(Number(secondsValue) || 5);
    return Math.max(1, Math.min(maxSeconds, seconds));
}

// 多图参考生视频（v5）：首帧 + 参考图合并填 ref_image_0..8，图片以 base64 dataUrl 直传
export async function createComfyUIMultiRefVideoBody(config: AiConfig, prompt: string, firstFrame: ReferenceImage | null, references: ReferenceImage[]) {
    const images = [firstFrame, ...references].filter((image): image is ReferenceImage => Boolean(image));
    if (!images.length) throw new Error("ComfyUI 多图参考生视频必须提供首帧或参考图");
    const dataUrls = await Promise.all(images.slice(0, 9).map((image) => imageToDataUrl(image)));
    const body: Record<string, unknown> = {
        prompt,
        duration: normalizeComfyUIVideoDuration(config.videoSeconds, 10),
        resolution: normalizeComfyUIResolution(config.vquality, config.size),
    };
    dataUrls.forEach((dataUrl, index) => { body[`ref_image_${index}`] = dataUrl; });
    return body;
}

// 音频入参官方支持公网 URL / base64 dataUrl 两种格式：优先公网地址，不可用时读本地 blob 转 base64 兜底
async function comfyUIAudioParam(audio: ReferenceAudio | ReferenceVideo) {
    const url = await resolveMediaUrl(audio.storageKey, audio.url).catch(() => audio.url || "");
    if (isPublicHttpUrl(url)) return url;
    if (isPublicHttpUrl(audio.url)) return audio.url;
    const blob = audio.storageKey ? await getMediaBlob(audio.storageKey).catch(() => null) : null;
    const source = blob || (audio.url ? await fetch(audio.url).then((r) => (r.ok ? r.blob() : null)).catch(() => null) : null);
    if (!source) throw new Error("ComfyUI 工作流音频入参需要公网地址或可读取的本地音频，请重新上传音频参考");
    return blobToDataUrl(source);
}

function isPublicHttpUrl(url: string) {
    return /^https?:\/\//.test(url) && !["localhost", "127.0.0.1", "::1"].includes(safeHostname(url));
}

// 对口型工作流文档明确音频入参为 URL：仅接受公网地址，非公网素材报错引导走服务端存储
async function comfyUIPublicAudioUrl(audio: ReferenceAudio | ReferenceVideo) {
    const url = await resolveMediaUrl(audio.storageKey, audio.url).catch(() => audio.url || "");
    if (isPublicHttpUrl(url)) return url;
    if (isPublicHttpUrl(audio.url)) return audio.url;
    throw new Error("对口型工作流的音频入参需要公网可访问地址，请先将音频上传到服务端存储");
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取音频失败"));
        reader.readAsDataURL(blob);
    });
}

function safeHostname(url: string) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

// 对口型工作流：分镜图 base64 直传 + 配音音频公网 URL 驱动（无提示词字段）
export async function createComfyUILipSyncVideoBody(config: AiConfig, frame: ReferenceImage, audio: ReferenceAudio) {
    const audioUrl = await comfyUIPublicAudioUrl(audio);
    const durationSeconds = audio.durationMs ? Math.ceil(audio.durationMs / 1000) : Number(config.videoSeconds) || 5;
    const resolution = normalizeComfyUIResolution(config.vquality, config.size);
    return {
        ref_image_0: await imageToDataUrl(frame),
        ref_audio_0: audioUrl,
        audio_duration: Math.max(1, Math.min(15, durationSeconds)),
        // 对口型工作流分辨率枚举没有 (1:1) 档，方屏降级为横屏
        resolution: resolution.endsWith("(1:1)") ? resolution.replace("(1:1)", "横") : resolution,
    };
}

// IndexTTS2 配音：台词 + 音色参考音频（音色克隆）；emo_control_method 为必填枚举，当前唯一可选值「与音色参考音频相同」（情感跟随音色参考）
export async function createComfyUITtsBody(prompt: string, referenceAudio?: ReferenceAudio) {
    if (!referenceAudio) throw new Error("IndexTTS2 需要音色参考音频，请先为角色或旁白设置参考音频");
    return {
        prompt_text: prompt,
        prompt_simple: await comfyUIAudioParam(referenceAudio),
        emo_control_method: "与音色参考音频相同",
    };
}

export function parseComfyUITaskId(payload: unknown): string {
    const data = comfyUIData(payload);
    const taskId = typeof data.task_id === "string" ? data.task_id.trim() : "";
    if (!taskId) throw new Error("ComfyUI 工作流没有返回任务 ID");
    return taskId;
}

export type ComfyUITaskStatus = { status: "processing" | "completed" | "failed"; url: string; message: string; taskId: string };

// 轮询结果归一化：QUEUED/RUNNING→processing，SUCCESS/completed→completed，FAILED→failed；产物取 results[0].url
export function parseComfyUITaskStatus(payload: unknown): ComfyUITaskStatus {
    const data = comfyUIData(payload);
    const raw = String(data.status || "").trim().toLowerCase();
    const results = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : [];
    const url = results.map((item) => (typeof item?.url === "string" ? item.url.trim() : "")).find(Boolean) || "";
    const message = typeof data.message === "string" ? data.message : "";
    if (["success", "completed", "complete", "done"].includes(raw)) {
        return { status: url ? "completed" : "failed", url, message: url ? "" : message || "工作流任务完成但没有返回产物地址", taskId: typeof data.task_id === "string" ? data.task_id : "" };
    }
    if (["failed", "fail", "error", "cancelled", "canceled"].includes(raw)) {
        return { status: "failed", url: "", message: message || "工作流任务执行失败", taskId: typeof data.task_id === "string" ? data.task_id : "" };
    }
    return { status: "processing", url: "", message, taskId: typeof data.task_id === "string" ? data.task_id : "" };
}

// 提交失败时上游返回 { code: "Fail...", msg }；成功为 code: "Success"
export function assertComfyUIResponseOk(payload: unknown) {
    const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    const code = typeof record.code === "string" ? record.code : "";
    if (code && !/success/i.test(code)) {
        const message = typeof record.msg === "string" && record.msg.trim() ? record.msg : typeof record.message === "string" ? record.message : "";
        throw new Error(message || `ComfyUI 工作流请求失败（${code}）`);
    }
}

function comfyUIData(payload: unknown): Record<string, unknown> {
    const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    return record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
}
