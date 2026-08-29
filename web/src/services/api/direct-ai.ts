import { apiPost } from "@/services/api/request";
import { buildApiUrl, localChannelForActiveModel, type AiConfig, type DirectAIProvider } from "@/stores/use-config-store";

type DirectRequestBody = Record<string, unknown> | FormData;
type DirectReferenceKind = "image" | "video" | "audio";
type DirectReference = { marker: string; file: File; kind: DirectReferenceKind };
type DirectUploadSpec = { url: string; fileField: string; fileNameField?: string; extraFields?: Record<string, string>; responsePaths: string[] };
type DirectRequestPlan = { provider: DirectAIProvider; url: string; contentType: string; body: unknown; uploads?: Partial<Record<DirectReferenceKind, DirectUploadSpec>> };
type DirectImageResponse = { created?: number; data: Array<{ url?: string; b64_json?: string }> };
type DirectVideoResponse = { id: string; task_id?: string; video_id?: string; status?: string; progress?: number; video_url?: string; url?: string; error?: { message?: string }; model?: string };
type SerializedDirectBody = { body: unknown; references: DirectReference[] };

const DIRECT_REFERENCE_HOST = "direct-reference.invalid";
const DIRECT_IMAGE_POLL_INTERVAL_MS = 2000;

export async function requestDirectImages(config: AiConfig, provider: DirectAIProvider, endpoint: "/images/generations" | "/images/edits", body: DirectRequestBody, timeoutSeconds: number): Promise<DirectImageResponse> {
    const startedAt = Date.now();
    const { plan, requestBody, apiKey } = await prepareDirectRequest(config, provider, endpoint, body);
    const created = await requestDirectJSON(plan.url, apiKey, plan.contentType, requestBody, remainingTimeoutMs(startedAt, timeoutSeconds));
    const directUrls = readDirectImageURLs(provider, created);
    if (directUrls.length) return directImageResponse(directUrls);
    const taskId = readDirectTaskId(provider, created);
    if (!taskId) throw new Error(readDirectError(created) || "图片接口没有返回结果或任务 ID");

    for (;;) {
        const waitMs = Math.min(DIRECT_IMAGE_POLL_INTERVAL_MS, remainingTimeoutMs(startedAt, timeoutSeconds));
        await delay(waitMs);
        const payload = await requestDirectJSON(directPollURL(config, provider, taskId), apiKey, "", undefined, remainingTimeoutMs(startedAt, timeoutSeconds));
        const result = readDirectImagePoll(provider, payload);
        if (result.error) throw new Error(result.error);
        if (result.urls.length) return directImageResponse(result.urls);
        if (result.done) throw new Error("图片任务已完成但没有返回图片地址");
    }
}

export async function createDirectVideoTask(config: AiConfig, provider: DirectAIProvider, body: DirectRequestBody): Promise<DirectVideoResponse> {
    const { plan, requestBody, apiKey } = await prepareDirectRequest(config, provider, "/videos", body);
    const payload = await requestDirectJSON(plan.url, apiKey, plan.contentType, requestBody);
    const taskId = readDirectTaskId(provider, payload);
    if (!taskId) throw new Error(readDirectError(payload) || "视频接口没有返回任务 ID");
    return {
        id: taskId,
        task_id: taskId,
        status: normalizeDirectStatus(provider === "kie" ? "processing" : readString(readPath(payload, "data.0.status"))),
        model: config.model || config.videoModel,
    };
}

export async function pollDirectVideoTask(config: AiConfig, provider: DirectAIProvider, pollId: string): Promise<DirectVideoResponse> {
    const channel = requireDirectChannel(config);
    const payload = await requestDirectJSON(directPollURL(config, provider, pollId), channel.apiKey, "", undefined);
    if (provider === "kie") {
        const data = asRecord(readPath(payload, "data"));
        const error = firstString(data.failMsg, data.failCode, readDirectError(payload));
        const videoUrl = firstHTTPURL(parseJSONValue(data.resultJson));
        return {
            id: firstString(data.taskId, pollId),
            task_id: firstString(data.taskId, pollId),
            status: normalizeDirectStatus(firstString(data.state, videoUrl ? "completed" : "processing")),
            progress: readNumber(data.progress),
            ...(videoUrl ? { video_url: videoUrl, url: videoUrl } : {}),
            ...(error ? { error: { message: error } } : {}),
            model: config.model || config.videoModel,
        };
    }

    const data = asRecord(readPath(payload, "data"));
    const error = firstString(readPath(data, "error.message"), readDirectError(payload));
    const videoUrl = firstHTTPURL(data.result);
    return {
        id: firstString(data.id, pollId),
        task_id: firstString(data.id, pollId),
        status: normalizeDirectStatus(firstString(data.status, videoUrl ? "completed" : "processing")),
        progress: readNumber(data.progress),
        ...(videoUrl ? { video_url: videoUrl, url: videoUrl } : {}),
        ...(error ? { error: { message: error } } : {}),
        model: config.model || config.videoModel,
    };
}

