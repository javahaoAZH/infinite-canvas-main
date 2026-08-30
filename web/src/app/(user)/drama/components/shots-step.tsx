"use client";

import { Plus, ScanSearch, Trash2 } from "lucide-react";
import { useState } from "react";
import { App, Button, Empty, Input, InputNumber, Tag } from "antd";

import { SHOTS_REVIEW_SYSTEM_PROMPT } from "@/app/(user)/drama/prompts";
import { aiApiUrl, aiHeaders, refreshRemoteUser } from "@/services/api/image";
import { dramaTextConfig, newDramaShot, useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";

type ReviewSeverity = "blocker" | "major" | "minor" | "note";
type ReviewFinding = { severity: ReviewSeverity; location: string; evidence: string; impact: string; suggestion: string };
type ReviewVerdict = "pass" | "revise" | "rework";
type ReviewResult = { verdict: ReviewVerdict; findings: ReviewFinding[] };

const SEVERITY_META: Record<ReviewSeverity, { label: string; color: string }> = {
    blocker: { label: "阻断", color: "red" },
    major: { label: "重要", color: "volcano" },
    minor: { label: "轻微", color: "gold" },
    note: { label: "提示", color: "blue" },
};
const VERDICT_META: Record<ReviewVerdict, { label: string; color: string }> = {
    pass: { label: "通过", color: "green" },
    revise: { label: "建议修改", color: "orange" },
    rework: { label: "需修改", color: "red" },
};

// 机械检查：纯前端代码，不调 LLM
function runMechanicalChecks(project: DramaProject): ReviewFinding[] {
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
        const previous = project.shots[index - 1];
        if (previous && shot.description.trim() && shot.description.trim() === previous.description.trim()) {
            findings.push({ severity: "major", location, evidence: "画面描述与上一镜完全相同", impact: "相邻两镜呈现同一画面，浪费镜头", suggestion: "合并两镜，或改变景别、动作与信息" });
        }
    });
    project.characters.forEach((character) => {
        if (!character.description.trim()) {
            findings.push({ severity: "major", location: `角色 ${character.name || "未命名"}`, evidence: "角色描述为空", impact: "无法生成立绘与分镜参考图", suggestion: "补充发型、服饰、标志物等可见的身份锚点" });
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

const SEMANTIC_PARSE_ERROR = "AI 没有返回有效的审查结果";

// 语义检查：单次文本生成调用，解析 LLM 返回的结构化 findings
function parseSemanticReview(content: string): { verdict: ReviewVerdict; findings: ReviewFinding[] } {
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

export function ShotsStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateProject = useDramaStore((state) => state.updateProject);
    const [reviewing, setReviewing] = useState(false);
    // 审查结果只展示，不做持久化
    const [review, setReview] = useState<ReviewResult | null>(null);
    const [reviewError, setReviewError] = useState("");
    const totalSeconds = project.shots.reduce((sum, shot) => sum + (shot.seconds || 0), 0);

    const patchShot = (id: string, patch: Partial<Omit<ReturnType<typeof newDramaShot>, "id">>) => {
        updateProject(project.id, { shots: project.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)) });
    };

    const runReview = async () => {
        setReviewing(true);
        setReviewError("");
        try {
            const mechanical = runMechanicalChecks(project);
            let semantic: { verdict: ReviewVerdict; findings: ReviewFinding[] } = { verdict: "pass", findings: [] };
            let semanticError = "";
            // 语义阶段单独包裹：任何失败都不丢弃已算出的机械检查结果
            if (project.shots.length) {
                try {
                    const textConfig = dramaTextConfig(effectiveConfig);
                    if (!isAiConfigReady(textConfig, textConfig.model)) {
                        throw new Error("未配置可用的文本模型渠道");
                    }
                    const input = JSON.stringify({
                        title: project.title,
                        characters: project.characters.map((character) => ({ name: character.name, description: character.description })),
                        shots: project.shots.map((shot, index) => ({ shot: index + 1, description: shot.description, dialogue: shot.dialogue, narration: shot.narration || "", seconds: shot.seconds })),
                    });
                    const response = await fetch(aiApiUrl(textConfig, "/chat/completions"), {
                        method: "POST",
                        headers: aiHeaders(textConfig, "application/json"),
                        body: JSON.stringify({
                            model: textConfig.model,
                            messages: [
                                { role: "system", content: SHOTS_REVIEW_SYSTEM_PROMPT },
                                { role: "user", content: input },
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
                    semantic = parseSemanticReview(payload.choices?.[0]?.message?.content || payload.data?.choices?.[0]?.message?.content || "");
                } catch (error) {
                    // 解析失败用固定友好文案，网络/接口失败统一提示，不暴露原始错误
                    semanticError = error instanceof Error && error.message === SEMANTIC_PARSE_ERROR ? SEMANTIC_PARSE_ERROR : "语义审查失败，以下仅为机械检查结果";
                }
            }
            const findings = [...mechanical, ...semantic.findings];
            const hasBlocker = findings.some((finding) => finding.severity === "blocker");
            const hasMajor = findings.some((finding) => finding.severity === "major");
            const verdict: ReviewVerdict = hasBlocker || hasMajor || semantic.verdict === "rework" ? "rework" : findings.some((finding) => finding.severity === "minor") || semantic.verdict === "revise" ? "revise" : "pass";
            setReview({ verdict, findings });
            if (semanticError) setReviewError(semanticError);
        } finally {
            setReviewing(false);
        }
    };

    // 有阻断/重要问题的镜号在列表中红框标出（兼容“第 3 镜/镜头 3/分镜 3/Shot 3”等写法，角色类定位不提镜号）
    const flaggedIndexes = new Set<number>();
    review?.findings.forEach((finding) => {
        if (finding.severity !== "blocker" && finding.severity !== "major") return;
        if (finding.location.startsWith("角色")) return;
        const match = finding.location.match(/(?:第|镜头?|[Ss]hot)\s*(\d+)/);
        if (match) flaggedIndexes.add(Number(match[1]) - 1);
    });

    return (
        <div className="mx-auto w-full max-w-4xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-stone-500 dark:text-stone-400">
                    共 {project.shots.length} 个分镜，预计总时长 {totalSeconds} 秒。每条分镜包含画面描述、对白、旁白与时长，后续步骤都会基于这里的内容生成。
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<ScanSearch className="size-4" />} loading={reviewing} onClick={() => void runReview()}>
                        AI 审查
                    </Button>
                    <Button
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            updateProject(project.id, { shots: [...project.shots, newDramaShot()] });
                            message.success("已添加分镜");
                        }}
                    >
                        添加分镜
                    </Button>
                </div>
            </div>

            {reviewError ? <p className="text-sm text-red-500">{reviewError}</p> : null}
            {review ? (
                <div className="space-y-2 border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">审查结论</span>
                        <Tag color={VERDICT_META[review.verdict].color} className="m-0">{VERDICT_META[review.verdict].label}</Tag>
                        <span className="text-xs text-stone-400 dark:text-stone-500">共 {review.findings.length} 条发现（机械检查 + 语义审查，只展示不改稿）</span>
                    </div>
                    {review.findings.length === 0 ? (
                        <p className="text-sm text-stone-500 dark:text-stone-400">没有发现问题。</p>
                    ) : (
                        <ul className="space-y-2">
                            {review.findings.map((finding, index) => (
                                <li key={index} className="flex flex-wrap items-start gap-2 text-sm">
                                    <Tag color={SEVERITY_META[finding.severity].color} className="m-0">{SEVERITY_META[finding.severity].label}</Tag>
                                    <span className="font-medium text-stone-700 dark:text-stone-200">{finding.location}</span>
                                    <span className="min-w-60 flex-1 leading-6 text-stone-600 dark:text-stone-300">
                                        {finding.evidence ? <span className="text-stone-500 dark:text-stone-400">证据：「{finding.evidence}」；</span> : null}
                                        {finding.impact ? `${finding.impact}。` : ""}
                                        {finding.suggestion ? `建议：${finding.suggestion}` : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}

            {project.shots.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分镜，可回到上一步用 AI 结构化剧本，或点击右上角添加" className="py-16" />
            ) : (
                <div className="space-y-3">
                    {project.shots.map((shot, index) => (
                        <div key={shot.id} className={`border bg-white/70 p-4 dark:bg-stone-900/50 ${flaggedIndexes.has(index) ? "border-red-400 dark:border-red-500" : "border-stone-200 dark:border-stone-800"}`}>
                            <div className="mb-3 flex items-center gap-3">
                                <span className="flex size-7 items-center justify-center bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">
                                    {index + 1}
                                </span>
                                <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                                    时长
                                    <InputNumber
                                        size="small"
                                        min={1}
                                        max={30}
                                        value={shot.seconds}
                                        onChange={(value) => patchShot(shot.id, { seconds: Math.max(1, Math.min(30, Math.round(Number(value) || 5))) })}
                                    />
                                    秒
                                </div>
                                <Button
                                    type="text"
                                    danger
                                    size="small"
                                    className="ml-auto"
                                    icon={<Trash2 className="size-4" />}
                                    onClick={() => updateProject(project.id, { shots: project.shots.filter((item) => item.id !== shot.id) })}
                                >
                                    删除
                                </Button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <Input.TextArea
                                    rows={3}
                                    value={shot.description}
                                    placeholder="画面描述：场景、人物动作、构图，用于生成分镜图与视频"
                                    onChange={(event) => patchShot(shot.id, { description: event.target.value })}
                                />
                                <Input.TextArea
                                    rows={3}
                                    value={shot.dialogue}
                                    placeholder="对白：该分镜角色的台词，用于配音（可为空）"
                                    onChange={(event) => patchShot(shot.id, { dialogue: event.target.value })}
                                />
                            </div>
                            <Input.TextArea
                                rows={2}
                                className="mt-3"
                                value={shot.narration || ""}
                                placeholder="旁白：画外音文本（可选，如内心独白、时间过渡），与对白一同参与配音"
                                onChange={(event) => patchShot(shot.id, { narration: event.target.value })}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
