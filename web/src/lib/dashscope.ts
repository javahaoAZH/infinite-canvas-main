import { getDataUrlByteSize } from "@/lib/image-utils";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export const DASHSCOPE_PROTOCOL = "dashscope" as const;
export const DASHSCOPE_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
export const DASHSCOPE_DIRECT_CONNECT_ERROR = "百炼渠道不支持浏览器直连，请登录后使用本地后端代理";
export const DASHSCOPE_VIDEO_POLL_INTERVAL_MS = 15000;
export const DASHSCOPE_VIDEO_MAX_WAIT_MS = 20 * 60 * 1000;
const DASHSCOPE_MAX_INPUT_BYTES = 4 * 1024 * 1024;

export function isDashScopeConfig(config: AiConfig, model = config.model) {
    return channelProtocolForConfig({ ...config, model }) === DASHSCOPE_PROTOCOL;
}

export function isDashScopeTtsModel(model: string) {
    return model.trim().toLowerCase().startsWith("qwen3-tts");
}

// 百炼渠道没有浏览器直连能力：未登录时一律拒绝，强制走登录后的本地后端代理
export function assertDashScopeProxyAvailable(config: AiConfig) {
    if (config.channelMode !== "remote" && !useUserStore.getState().token) throw new Error(DASHSCOPE_DIRECT_CONNECT_ERROR);
}

export function dashScopeErrorMessage(payload: unknown, fallback = "") {
    const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
    const message = firstText(root.message, error.message);
    if (message) return message;
    const code = firstText(root.code, error.code);
    return code ? `百炼请求失败：${code}` : fallback;
}

// 图像生成/编辑：multimodal-generation 原生请求体，编辑最多 4 张参考图
export function createDashScopeImageBody(config: AiConfig, model: string, prompt: string, referenceDataUrls: string[], size?: string, n = 1) {
    const content: Array<Record<string, string>> = [{ text: prompt }];
    for (const dataUrl of referenceDataUrls.slice(0, 4)) content.push({ image: dataUrl });
    return {
        model,
        input: { messages: [{ role: "user", content }] },
        parameters: { size: dashScopeImageSize(size), n, prompt_extend: false, watermark: false },
    };
}

// 现有 size 传值为 "宽x高" 像素串，映射成百炼的 "宽*高"；无法映射时用官方合法默认
export function dashScopeImageSize(size?: string) {
    const match = (size || "").trim().match(/^(\d+)x(\d+)$/);
    return match ? `${match[1]}*${match[2]}` : "1328*1328";
}

export function parseDashScopeImageUrls(payload: unknown): string[] {
    const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const error = dashScopeErrorMessage(root);
    if (error) throw new Error(error);
    const output = root.output && typeof root.output === "object" ? root.output as Record<string, unknown> : {};
    const choices = Array.isArray(output.choices) ? output.choices as Array<Record<string, unknown>> : [];
    const urls = choices.flatMap((choice) => {
        const choiceMessage = choice.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
        const content = Array.isArray(choiceMessage.content) ? choiceMessage.content as Array<Record<string, unknown>> : [];
        return content.map((item) => (typeof item.image === "string" ? item.image.trim() : "")).filter(Boolean);
    });
    if (!urls.length) {
        const results = Array.isArray(output.results) ? output.results as Array<Record<string, unknown>> : [];
        urls.push(...results.map((item) => (typeof item.url === "string" ? item.url.trim() : "")).filter(Boolean));
    }
    if (!urls.length) throw new Error("百炼接口没有返回图片");
    return urls;
}

// 图生视频：首帧必填，img_url 传压缩后的 JPEG data URL
export function createDashScopeVideoBody(model: string, prompt: string, firstFrameDataUrl: string) {
    return {
        model,
        input: { prompt, img_url: firstFrameDataUrl },
        parameters: { resolution: "720P", duration: 5 },
    };
}

export function parseDashScopeAudioUrl(payload: unknown) {
    const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const error = dashScopeErrorMessage(root);
    if (error) throw new Error(error);
    const output = root.output && typeof root.output === "object" ? root.output as Record<string, unknown> : {};
    const audio = output.audio && typeof output.audio === "object" ? output.audio as Record<string, unknown> : {};
    const url = typeof audio.url === "string" ? audio.url.trim() : "";
    if (!url) throw new Error("百炼 TTS 没有返回音频地址");
    return url;
}

export function createDashScopeTtsBody(model: string, voice: string, text: string) {
    return {
        model,
        input: {
            text,
            voice: voice.trim() || "Cherry",
            language_type: "Chinese",
        },
    };
}

// 首帧上传前压缩为 JPEG 且 ≤4MB：canvas 缩放 + 降质循环
export async function compressImageToJpegDataUrl(dataUrl: string, maxBytes = DASHSCOPE_MAX_INPUT_BYTES) {
    if (dataUrl.startsWith("data:image/jpeg") && getDataUrlByteSize(dataUrl) <= maxBytes) return dataUrl;
    const image = await loadImage(dataUrl);
    let scale = 1;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((image.naturalWidth || 1024) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || 1024) * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("首帧图片压缩失败");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.92, 0.82, 0.7]) {
            const result = canvas.toDataURL("image/jpeg", quality);
            if (getDataUrlByteSize(result) <= maxBytes) return result;
        }
        scale *= 0.8;
    }
    throw new Error("首帧图片压缩失败：无法压缩到 4MB 以内");
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("首帧图片读取失败"));
        image.src = dataUrl;
    });
}

function firstText(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() || "";
}
