import { apiPost } from "@/services/api/request";
import { aiApiUrl, aiHeaders, refreshRemoteUser } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";

export type SubtitleDialogueEntry = {
    text: string;
    startMs: number;
    endMs: number;
};

const AI_SPLIT_TIMEOUT_MS = 60000;

export function buildSrtFromDialogue(token: string, dialogue: SubtitleDialogueEntry[]) {
    return apiPost<{ srt: string }>("/api/v1/subtitles/from-dialogue", { dialogue }, token);
}

// 复用现有文本渠道（use-config-store 配置 + chat/completions 请求方式），
// 让模型把剧本对白切分为带时间戳的 JSON 条目，前端负责 schema 校验与钳制。
export async function splitDialogueWithAI(config: AiConfig, dialogueText: string, totalSeconds: number, signal?: AbortSignal): Promise<SubtitleDialogueEntry[]> {
    const textConfig: AiConfig = {
        ...config,
        model: config.textModel || config.model,
        activeChannelId: config.textChannelId || config.activeChannelId,
        textChannelId: config.textChannelId,
    };
    const systemPrompt =
        "你是字幕时间轴助手。用户会给你视频总时长和一份剧本对白，你需要把对白切分为字幕条目并估算每条的起止时间（毫秒）。" +
        "严格按对白顺序逐条输出，不合并、不遗漏、不改写文本；时间均匀分布在总时长内，开始时间小于结束时间，相邻条目尽量不重叠。" +
        "只输出一个 JSON 数组，格式为 [{\"text\":\"对白文本\",\"startMs\":0,\"endMs\":1000}]，不要输出任何其他文字、注释或代码块标记。";
    const body = {
        model: textConfig.model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `视频总时长：${totalSeconds} 秒\n\n剧本对白：\n${dialogueText}` },
        ],
        stream: false,
    };
    const response = await fetch(aiApiUrl(textConfig, "/chat/completions"), {
        method: "POST",
        headers: aiHeaders(textConfig, "application/json"),
        body: JSON.stringify(body),
        signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
        code?: number;
        msg?: string;
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string | null } }>;
        data?: { choices?: Array<{ message?: { content?: string | null } }> };
    };
    if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
        throw new Error(payload.msg || payload.error?.message || `AI 切分请求失败：${response.status}`);
    }
    const content = payload.choices?.[0]?.message?.content || payload.data?.choices?.[0]?.message?.content || "";
    refreshRemoteUser(textConfig);
    return parseAISubtitleEntries(content, totalSeconds);
}

// 不信任模型原始输出：提取 JSON 数组后逐条校验字段类型，并把时间钳制到视频总时长内。
function parseAISubtitleEntries(content: string, totalSeconds: number): SubtitleDialogueEntry[] {
    const trimmed = content.replace(/```[a-zA-Z]*\n?/g, "").trim();
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("AI 没有返回有效的 JSON 数组，可改用「从对白文本生成」");
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
        throw new Error("AI 返回的 JSON 无法解析，可改用「从对白文本生成」");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("AI 没有返回任何字幕条目，可改用「从对白文本生成」");

    const totalMs = Math.max(0, Math.round(totalSeconds * 1000));
    const entries: SubtitleDialogueEntry[] = [];
    for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const text = typeof record.text === "string" ? record.text.trim() : "";
        let startMs = toFiniteMs(record.startMs);
        let endMs = toFiniteMs(record.endMs);
        if (!text || startMs === null || endMs === null) continue;
        if (totalMs > 0) {
            startMs = Math.min(Math.max(0, startMs), totalMs);
            endMs = Math.min(Math.max(0, endMs), totalMs);
        }
        if (endMs <= startMs) continue;
        entries.push({ text, startMs, endMs });
    }
    if (entries.length === 0) throw new Error("AI 返回的字幕条目全部无效，可改用「从对白文本生成」");
    entries.sort((a, b) => a.startMs - b.startMs);
    return entries;
}

function toFiniteMs(value: unknown): number | null {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.round(number) : null;
}

export function createSubtitleAbortSignal() {
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(), AI_SPLIT_TIMEOUT_MS);
    return controller;
}