async function prepareDirectRequest(config: AiConfig, provider: DirectAIProvider, endpoint: "/images/generations" | "/images/edits" | "/videos", body: DirectRequestBody) {
    const channel = requireDirectChannel(config);
    const serialized = await serializeDirectBody(body);
    assertSafeDirectBody(serialized.body);
    const plan = await apiPost<DirectRequestPlan>("/api/ai/direct-request", {
        channel: { protocol: channel.protocol, baseUrl: channel.baseUrl },
        model: config.model || config.videoModel,
        endpoint,
        body: serialized.body,
    });
    if (plan.provider !== provider) throw new Error("前后端渠道识别结果不一致");
    const requestBody = await uploadAndReplaceReferences(plan, serialized.references, channel.apiKey);
    return { plan, requestBody, apiKey: channel.apiKey };
}

function requireDirectChannel(config: AiConfig) {
    const channel = localChannelForActiveModel(config);
    if (!channel?.baseUrl.trim() || !channel.apiKey.trim()) throw new Error("本地渠道地址或 API Key 不能为空");
    return channel;
}

async function serializeDirectBody(body: DirectRequestBody): Promise<SerializedDirectBody> {
    const references: DirectReference[] = [];
    const runId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const serialize = async (value: unknown, key = ""): Promise<unknown> => {
        if (isFile(value)) return registerDirectReference(value, key, runId, references);
        if (isBlob(value)) return registerDirectReference(new File([value], directReferenceFilename(referenceKind(value.type, key), value.type), { type: value.type || "application/octet-stream" }), key, runId, references);
        if (typeof value === "string" && (isMediaDataURL(value) || value.startsWith("blob:"))) {
            const file = await directReferenceFileFromURL(value, key);
            return registerDirectReference(file, key, runId, references);
        }
        if (Array.isArray(value)) return Promise.all(value.map((item) => serialize(item, key)));
        if (isPlainRecord(value)) {
            const entries = await Promise.all(Object.entries(value).map(async ([entryKey, item]) => [entryKey, await serialize(item, entryKey)] as const));
            return Object.fromEntries(entries);
        }
        return value;
    };

    if (!(body instanceof FormData)) return { body: await serialize(body), references };
    const result: Record<string, unknown> = {};
    const counts = new Map<string, number>();
    for (const [key, value] of body.entries()) {
        let serializedValue: unknown = value;
        if (typeof value === "string") {
            const parsed = parseJSONString(value);
            serializedValue = await serialize(parsed, key);
        } else {
            serializedValue = await serialize(value, key);
        }
        appendDirectFormValue(result, counts, key, serializedValue);
    }
    return { body: result, references };
}

function registerDirectReference(file: File, key: string, runId: string, references: DirectReference[]) {
    const kind = referenceKind(file.type, key);
    const marker = `https://${DIRECT_REFERENCE_HOST}/${runId}/${kind}/${references.length}`;
    references.push({ marker, file, kind });
    return marker;
}

function appendDirectFormValue(result: Record<string, unknown>, counts: Map<string, number>, key: string, value: unknown) {
    const count = counts.get(key) || 0;
    counts.set(key, count + 1);
    if (count === 0) {
        result[key] = value;
        return;
    }
    if (count === 1) {
        result[key] = [result[key], value];
        return;
    }
    (result[key] as unknown[]).push(value);
}

async function directReferenceFileFromURL(value: string, key: string) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`参考素材读取失败：${response.status}`);
    const blob = await response.blob();
    const type = blob.type || mediaTypeFromDataURL(value) || "application/octet-stream";
    return new File([blob], directReferenceFilename(referenceKind(type, key), type), { type });
}

