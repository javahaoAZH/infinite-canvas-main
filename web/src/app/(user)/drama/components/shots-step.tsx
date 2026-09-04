"use client";

import { Link2, Plus, ScanSearch, Trash2, WandSparkles, X } from "lucide-react";
import { useState } from "react";
import { App, Button, Empty, Input, InputNumber, Select, Tag } from "antd";

import { CAMERA_MOVE_OPTIONS, SHOTS_AUTOFIX_SYSTEM_PROMPT, SHOT_SIZE_OPTIONS, TRANSITION_OPTIONS } from "@/app/(user)/drama/prompts";
import {
    applyAutofixShots,
    callTextModel,
    parseAutofixShots,
    reviewShots,
    type ReviewResult,
    type ReviewSeverity,
    type ReviewVerdict,
} from "@/app/(user)/drama/services/drama-review";
import { newDramaShot, useDramaStore, type DramaAssetRef, type DramaProject } from "@/stores/use-drama-store";

const REFERENCE_ROLES: NonNullable<DramaAssetRef["referenceRole"]>[] = ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"];
const REFERENCE_PRIORITIES: NonNullable<DramaAssetRef["referencePriority"]>[] = ["主参考", "辅助参考"];
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
        updateProject(project.id, {
            shots: project.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
            keyframeApprovals: (project.keyframeApprovals || []).filter((shotId) => shotId !== id),
        });
    };

    const patchAssetRef = (shotId: string, index: number, patch: Partial<DramaAssetRef>) => {
        const shot = project.shots.find((item) => item.id === shotId);
        if (!shot) return;
        patchShot(shotId, { assetRefs: (shot.assetRefs || []).map((ref, refIndex) => refIndex === index ? { ...ref, ...patch } : ref) });
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
                script: project.script,
                coverage: project.sourceCoverage || [],
                assets: project.plannedAssets || [],
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
                    共 {project.shots.length} 个分镜，预计 {totalSeconds} 秒。每镜必须能追溯原文，并明确起止状态、资产文件和可视化验收标准。
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<ScanSearch className="size-4" />} loading={reviewing} onClick={() => void runReview()}>
                        AI 审查
                    </Button>
                    <Button
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            updateProject(project.id, { shots: [...project.shots, newDramaShot()], keyframeApprovals: [] });
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
                                    onClick={() => updateProject(project.id, { shots: project.shots.filter((item) => item.id !== shot.id), keyframeApprovals: [] })}
                                >
                                    删除
                                </Button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <Input.TextArea
                                    rows={3}
                                    value={shot.description}
                                    placeholder="画面描述：镜头起点的场景、人物与构图，只写静态可见事实"
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
                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                                <Select allowClear value={shot.shotSize || undefined} placeholder="景别" options={SHOT_SIZE_OPTIONS.map((value) => ({ value, label: value }))} onChange={(shotSize) => patchShot(shot.id, { shotSize })} />
                                <Select allowClear value={shot.camera || undefined} placeholder="运镜" options={CAMERA_MOVE_OPTIONS.map((value) => ({ value, label: value }))} onChange={(camera) => patchShot(shot.id, { camera })} />
                                <Select allowClear value={shot.transition || undefined} placeholder="转场" options={TRANSITION_OPTIONS.map((value) => ({ value, label: value }))} onChange={(transition) => patchShot(shot.id, { transition })} />
                                <Select mode="multiple" className="md:col-span-3" value={shot.characters || []} placeholder="出场角色；空镜保持为空" options={project.characters.map((character) => ({ value: character.name, label: character.name }))} onChange={(characters) => patchShot(shot.id, { characters })} />
                                <Input className="md:col-span-2" value={shot.action || ""} placeholder="唯一主导动作" onChange={(event) => patchShot(shot.id, { action: event.target.value })} />
                                <Input value={shot.emotion || ""} placeholder="可外化的情绪状态" onChange={(event) => patchShot(shot.id, { emotion: event.target.value })} />
                            </div>
                            <details className="group mt-3 border-t border-border pt-3">
                                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground marker:hidden">
                                    <Link2 className="size-4 text-sky-500" />
                                    制作约束
                                    <span className="font-normal text-muted-foreground">证据、时空、起止状态、验收标准与精确资产引用</span>
                                    <Tag className="ml-auto mr-0" color={shot.sourceEvidence && shot.location && shot.storyTime && shot.shotPurpose && shot.startState && shot.endState && shot.continuity && shot.qualityCriteria && Array.isArray(shot.characters) && shot.assetRefs?.length ? "green" : "orange"}>
                                        {shot.sourceEvidence && shot.location && shot.storyTime && shot.shotPurpose && shot.startState && shot.endState && shot.continuity && shot.qualityCriteria && Array.isArray(shot.characters) && shot.assetRefs?.length ? "完整" : "待补齐"}
                                    </Tag>
                                </summary>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <label className="space-y-1.5 text-xs text-muted-foreground md:col-span-2">
                                        <span>原文证据</span>
                                        <Input.TextArea rows={2} value={shot.sourceEvidence || ""} placeholder="可在原文中逐字定位的短引文" onChange={(event) => patchShot(shot.id, { sourceEvidence: event.target.value })} />
                                    </label>
                                    <label className="space-y-1.5 text-xs text-muted-foreground"><span>地点</span><Input value={shot.location || ""} placeholder="河底 / 出租屋 / 梦境仙宗" onChange={(event) => patchShot(shot.id, { location: event.target.value })} /></label>
                                    <label className="space-y-1.5 text-xs text-muted-foreground"><span>故事时间</span><Input value={shot.storyTime || ""} placeholder="深夜 / 次日清晨 / 梦境中" onChange={(event) => patchShot(shot.id, { storyTime: event.target.value })} /></label>
                                    <label className="space-y-1.5 text-xs text-muted-foreground md:col-span-2"><span>本镜唯一职责</span><Input value={shot.shotPurpose || ""} placeholder="只写这一镜必须完成的一件事" onChange={(event) => patchShot(shot.id, { shotPurpose: event.target.value })} /></label>
                                    <label className="space-y-1.5 text-xs text-muted-foreground"><span>起始状态</span><Input.TextArea rows={2} value={shot.startState || ""} placeholder="人物、道具、空间、光线在镜头开始时的状态" onChange={(event) => patchShot(shot.id, { startState: event.target.value })} /></label>
                                    <label className="space-y-1.5 text-xs text-muted-foreground"><span>结束状态</span><Input.TextArea rows={2} value={shot.endState || ""} placeholder="镜头结束后留下的状态，供下一镜继承" onChange={(event) => patchShot(shot.id, { endState: event.target.value })} /></label>
                                    <label className="space-y-1.5 text-xs text-muted-foreground md:col-span-2"><span>连续性说明</span><Input value={shot.continuity || ""} placeholder="承接上一镜什么，下一镜必须保持什么" onChange={(event) => patchShot(shot.id, { continuity: event.target.value })} /></label>
                                    <label className="space-y-1.5 text-xs text-muted-foreground md:col-span-2">
                                        <span>本镜质检标准</span>
                                        <Input.TextArea rows={3} value={shot.qualityCriteria || ""} placeholder="看图即可判断：人物身份与服装版本、道具结构与持握、五指/虎口/手腕、空间方向、特效边界、与前后镜连续性" onChange={(event) => patchShot(shot.id, { qualityCriteria: event.target.value })} />
                                    </label>
                                </div>
                                <div className="mt-4 border border-border bg-background/55 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="text-xs font-medium text-foreground">逐镜资产清单</div>
                                        <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={() => patchShot(shot.id, { assetRefs: [...(shot.assetRefs || []), { key: "", purpose: "" }] })}>绑定资产</Button>
                                    </div>
                                    <div className="space-y-2">
                                        {(shot.assetRefs || []).map((ref, refIndex) => (
                                            <div key={`${ref.key}-${refIndex}`} className="grid gap-2 md:grid-cols-[minmax(170px,1fr)_120px_105px_minmax(170px,1fr)_130px_minmax(170px,1fr)_32px]">
                                                <Select showSearch value={ref.key || undefined} placeholder="资产 key" options={(project.plannedAssets || []).map((asset) => ({ value: asset.key, label: `${asset.name} · ${asset.key}` }))} onChange={(key) => patchAssetRef(shot.id, refIndex, { key })} />
                                                <Select value={ref.referenceRole} placeholder="参考职责" options={REFERENCE_ROLES.map((value) => ({ value, label: value }))} onChange={(referenceRole) => patchAssetRef(shot.id, refIndex, { referenceRole })} />
                                                <Select value={ref.referencePriority} placeholder="主次" options={REFERENCE_PRIORITIES.map((value) => ({ value, label: value }))} onChange={(referencePriority) => patchAssetRef(shot.id, refIndex, { referencePriority })} />
                                                <Input value={ref.purpose} placeholder="在本镜中的用途" onChange={(event) => patchAssetRef(shot.id, refIndex, { purpose: event.target.value })} />
                                                <Input value={ref.variant || ""} placeholder="状态/姿态变体" onChange={(event) => patchAssetRef(shot.id, refIndex, { variant: event.target.value })} />
                                                <Input value={(ref.files || []).join("、")} placeholder="精确文件名，用、分隔" onChange={(event) => patchAssetRef(shot.id, refIndex, { files: event.target.value.split(/[、,，\n]+/).map((value) => value.trim()).filter(Boolean) })} />
                                                <Button type="text" danger icon={<X className="size-3.5" />} aria-label="移除资产引用" onClick={() => patchShot(shot.id, { assetRefs: (shot.assetRefs || []).filter((_, index) => index !== refIndex) })} />
                                            </div>
                                        ))}
                                        {!shot.assetRefs?.length ? <div className="py-2 text-center text-xs text-muted-foreground">本镜未绑定任何资产，不能进入生图。</div> : null}
                                    </div>
                                </div>
                            </details>
                            <details className="group mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
                                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-stone-600 marker:hidden dark:text-stone-300">
                                    <WandSparkles className="size-4 text-amber-500" />
                                    生成提示词
                                    <span className="font-normal text-stone-400 dark:text-stone-500">生图前确认静态首帧，视频动作单独编写</span>
                                    <span className="ml-auto text-xs text-stone-400 transition-transform group-open:rotate-180">⌄</span>
                                </summary>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <label className="space-y-1.5 text-xs text-stone-500 dark:text-stone-400">
                                        <span>分镜图首帧</span>
                                        <Input.TextArea
                                            rows={5}
                                            value={shot.imagePrompt || ""}
                                            placeholder="主体身份、场景锚点、静止姿态、景别机位、构图、光线色彩"
                                            onChange={(event) => patchShot(shot.id, { imagePrompt: event.target.value })}
                                        />
                                    </label>
                                    <label className="space-y-1.5 text-xs text-stone-500 dark:text-stone-400">
                                        <span>图生视频动作</span>
                                        <Input.TextArea
                                            rows={5}
                                            value={shot.videoPrompt || ""}
                                            placeholder="只写主体运动、环境运动、运镜与节奏，不重复首帧内容"
                                            onChange={(event) => patchShot(shot.id, { videoPrompt: event.target.value })}
                                        />
                                    </label>
                                </div>
                            </details>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
