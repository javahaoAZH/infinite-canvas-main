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
    const normalizedScript = project.script.replace(/\s+/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const assetKeys = new Set((project.plannedAssets || []).map((asset) => asset.key));
    const duplicateAssetKeys = (project.plannedAssets || []).map((asset) => asset.key).filter((key, index, all) => key && all.indexOf(key) !== index);
    if (duplicateAssetKeys.length) {
        findings.push({ severity: "blocker", location: "资产圣经", evidence: [...new Set(duplicateAssetKeys)].join("、"), impact: "重复 key 会让镜头引用到不确定的资产", suggestion: "为每个资产设置全项目唯一 key" });
    }
    if (!project.shots.length) {
        findings.push({ severity: "blocker", location: "整体", evidence: "分镜列表为空", impact: "后续角色、分镜图、视频、配音步骤都依赖分镜", suggestion: "回到剧本步骤结构化，或点击右上角添加分镜" });
    }
    if (!project.sourceCoverage?.length) {
        findings.push({ severity: "blocker", location: "原文覆盖台账", evidence: "覆盖台账为空", impact: "无法证明小说的重要信息均已进入画面、对白、旁白或音效", suggestion: "重新完整拆解原文并为每条信息填写去向与镜号" });
    } else {
        project.sourceCoverage.forEach((item, index) => {
            const quote = item.quote.replace(/\s+/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
            if (!quote || !normalizedScript.includes(quote)) findings.push({ severity: "blocker", location: `覆盖台账 ${index + 1}`, evidence: item.quote || "引文为空", impact: "该项无法回到小说原文核验", suggestion: "改为能够逐字定位的原文短引文" });
            if (item.disposition === "暂不采用" && !item.note?.trim()) findings.push({ severity: "major", location: `覆盖台账 ${index + 1}`, evidence: item.quote, impact: "原文内容被删除但没有改编理由", suggestion: "说明暂不采用原因，或安排进对应镜头" });
            if (item.disposition !== "暂不采用" && !item.shotNumbers.length) findings.push({ severity: "blocker", location: `覆盖台账 ${index + 1}`, evidence: item.quote, impact: "原文信息没有落到具体镜头", suggestion: "补充对应镜号" });
            const invalidShots = item.shotNumbers.filter((number) => !Number.isInteger(number) || number < 1 || number > project.shots.length);
            if (invalidShots.length) findings.push({ severity: "blocker", location: `覆盖台账 ${index + 1}`, evidence: invalidShots.join("、"), impact: "原文信息指向了不存在的镜头", suggestion: "修正为当前分镜表中的有效镜号" });
        });
    }
    if (!project.plannedAssets?.length) {
        findings.push({ severity: "blocker", location: "资产圣经", evidence: "资产列表为空", impact: "无法锁定人物、场景、道具、状态和动作锚点", suggestion: "逐段提取原文名词、状态变化与接触动作并建立独立资产" });
    } else {
        project.plannedAssets.forEach((asset) => {
            const location = `资产 ${asset.name || asset.key || "未命名"}`;
            if (!asset.key || !asset.sourceEvidence.trim() || !asset.specification.trim() || !asset.lock.trim() || !asset.deliverables.length) findings.push({ severity: "blocker", location, evidence: "资产字段或交付件不完整", impact: "MCP 无法寻址、复用或核对该资产", suggestion: "补齐稳定 key、证据、规格、锁定段和独立交付件" });
            if (asset.factLevel !== "改编设计" && !normalizedScript.includes(asset.sourceEvidence.replace(/\s+/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'"))) findings.push({ severity: "blocker", location, evidence: asset.sourceEvidence, impact: "资产依据无法回到小说核验", suggestion: "改用可逐字定位的原文短引文" });
            const invalidDependencies = asset.dependencies.filter((key) => key === asset.key || !assetKeys.has(key));
            if (invalidDependencies.length) findings.push({ severity: "blocker", location, evidence: invalidDependencies.join("、"), impact: "资产依赖无法解析", suggestion: "改为资产圣经中已存在且不是自身的 key" });
        });
    }
    project.shots.forEach((shot, index) => {
        const location = `分镜 ${index + 1}`;
        if (!(shot.sourceEvidence || "").trim()) {
            findings.push({ severity: "blocker", location, evidence: "缺少原文证据", impact: "无法检查该镜是否漏读、误读或擅自补写小说", suggestion: "填写能直接支持本镜内容的原文短引文" });
        }
        if (!(shot.location || "").trim()) {
            findings.push({ severity: "major", location, evidence: "缺少具体场景", impact: "无法选择场景母版与拍摄方向", suggestion: "填写可对应场景资产的具体地点" });
        }
        if (!(shot.storyTime || "").trim()) {
            findings.push({ severity: "major", location, evidence: "缺少叙事时点", impact: "昼夜、梦境或闪回状态无法稳定继承", suggestion: "填写本镜的日夜、梦境或叙事时点" });
        }
        if (!(shot.shotPurpose || "").trim()) {
            findings.push({ severity: "major", location, evidence: "缺少镜头职责", impact: "无法判断该镜是否重复、漏拍或承担过多信息", suggestion: "用一句话写清本镜唯一要传递的变化" });
        }
        if (!(shot.startState || "").trim() || !(shot.endState || "").trim()) {
            findings.push({ severity: "major", location, evidence: "缺少起始态或结束态", impact: "图生视频缺少明确动作边界，相邻镜也无法做连续性检查", suggestion: "补齐人物姿势、持物、道具位置与环境状态的起止差异" });
        }
        if (!(shot.continuity || "").trim()) {
            findings.push({ severity: "major", location, evidence: "缺少连续性说明", impact: "下一镜无法核对姿势、持物、空间与光色继承", suggestion: "写明承接上一镜并必须带入下一镜的状态；首镜也标注为开场基准" });
        }
        if (!(shot.qualityCriteria || "").trim()) {
            findings.push({ severity: "major", location, evidence: "缺少质检标准", impact: "生成结果只能凭感觉验收，人物、资产与人体工学错误容易进入批量生产", suggestion: "补充看图即可判断的身份、版本、接触动作、空间和特效通过条件" });
        }
        if (!Array.isArray(shot.characters)) {
            findings.push({ severity: "major", location, evidence: "未声明出场角色", impact: "无法区分空镜和角色识别遗漏，可能凭空生成人物或漏带身份参考", suggestion: "显式列出出场人物；空镜写空数组" });
        }
        if (!shot.assetRefs?.length) {
            findings.push({ severity: "blocker", location, evidence: "所需资产为空", impact: "镜头可见元素不会进入生产清单，生图时会被静默遗漏或漂移", suggestion: "为场景、人物、独立道具、动作姿态与特效逐项添加资产引用" });
        } else {
            const unknown = shot.assetRefs.map((ref) => ref.key).filter((key) => !assetKeys.has(key));
            if (unknown.length) findings.push({ severity: "blocker", location, evidence: `未定义资产 ${[...new Set(unknown)].join("、")}`, impact: "镜头引用无法解析成生产资产", suggestion: "先在资产圣经定义这些 key，或修正引用" });
            const vague = shot.assetRefs.filter((ref) => !ref.purpose.trim());
            if (vague.length) findings.push({ severity: "major", location, evidence: `用途未写 ${vague.map((ref) => ref.key).join("、")}`, impact: "无法判断本镜应选资产的哪种状态或视图", suggestion: "为每项引用补充本镜用途与所需变体" });
        }
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
        const characterAssets = (project.plannedAssets || []).filter((asset) => asset.category === "角色" && asset.name.includes(character.name));
        const hasFaceIdentityControl = characterAssets.some((asset) => /面部身份控制|正面(?:中性)?(?:头部|面部)?特写|正脸身份特写/.test([asset.name, asset.specification, asset.lock, ...asset.deliverables].join(" ")));
        if (usedInShots && !hasFaceIdentityControl) {
            findings.push({ severity: "blocker", location: `角色 ${character.name || "未命名"}`, evidence: "只有全身四视图，缺少面部身份控制包", impact: "表情、剧情图和分镜会重新塑造五官与骨相，无法保持长篇人物一致性", suggestion: "补齐并确认正面中性头部特写、所需头部角度、面部结构控制参考和半身衔接母版" });
        }
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
                script: project.script,
                characters: project.characters.map((character) => ({ name: character.name, description: character.description })),
                assets: project.plannedAssets || [],
                coverage: project.sourceCoverage || [],
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
                    sourceEvidence: shot.sourceEvidence || "",
                    location: shot.location || "",
                    storyTime: shot.storyTime || "",
                    shotPurpose: shot.shotPurpose || "",
                    startState: shot.startState || "",
                    endState: shot.endState || "",
                    continuity: shot.continuity || "",
                    qualityCriteria: shot.qualityCriteria || "",
                    assetRefs: shot.assetRefs || [],
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
    sourceEvidence?: unknown;
    location?: unknown;
    storyTime?: unknown;
    shotPurpose?: unknown;
    startState?: unknown;
    endState?: unknown;
    continuity?: unknown;
    qualityCriteria?: unknown;
    assetRefs?: unknown;
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
const REFERENCE_ROLE_VALUES = ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"] as const;
const REFERENCE_PRIORITY_VALUES = ["主参考", "辅助参考"] as const;

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
            sourceEvidence: typeof item.sourceEvidence === "string" ? item.sourceEvidence.trim() || undefined : shot.sourceEvidence,
            location: typeof item.location === "string" ? item.location.trim() || undefined : shot.location,
            storyTime: typeof item.storyTime === "string" ? item.storyTime.trim() || undefined : shot.storyTime,
            shotPurpose: typeof item.shotPurpose === "string" ? item.shotPurpose.trim() || undefined : shot.shotPurpose,
            startState: typeof item.startState === "string" ? item.startState.trim() || undefined : shot.startState,
            endState: typeof item.endState === "string" ? item.endState.trim() || undefined : shot.endState,
            continuity: typeof item.continuity === "string" ? item.continuity.trim() || undefined : shot.continuity,
            qualityCriteria: typeof item.qualityCriteria === "string" ? item.qualityCriteria.trim() || undefined : shot.qualityCriteria,
            assetRefs: Array.isArray(item.assetRefs)
                ? item.assetRefs
                    .filter((ref): ref is Record<string, unknown> => Boolean(ref) && typeof ref === "object")
                    .map((ref) => {
                        // referenceRole / referencePriority 是受限枚举：LLM 返回的非法值直接丢弃，避免整次自动修改被类型/数据问题阻断
                        const role = typeof ref.referenceRole === "string" && (REFERENCE_ROLE_VALUES as readonly string[]).includes(ref.referenceRole.trim()) ? (ref.referenceRole.trim() as (typeof REFERENCE_ROLE_VALUES)[number]) : undefined;
                        const priority = typeof ref.referencePriority === "string" && (REFERENCE_PRIORITY_VALUES as readonly string[]).includes(ref.referencePriority.trim()) ? (ref.referencePriority.trim() as (typeof REFERENCE_PRIORITY_VALUES)[number]) : undefined;
                        return {
                            key: String(ref.key || "").trim(),
                            purpose: String(ref.purpose || "").trim(),
                            ...(ref.variant ? { variant: String(ref.variant).trim() } : {}),
                            ...(Array.isArray(ref.files) ? { files: ref.files.map(String).map((value) => value.trim()).filter(Boolean) } : {}),
                            ...(role ? { referenceRole: role } : {}),
                            ...(priority ? { referencePriority: priority } : {}),
                        };
                    })
                    .filter((ref) => ref.key && ref.purpose)
                : shot.assetRefs,
        };
    });
    useDramaStore.getState().updateProject(projectId, { shots, keyframeApprovals: [] });
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
    sourceEvidence?: string;
    location?: string;
    storyTime?: string;
    shotPurpose?: string;
    startState?: string;
    endState?: string;
    continuity?: string;
    qualityCriteria?: string;
    assetRefs?: Array<{ key?: string; purpose?: string; variant?: string; files?: string[]; referenceRole?: string; referencePriority?: string }>;
};
export type StructuredCharacter = { name?: string; description?: string };
export type StructuredCoverage = { quote?: string; disposition?: string; shotNumbers?: number[]; note?: string };
export type StructuredAsset = {
    key?: string;
    category?: string;
    name?: string;
    layer?: string;
    factLevel?: string;
    sourceEvidence?: string;
    specification?: string;
    lock?: string;
    deliverables?: string[];
    dependencies?: string[];
    priority?: string;
    referenceRole?: string;
    generationPrompt?: string;
    avoidPrompt?: string;
    reviewCriteria?: string[];
};
export type StructuredScript = { title?: string; coverage?: StructuredCoverage[]; characters?: StructuredCharacter[]; assets?: StructuredAsset[]; shots?: StructuredShot[] };

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
            sourceEvidence: typeof shot?.sourceEvidence === "string" ? shot.sourceEvidence.trim() : "",
            location: typeof shot?.location === "string" ? shot.location.trim() : "",
            storyTime: typeof shot?.storyTime === "string" ? shot.storyTime.trim() : "",
            shotPurpose: typeof shot?.shotPurpose === "string" ? shot.shotPurpose.trim() : "",
            startState: typeof shot?.startState === "string" ? shot.startState.trim() : "",
            endState: typeof shot?.endState === "string" ? shot.endState.trim() : "",
            continuity: typeof shot?.continuity === "string" ? shot.continuity.trim() : "",
            qualityCriteria: typeof shot?.qualityCriteria === "string" ? shot.qualityCriteria.trim() : "",
            assetRefs: Array.isArray(shot?.assetRefs)
                ? shot.assetRefs
                    .map((ref) => ({ key: typeof ref?.key === "string" ? ref.key.trim() : "", purpose: typeof ref?.purpose === "string" ? ref.purpose.trim() : "", variant: typeof ref?.variant === "string" ? ref.variant.trim() : "", files: Array.isArray(ref?.files) ? ref.files.map(String).map((value) => value.trim()).filter(Boolean) : [], referenceRole: typeof ref?.referenceRole === "string" ? ref.referenceRole.trim() : "", referencePriority: typeof ref?.referencePriority === "string" ? ref.referencePriority.trim() : "" }))
                    .filter((ref) => ref.key && ref.purpose)
                : [],
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