function directReferenceFilename(kind: DirectReferenceKind, type: string) {
    const extension = type.split("/")[1]?.split(/[;+]/)[0]?.replace("jpeg", "jpg") || (kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3");
    return `reference.${extension}`;
}

function referenceKind(type: string, key: string): DirectReferenceKind {
    const normalizedType = type.toLowerCase();
    const normalizedKey = key.toLowerCase();
    if (normalizedType.startsWith("video/") || normalizedKey.includes("video")) return "video";
    if (normalizedType.startsWith("audio/") || normalizedKey.includes("audio") || normalizedKey.includes("voice")) return "audio";
    return "image";
}

function isFile(value: unknown): value is File {
    return typeof File !== "undefined" && value instanceof File;
}

function isBlob(value: unknown): value is Blob {
    return typeof Blob !== "undefined" && value instanceof Blob;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isMediaDataURL(value: string) {
    return /^data:(image|video|audio)\//i.test(value);
}

function mediaTypeFromDataURL(value: string) {
    return value.match(/^data:([^;,]+)/i)?.[1] || "";
}

function parseJSONString(value: string): unknown {
    const text = value.trim();
    if (!text) return value;
    try {
        return JSON.parse(text);
    } catch {
        return value;
    }
}

function assertSafeDirectBody(value: unknown) {
    if (isFile(value) || isBlob(value)) throw new Error("参考文件不能传给参数转译接口");
    if (typeof value === "string") {
        if (isMediaDataURL(value) || value.startsWith("blob:")) throw new Error("参考文件不能传给参数转译接口");
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(assertSafeDirectBody);
        return;
    }
    if (isPlainRecord(value)) Object.values(value).forEach(assertSafeDirectBody);
}

async function uploadAndReplaceReferences(plan: DirectRequestPlan, references: DirectReference[], apiKey: string) {
    const retained = references.filter((reference) => containsDirectMarker(plan.body, reference.marker));
    const uploaded = new Map<string, string>();
    await Promise.all(retained.map(async (reference) => {
        const spec = plan.uploads?.[reference.kind];
        if (!spec) throw new Error(`${plan.provider} 不支持上传本地${directReferenceKindName(reference.kind)}`);
        uploaded.set(reference.marker, await uploadDirectReference(spec, reference.file, apiKey));
    }));
    const replaced = replaceDirectMarkers(plan.body, uploaded);
    if (containsAnyDirectMarker(replaced)) throw new Error("参考素材地址替换失败");
    return replaced;
}

async function uploadDirectReference(spec: DirectUploadSpec, file: File, apiKey: string) {
    const formData = new FormData();
    formData.append(spec.fileField, file, file.name);
    if (spec.fileNameField) formData.append(spec.fileNameField, file.name);
    Object.entries(spec.extraFields || {}).forEach(([key, value]) => formData.append(key, value));
    const response = await fetch(spec.url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: formData });
    const payload = await readDirectResponse(response);
    if (!response.ok) throw new Error(readDirectError(payload) || `参考素材上传失败：${response.status}`);
    const error = readDirectError(payload);
    if (error) throw new Error(error);
    for (const path of spec.responsePaths) {
        const value = readString(readPath(payload, path));
        if (value) return value;
    }
    throw new Error("参考素材上传成功但没有返回文件地址");
}

function containsDirectMarker(value: unknown, marker: string): boolean {
    if (value === marker) return true;
    if (Array.isArray(value)) return value.some((item) => containsDirectMarker(item, marker));
    if (isPlainRecord(value)) return Object.values(value).some((item) => containsDirectMarker(item, marker));
    return false;
}

function containsAnyDirectMarker(value: unknown): boolean {
    if (typeof value === "string") {
        try {
            return new URL(value).hostname === DIRECT_REFERENCE_HOST;
        } catch {
            return false;
        }
    }
    if (Array.isArray(value)) return value.some(containsAnyDirectMarker);
    if (isPlainRecord(value)) return Object.values(value).some(containsAnyDirectMarker);
    return false;
}

function replaceDirectMarkers(value: unknown, uploaded: Map<string, string>): unknown {
    if (typeof value === "string") return uploaded.get(value) || value;
    if (Array.isArray(value)) return value.map((item) => replaceDirectMarkers(item, uploaded));
    if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDirectMarkers(item, uploaded)]));
    return value;
}

async function requestDirectJSON(url: string, apiKey: string, contentType: string, body?: unknown, timeoutMs?: number) {
    const controller = new AbortController();
    const timeout = timeoutMs ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
    try {
        const response = await fetch(url, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                ...(body === undefined ? {} : { "Content-Type": contentType || "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: controller.signal,
        });
        const payload = await readDirectResponse(response);
        if (!response.ok) throw new Error(readDirectError(payload) || `上游请求失败：${response.status}`);
        const error = readDirectError(payload);
        if (error) throw new Error(error);
        return payload;
    } finally {
        if (timeout) window.clearTimeout(timeout);
    }
}

async function readDirectResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}

