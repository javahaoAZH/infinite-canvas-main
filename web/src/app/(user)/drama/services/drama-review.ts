import { SHOTS_AUTOFIX_SYSTEM_PROMPT, SHOTS_REVIEW_SYSTEM_PROMPT } from "@/app/(user)/drama/prompts";
import { aiApiUrl, aiHeaders, refreshRemoteUser } from "@/services/api/image";
import { dramaTextConfig, useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";

export type ReviewSeverity = "blocker" | "major" | "minor" | "note";
export type ReviewFinding = { severity: ReviewSeverity; location: string; evidence: string; impact: string; suggestion: string };
export type ReviewVerdict = "pass" | "revise" | "rework";
export type ReviewResult = { verdict: ReviewVerdict; findings: ReviewFinding[] };

export const SEMANTIC_PARSE_ERROR = "AI 没有返回有效的审查结果";
const IMAGE_PROCESS_PATTERN = /缓缓|逐渐|随后|继而|最终|一闪而过|开始(?:向|变|动|亮|暗)|完成(?:一次|从|到)|先.+再/;
const IMAGE_NEGATIVE_PATTERN = /不要|不得|禁止|避免|不出现|不能出现|无人物|无文字|无水印|没有人物/;
const COMPOSITION_PATTERN = /远景|全景|中景|中近景|近景|特写|俯拍|俯视|仰拍|仰视|平视|侧视|鸟瞰|低角度|高角度|构图|景深|焦段|留白|画面中央|画面中心/;

// 机械检查：纯前端代码，不调 LLM
export function runMechanicalChecks(project: DramaProject): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    if (!project.shots.length) {
        findings.push({ severity: "blocker", location: "整体", evidence: "分镜列表为空", impact: "后续角色、分镜图、视频、配音步骤都依赖分镜", suggestion: "回到剧本步骤结构化，或点击右上角添加分镜" });
    }
    project.shots.forEach((shot, index) => {
        const location = `分镜 ${index + 1}`;
        if (!shot.description.trim()) {
            findings.push({ severity: "blocker", location, evidence: "画面描述为空", impact: "无法生成分镜图与视频", suggestion: "补充场景、人物动作、构图的画面描述" });
        }
        if (!shot.dialogue.trim() && !(shot.narration || "").trim()) {
            findings.push({ severity: "note", location, evidence: "对白与旁白均为空", impact: "配音步骤没有可生成的内容", suggestion: "若该镜需要配音，补充对白或旁白" });
        }
        if (shot.seconds < 1 || shot.seconds > 30) {
            findings.push({ severity: "major", location, evidence: `时长 ${shot.seconds} 秒超出范围`, impact: "影响视频生成时长与成片节奏", suggestion: "将时长调整到 1-30 秒之间" });
        }
        const imagePrompt = (shot.imagePrompt || "").trim();
        if (!imagePrompt) {
            findings.push({ severity: "major", location, evidence: "缺少出图提示词", impact: "只能用泛化画面描述生图，主体、机位与连续性不可控", suggestion: "补充只描述镜头起点的静态首帧提示词" });
        } else {
            const process = imagePrompt.match(IMAGE_PROCESS_PATTERN)?.[0];
            if (process) findings.push({ severity: "major", location, evidence: process, impact: "首帧混入时间过程，模型无法判断要冻结哪个瞬间", suggestion: "改写为动作发生前、发生中或完成后的一个明确静止状态" });
            const negative = imagePrompt.match(IMAGE_NEGATIVE_PATTERN)?.[0];
            if (negative) findings.push({ severity: "minor", location, evidence: negative, impact: "负面句式在不同图片模型中含义不一致，可能反向生成", suggestion: "改为正向构图描述，排除项交给模型专用负面参数" });
            if (!COMPOSITION_PATTERN.test(`${shot.shotSize || ""} ${imagePrompt}`)) {
                findings.push({ severity: "minor", location, evidence: "未识别到景别或机位", impact: "主体占比和空间关系容易漂移", suggestion: "补充景别、机位或明确构图" });
            }
        }
        const previous = project.shots[index - 1];
        if (previous && shot.description.trim() && shot.description.trim() === previous.description.trim()) {
            findings.push({ severity: "major", location, evidence: "画面描述与上一镜完全相同", impact: "相邻两镜呈现同一画面，浪费镜头", suggestion: "合并两镜，或改变景别、动作与信息" });
        }
    });
    project.characters.forEach((character) => {
        if (!character.description.trim()) {
            findings.push({ severity: "major", location: `角色 ${character.name || "未命名"}`, evidence: "角色描述为空", impact: "无法生成立绘与分镜参考图", suggestion: "补充发型、服饰、标志物等可见的身份锚点" });
        }
        const usedInShots = project.shots.some((shot) => shot.characters?.includes(character.name) || shot.description.includes(character.name));
        if (usedInShots && Object.keys(character.views || {}).length === 0) {
            findings.push({ severity: "major", location: `角色 ${character.name || "未命名"}`, evidence: "尚未分配立绘视图", impact: "人物镜缺少身份参考，跨镜五官、发型与服饰容易漂移", suggestion: "先生成并确认角色立绘，再为人物镜生成分镜图" });
        }
    });
    return findings;
}

