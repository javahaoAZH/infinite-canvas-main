"use client";

import { Plus, ScanSearch, Trash2, WandSparkles } from "lucide-react";
import { useState } from "react";
import { App, Button, Empty, Input, InputNumber, Tag } from "antd";

import { SHOTS_AUTOFIX_SYSTEM_PROMPT } from "@/app/(user)/drama/prompts";
import {
    applyAutofixShots,
    callTextModel,
    parseAutofixShots,
    reviewShots,
    type ReviewResult,
    type ReviewSeverity,
    type ReviewVerdict,
} from "@/app/(user)/drama/services/drama-review";
import { newDramaShot, useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig } from "@/stores/use-config-store";

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

export function ShotsStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const updateProject = useDramaStore((state) => state.updateProject);
    const [reviewing, setReviewing] = useState(false);
    const [fixing, setFixing] = useState(false);
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
            const result = await reviewShots(project, effectiveConfig);
            setReview({ verdict: result.verdict, findings: result.findings });
            if (result.semanticError) setReviewError(result.semanticError);
        } finally {
            setReviewing(false);
        }
    };

    // 一键按审查建议自动修改：返回分镜按索引合并回现有分镜（保留原 id），成功后清空审查结果引导重新审查
    const runAutofix = async () => {
        if (!review || !project.shots.length) return;
        setFixing(true);
        try {
            const input = JSON.stringify({
                shots: project.shots.map((shot, index) => ({ shot: index + 1, description: shot.description, dialogue: shot.dialogue, narration: shot.narration || "", seconds: shot.seconds })),
                findings: review.findings.map((finding) => ({ severity: finding.severity, location: finding.location, evidence: finding.evidence, impact: finding.impact, suggestion: finding.suggestion })),
            });
            const content = await callTextModel(SHOTS_AUTOFIX_SYSTEM_PROMPT, input, effectiveConfig);
            let returned: Array<Record<string, unknown>>;
            try {
                returned = parseAutofixShots(content);
            } catch {
                return message.error("AI 没有返回有效的修改结果，分镜未改动");
            }
            // 合并前在服务层重新读取最新分镜做等长校验，description 空值回退原值（不被清空）
            const count = applyAutofixShots(project.id, returned);
            message.success(`已按建议修改 ${count} 个分镜`);
            setReview(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "自动修改失败，可重试");
        } finally {
            setFixing(false);
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
                        <span className="text-xs text-stone-400 dark:text-stone-500">共 {review.findings.length} 条发现（机械检查 + 语义审查，可一键按建议修改）</span>
                        {review.findings.some((finding) => finding.suggestion) ? (
                            <Button size="small" className="ml-auto" icon={<WandSparkles className="size-4" />} loading={fixing} onClick={() => void runAutofix()}>
                                按建议自动修改
                            </Button>
                        ) : null}
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