function directPollURL(config: AiConfig, provider: DirectAIProvider, taskId: string) {
    const channel = requireDirectChannel(config);
    return provider === "kie"
        ? buildApiUrl(channel.baseUrl, `/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`)
        : buildApiUrl(channel.baseUrl, `/tasks/${encodeURIComponent(taskId)}?language=zh`);
}

function readDirectTaskId(provider: DirectAIProvider, payload: unknown) {
    return provider === "kie"
        ? readString(readPath(payload, "data.taskId"))
        : firstString(readPath(payload, "data.0.task_id"), readPath(payload, "data.task_id"), readPath(payload, "data.id"));
}

function readDirectImageURLs(provider: DirectAIProvider, payload: unknown) {
    if (provider === "apimart") {
        const data = readPath(payload, "data");
        if (Array.isArray(data)) return uniqueHTTPURLs(data.flatMap((item) => collectHTTPURLs(asRecord(item).url)));
    }
    return [];
}

function readDirectImagePoll(provider: DirectAIProvider, payload: unknown) {
    if (provider === "kie") {
        const data = asRecord(readPath(payload, "data"));
        const urls = uniqueHTTPURLs(collectHTTPURLs(parseJSONValue(data.resultJson)));
        const status = normalizeDirectStatus(firstString(data.state, urls.length ? "completed" : "processing"));
        return { urls, done: status === "completed", error: status === "failed" ? firstString(data.failMsg, data.failCode, readDirectError(payload), "图片生成失败") : "" };
    }
    const data = asRecord(readPath(payload, "data"));
    const urls = uniqueHTTPURLs(collectHTTPURLs(data.result));
    const status = normalizeDirectStatus(firstString(data.status, urls.length ? "completed" : "processing"));
    return { urls, done: status === "completed", error: status === "failed" ? firstString(readPath(data, "error.message"), readDirectError(payload), "图片生成失败") : "" };
}

function directImageResponse(urls: string[]): DirectImageResponse {
    return { created: Math.floor(Date.now() / 1000), data: urls.map((url) => ({ url })) };
}

function readDirectError(payload: unknown) {
    const code = readNumber(readPath(payload, "code"));
    const explicitError = firstString(readPath(payload, "error.message"), readPath(payload, "data.error.message"), readPath(payload, "data.failMsg"), readPath(payload, "data.failCode"));
    if (explicitError) return explicitError;
    if (code !== undefined && code !== 0 && code !== 200) return firstString(readPath(payload, "msg"), readPath(payload, "message"), `上游请求失败：${code}`);
    return "";
}

function normalizeDirectStatus(value: string) {
    switch (value.trim().toLowerCase()) {
        case "success":
        case "succeeded":
        case "completed":
            return "completed";
        case "fail":
        case "failed":
        case "cancelled":
        case "canceled":
            return "failed";
        default:
            return "processing";
    }
}

function collectHTTPURLs(value: unknown, depth = 0): string[] {
    if (value === null || value === undefined || depth > 8) return [];
    if (typeof value === "string") {
        const text = value.trim();
        if (/^https?:\/\//i.test(text)) return [text];
        const parsed = parseJSONValue(text);
        return parsed === text ? [] : collectHTTPURLs(parsed, depth + 1);
    }
    if (Array.isArray(value)) return value.flatMap((item) => collectHTTPURLs(item, depth + 1));
    if (isPlainRecord(value)) return Object.values(value).flatMap((item) => collectHTTPURLs(item, depth + 1));
    return [];
}

function firstHTTPURL(value: unknown) {
    return uniqueHTTPURLs(collectHTTPURLs(value))[0] || "";
}

function uniqueHTTPURLs(values: string[]) {
    return [...new Set(values.filter((value) => /^https?:\/\//i.test(value)))];
}

function parseJSONValue(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text || !["{", "["].includes(text[0])) return value;
    try {
        return JSON.parse(text);
    } catch {
        return value;
    }
}

function readPath(value: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => {
        if (Array.isArray(current)) return current[Number(key)];
        return isPlainRecord(current) ? current[key] : undefined;
    }, value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return isPlainRecord(value) ? value : {};
}

function readString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : undefined;
}

function firstString(...values: unknown[]) {
    for (const value of values) {
        const text = readString(value);
        if (text) return text;
    }
    return "";
}

function directReferenceKindName(kind: DirectReferenceKind) {
    if (kind === "video") return "视频";
    if (kind === "audio") return "音频";
    return "图片";
}

function remainingTimeoutMs(startedAt: number, timeoutSeconds: number) {
    const remaining = timeoutSeconds * 1000 - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error(`请求超时（${timeoutSeconds} 秒）`);
    return remaining;
}

function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