function normalizeFinding(raw: { severity?: string; location?: string; evidence?: string; impact?: string; suggestion?: string }): ReviewFinding {
    const severity = (["blocker", "major", "minor", "note"] as ReviewSeverity[]).includes(raw.severity as ReviewSeverity) ? (raw.severity as ReviewSeverity) : "minor";
    return {
        severity,
        location: typeof raw.location === "string" && raw.location.trim() ? raw.location.trim() : "整体",
        evidence: typeof raw.evidence === "string" ? raw.evidence.trim() : "",
        impact: typeof raw.impact === "string" ? raw.impact.trim() : "",
        suggestion: typeof raw.suggestion === "string" ? raw.suggestion.trim() : "",
    };
}

// 语义检查：单次文本生成调用，解析 LLM 返回的结构化 findings
export function parseSemanticReview(content: string): { verdict: ReviewVerdict; findings: ReviewFinding[] } {
    const trimmed = content.replace(/```[a-zA-Z]*\n?/g, "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(SEMANTIC_PARSE_ERROR);
    let parsed: { verdict?: string; findings?: unknown };
    try {
        parsed = JSON.parse(trimmed.slice(start, end + 1)) as { verdict?: string; findings?: unknown };
    } catch {
        throw new Error(SEMANTIC_PARSE_ERROR);
    }
    // 过滤掉 null/非对象元素后再 normalize，避免单条脏数据拖垮整份审查结果
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings.filter((item): item is Record<string, string> => Boolean(item) && typeof item === "object") : [];
    const findings = rawFindings.map(normalizeFinding);
    const verdict = (["pass", "revise", "rework"] as ReviewVerdict[]).includes(parsed.verdict as ReviewVerdict)
        ? (parsed.verdict as ReviewVerdict)
        : findings.length ? "revise" : "pass"; // 未知/缺失 verdict 且无发现时回落 pass，避免“建议修改但零发现”
    return { verdict, findings };
}

// 文本模型单次调用封装：配置校验 → fetch → 错误处理 → 用量刷新 → 返回 content，审查与自动修改共用
export async function callTextModel(systemPrompt: string, userContent: string, effectiveConfig: AiConfig): Promise<string> {
    const textConfig = dramaTextConfig(effectiveConfig);
    if (!useConfigStore.getState().isAiConfigReady(textConfig, textConfig.model)) throw new Error("未配置可用的文本模型渠道");
    const response = await fetch(aiApiUrl(textConfig, "/chat/completions"), {
        method: "POST",
        headers: aiHeaders(textConfig, "application/json"),
        body: JSON.stringify({
            model: textConfig.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
            ],
            stream: false,
        }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
        code?: number;
        msg?: string;
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string | null } }>;
        data?: { choices?: Array<{ message?: { content?: string | null } }> };
    };
    if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
        throw new Error(payload.msg || payload.error?.message || `文本接口请求失败：${response.status}`);
    }
    refreshRemoteUser(textConfig);
    return payload.choices?.[0]?.message?.content || payload.data?.choices?.[0]?.message?.content || "";
}

// 机械检查 + 语义审查：语义阶段任何失败都不丢弃已算出的机械检查结果
export async function reviewShots(project: DramaProject, effectiveConfig: AiConfig): Promise<ReviewResult & { semanticError: string }> {
    const mechanical = runMechanicalChecks(project);
    let semantic: { verdict: ReviewVerdict; findings: ReviewFinding[] } = { verdict: "pass", findings: [] };
    let semanticError = "";
    if (project.shots.length) {
        try {
            const input = JSON.stringify({
                title: project.title,
                characters: project.characters.map((character) => ({ name: character.name, description: character.description })),
                shots: project.shots.map((shot, index) => ({
                    shot: index + 1,
                    description: shot.description,
                    dialogue: shot.dialogue,
                    narration: shot.narration || "",
                    seconds: shot.seconds,
                    shotSize: shot.shotSize || "",
                    camera: shot.camera || "",
                    transition: shot.transition || "",
                    action: shot.action || "",
                    emotion: shot.emotion || "",
                    characters: shot.characters || [],
                    imagePrompt: shot.imagePrompt || "",
                    videoPrompt: shot.videoPrompt || "",
                })),
            });
            semantic = parseSemanticReview(await callTextModel(SHOTS_REVIEW_SYSTEM_PROMPT, input, effectiveConfig));
        } catch (error) {
            // 解析失败用固定友好文案，网络/接口失败统一提示，不暴露原始错误
            semanticError = error instanceof Error && error.message === SEMANTIC_PARSE_ERROR ? SEMANTIC_PARSE_ERROR : "语义审查失败，以下仅为机械检查结果";
        }
    }
    const findings = [...mechanical, ...semantic.findings];
    const hasBlocker = findings.some((finding) => finding.severity === "blocker");
    const hasMajor = findings.some((finding) => finding.severity === "major");
    const verdict: ReviewVerdict = hasBlocker || hasMajor || semantic.verdict === "rework" ? "rework" : findings.some((finding) => finding.severity === "minor") || semantic.verdict === "revise" ? "revise" : "pass";
    return { verdict, findings, semanticError };
}

type AutofixShot = {
    description?: unknown;
    dialogue?: unknown;
    narration?: unknown;
    seconds?: unknown;
    shotSize?: unknown;
    camera?: unknown;
    transition?: unknown;
    action?: unknown;
    emotion?: unknown;
    characters?: unknown;
    imagePrompt?: unknown;
    videoPrompt?: unknown;
};

// 自动修改返回解析：与审查返回同样的去代码块围栏 + 首尾大括号截取模式，解析失败抛错由调用方统一提示
export function parseAutofixShots(content: string): Array<Record<string, unknown>> {
    const trimmed = content.replace(/```[a-zA-Z]*\n?/g, "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("invalid autofix json");
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { shots?: AutofixShot[] };
    if (!Array.isArray(parsed.shots)) throw new Error("invalid autofix json");
    return parsed.shots.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") as Array<Record<string, unknown>>;
}

// 合并前重新读取最新分镜，避免 LLM 返回期间用户编辑被旧快照覆盖，用最新数据做等长校验与合并；description 空值回退原值
export function applyAutofixShots(projectId: string, returned: Array<Record<string, unknown>>): number {
    const latestShots = useDramaStore.getState().projects.find((item) => item.id === projectId)?.shots || [];
    if (returned.length !== latestShots.length) throw new Error("自动修改失败：分镜数量已变化或返回不一致，未改动");
    const shots = latestShots.map((shot, index) => {
        const item = returned[index] || {};
        return {
            ...shot,
            description: (typeof item.description === "string" ? item.description.trim() : "") || shot.description,
            dialogue: typeof item.dialogue === "string" ? item.dialogue.trim() : shot.dialogue,
            narration: typeof item.narration === "string" ? item.narration.trim() : shot.narration || "",
            seconds: Math.max(1, Math.min(30, Math.round(Number(item.seconds)) || shot.seconds)),
            shotSize: typeof item.shotSize === "string" ? item.shotSize.trim() || undefined : shot.shotSize,
            camera: typeof item.camera === "string" ? item.camera.trim() || undefined : shot.camera,
            transition: typeof item.transition === "string" ? item.transition.trim() || undefined : shot.transition,
            action: typeof item.action === "string" ? item.action.trim() || undefined : shot.action,
            emotion: typeof item.emotion === "string" ? item.emotion.trim() || undefined : shot.emotion,
            characters: Array.isArray(item.characters) ? item.characters.map((name) => String(name).trim()).filter(Boolean) : shot.characters,
            imagePrompt: typeof item.imagePrompt === "string" ? item.imagePrompt.trim() || undefined : shot.imagePrompt,
            videoPrompt: typeof item.videoPrompt === "string" ? item.videoPrompt.trim() || undefined : shot.videoPrompt,
        };
    });
    useDramaStore.getState().updateProject(projectId, { shots });
    return shots.length;
}

export type StructuredShot = {
    description?: string;
    dialogue?: string;
    narration?: string;
    seconds?: number;
    shotSize?: string;
    camera?: string;
    transition?: string;
    action?: string;
    emotion?: string;
    characters?: string[];
    imagePrompt?: string;
    videoPrompt?: string;
};
export type StructuredCharacter = { name?: string; description?: string };
export type StructuredScript = { title?: string; characters?: StructuredCharacter[]; shots?: StructuredShot[] };

export function parseStructuredScript(content: string): Required<Pick<StructuredScript, "shots">> & StructuredScript {
    const trimmed = content.replace(/```[a-zA-Z]*\n?/g, "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 没有返回有效的 JSON 数据");
    let parsed: StructuredScript;
    try {
        parsed = JSON.parse(trimmed.slice(start, end + 1)) as StructuredScript;
    } catch {
        throw new Error("AI 返回的 JSON 无法解析");
    }
    const shots = (Array.isArray(parsed.shots) ? parsed.shots : [])
        .map((shot) => ({
            description: typeof shot?.description === "string" ? shot.description.trim() : "",
            dialogue: typeof shot?.dialogue === "string" ? shot.dialogue.trim() : "",
            narration: typeof shot?.narration === "string" ? shot.narration.trim() : "",
            seconds: clampSeconds(shot?.seconds),
            shotSize: typeof shot?.shotSize === "string" ? shot.shotSize.trim() : "",
            camera: typeof shot?.camera === "string" ? shot.camera.trim() : "",
            transition: typeof shot?.transition === "string" ? shot.transition.trim() : "",
            action: typeof shot?.action === "string" ? shot.action.trim() : "",
            emotion: typeof shot?.emotion === "string" ? shot.emotion.trim() : "",
            characters: Array.isArray(shot?.characters) ? shot.characters.map((name) => String(name).trim()).filter(Boolean) : [],
            imagePrompt: typeof shot?.imagePrompt === "string" ? shot.imagePrompt.trim() : "",
            videoPrompt: typeof shot?.videoPrompt === "string" ? shot.videoPrompt.trim() : "",
        }))
        .filter((shot) => shot.description || shot.dialogue);
    if (!shots.length) throw new Error("AI 没有返回任何有效分镜");
    return { ...parsed, shots };
}

function clampSeconds(value: unknown) {
    const seconds = Math.round(Number(value));
    if (!Number.isFinite(seconds)) return 5;
    return Math.max(1, Math.min(30, seconds));
}
