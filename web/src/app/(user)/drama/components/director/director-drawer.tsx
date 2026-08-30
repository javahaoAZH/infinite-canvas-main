"use client";

import { CheckCircle2, Circle, Clapperboard, FileText, Image as ImageIcon, LoaderCircle, Mic, Pause, Play, RotateCcw, SkipForward, Square, User, XCircle } from "lucide-react";
import { useEffect } from "react";
import { App, Button, Drawer, Progress, Select, Switch, Tag } from "antd";

import { DEFAULT_DIRECTOR_OPTIONS } from "@/app/(user)/drama/services/director-planner";
import { maybeRestartDirector, startDirector } from "@/app/(user)/drama/services/director-runner";
import { useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useDirectorStore, type DirectorPlan, type DirectorTask, type DirectorTaskKind } from "@/stores/use-director-store";

const KIND_META: Record<DirectorTaskKind, { label: string; step: number; icon: typeof FileText }> = {
    script: { label: "剧本结构化", step: 0, icon: FileText },
    review: { label: "文本审查", step: 1, icon: FileText },
    character: { label: "立绘", step: 2, icon: User },
    shotImage: { label: "分镜图", step: 3, icon: ImageIcon },
    shotVideo: { label: "视频", step: 4, icon: Clapperboard },
    audio: { label: "配音", step: 5, icon: Mic },
    render: { label: "成片", step: 5, icon: Clapperboard },
};

const KIND_ORDER: DirectorTaskKind[] = ["script", "character", "shotImage", "shotVideo", "audio"];

export function DirectorDrawer({ project, open, onClose }: { project: DramaProject; open: boolean; onClose: () => void }) {
    const { message, modal } = App.useApp();
    const hydrated = useDirectorStore((state) => state.hydrated);
    const plan = useDirectorStore((state) => state.plans[project.id]);
    const runningProjectId = useDirectorStore((state) => state.runningProjectId);
    const progress = useDirectorStore((state) => state.progress);
    const buildPlan = useDirectorStore((state) => state.buildPlan);
    const confirmPlan = useDirectorStore((state) => state.confirmPlan);
    const pauseRun = useDirectorStore((state) => state.pauseRun);
    const resumeRun = useDirectorStore((state) => state.resumeRun);
    const abortRun = useDirectorStore((state) => state.abortRun);
    const skipTask = useDirectorStore((state) => state.skipTask);
    const retryTask = useDirectorStore((state) => state.retryTask);
    const updateProject = useDramaStore((state) => state.updateProject);

    // 打开且无计划时自动基于当前项目状态生成草稿计划（刷新恢复后已有计划则直接展示）
    useEffect(() => {
        if (open && hydrated && !useDirectorStore.getState().plans[project.id]) buildPlan(project.id, DEFAULT_DIRECTOR_OPTIONS);
    }, [open, hydrated, project.id, buildPlan]);

    const confirm = () => {
        if (runningProjectId && runningProjectId !== project.id) return message.warning("有其他项目正在自动生产，请先终止后再开始");
        confirmPlan(project.id);
        startDirector(project.id);
    };

    const abort = () =>
        modal.confirm({
            title: "终止自动生产",
            content: "终止后不再派发新任务，在途请求会自然结束；失败或未完成的任务可随时在新计划中补齐。",
            okText: "终止",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => abortRun(project.id),
        });

    const gotoStep = (step: number) => {
        updateProject(project.id, { step });
        onClose();
    };

    return (
        <Drawer title="自动生产 · 专家团流水线" size={560} open={open} onClose={onClose} destroyOnHidden>
            {!hydrated || !plan ? (
                <div className="flex items-center gap-2 py-10 text-sm text-stone-500 dark:text-stone-400">
                    <LoaderCircle className="size-4 animate-spin" /> 正在加载生产计划…
                </div>
            ) : plan.status === "running" || plan.status === "paused" ? (
                <RunningView plan={plan} progress={progress} onPause={() => pauseRun(project.id)} onResume={() => { resumeRun(project.id); startDirector(project.id); }} onAbort={abort} onSkip={(taskId) => { skipTask(project.id, taskId); maybeRestartDirector(project.id); }} onRetry={(taskId) => { retryTask(project.id, taskId); maybeRestartDirector(project.id); }} />
            ) : plan.status === "done" || plan.status === "aborted" ? (
                <DoneView plan={plan} aborted={plan.status === "aborted"} onReplan={() => buildPlan(project.id, plan.options)} onRetry={(taskId) => { retryTask(project.id, taskId); maybeRestartDirector(project.id); }} onGotoStep={gotoStep} />
            ) : (
                <DraftView plan={plan} busyProjectId={runningProjectId} onOptionsChange={(patch) => buildPlan(project.id, { ...plan.options, ...patch })} onConfirm={confirm} />
            )}
        </Drawer>
    );
}

// 计划预览态：选项开关 + 成本预估卡 + 任务分组清单，单次确认后开始
function DraftView({ plan, busyProjectId, onOptionsChange, onConfirm }: { plan: DirectorPlan; busyProjectId: string | null; onOptionsChange: (patch: Partial<DirectorPlan["options"]>) => void; onConfirm: () => void }) {
    const pendingCount = plan.tasks.filter((task) => task.status === "pending").length;
    const doneCount = plan.tasks.filter((task) => task.status === "success").length;
    const hasScriptTask = plan.tasks.some((task) => task.kind === "script" && task.status === "pending");
    return (
        <div className="space-y-5 text-stone-800 dark:text-stone-100">
            <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">
                按「立绘 → 分镜图 → 视频 ∥ 配音」的依赖流水线自动执行各步骤；产物写入现有步骤页面，可随时暂停、终止或单独重试。
            </p>

            <div className="space-y-3 border border-stone-200 bg-stone-50/60 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="text-sm font-medium text-stone-700 dark:text-stone-200">生产选项</div>
                <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-stone-600 dark:text-stone-300">立绘候选数（越多成本越高）</span>
                    <Select
                        size="small"
                        className="w-32"
                        value={plan.options.characterCandidates}
                        options={[
                            { value: 1, label: "1 张（省成本）" },
                            { value: 4, label: "4 张（手动模式）" },
                        ]}
                        onChange={(value) => onOptionsChange({ characterCandidates: value })}
                    />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-stone-600 dark:text-stone-300">自动把首选立绘分配到正面视图（解锁分镜参考）</span>
                    <Switch size="small" checked={plan.options.autoAssignView} onChange={(checked) => onOptionsChange({ autoAssignView: checked })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-stone-600 dark:text-stone-300">生成对白与旁白配音</span>
                    <Switch size="small" checked={plan.options.includeAudio} onChange={(checked) => onOptionsChange({ includeAudio: checked })} />
                </label>
            </div>

            <div className="border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="text-sm font-medium text-stone-700 dark:text-stone-200">成本预估（仅待执行任务）</div>
                <div className="mt-2 flex flex-wrap gap-2">
                    <Tag className="m-0">文本 {plan.estimate.text} 次</Tag>
                    <Tag className="m-0">图像 {plan.estimate.image} 次</Tag>
                    <Tag className="m-0">视频 {plan.estimate.video} 次</Tag>
                    <Tag className="m-0">配音 {plan.estimate.audio} 次</Tag>
                </div>
                <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">已有产物会自动跳过（本次 {doneCount} 项已就绪），重跑只补缺口；成片不会自动合成，完成后可到「配音成片」步骤手动一键成片。</p>
            </div>

            <div className="space-y-2">
                {KIND_ORDER.filter((kind) => plan.tasks.some((task) => task.kind === kind)).map((kind) => {
                    const tasks = plan.tasks.filter((task) => task.kind === kind);
                    const pending = tasks.filter((task) => task.status === "pending").length;
                    const Icon = KIND_META[kind].icon;
                    return (
                        <div key={kind} className="flex items-center gap-2 border border-stone-200 bg-white/70 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900/50">
                            <Icon className="size-4 text-stone-400" />
                            <span className="text-stone-700 dark:text-stone-200">{KIND_META[kind].label}</span>
                            <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">
                                {pending ? `待执行 ${pending} / 共 ${tasks.length}` : `已就绪 ${tasks.length} 项`}
                            </span>
                        </div>
                    );
                })}
            </div>

            {hasScriptTask ? <p className="text-xs text-amber-600 dark:text-amber-500">提示：本次包含剧本结构化，执行后将重置分镜与已生成媒体。</p> : null}
            {busyProjectId && busyProjectId !== plan.projectId ? <p className="text-xs text-red-500">有其他项目正在自动生产，请先终止后再开始。</p> : null}

            <Button type="primary" block size="large" disabled={!pendingCount} onClick={onConfirm}>
                {pendingCount ? `确认并开始（${pendingCount} 个任务）` : "全部产物已就绪，无需执行"}
            </Button>
        </div>
    );
}

// 运行态：总进度 + 分组小进度 + 任务列表（单任务重试/跳过），顶部暂停/继续/终止
function RunningView({ plan, progress, onPause, onResume, onAbort, onSkip, onRetry }: {
    plan: DirectorPlan;
    progress: Record<string, number>;
    onPause: () => void;
    onResume: () => void;
    onAbort: () => void;
    onSkip: (taskId: string) => void;
    onRetry: (taskId: string) => void;
}) {
    const running = plan.status === "running";
    const terminal = plan.tasks.filter((task) => task.status === "success" || task.status === "skipped" || task.status === "failed").length;
    const failed = plan.tasks.filter((task) => task.status === "failed").length;
    const percent = plan.tasks.length ? Math.round((terminal / plan.tasks.length) * 100) : 0;
    return (
        <div className="space-y-4 text-stone-800 dark:text-stone-100">
            <div className="flex items-center gap-3">
                <Progress percent={percent} className="flex-1" status={failed && !running ? "exception" : running ? "active" : "normal"} />
                <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">
                    {terminal}/{plan.tasks.length}
                </span>
            </div>
            <div className="flex items-center gap-2">
                {running ? (
                    <Button size="small" icon={<Pause className="size-4" />} onClick={onPause}>
                        暂停
                    </Button>
                ) : (
                    <Button size="small" type="primary" icon={<Play className="size-4" />} onClick={onResume}>
                        继续
                    </Button>
                )}
                <Button size="small" danger icon={<Square className="size-4" />} onClick={onAbort}>
                    终止
                </Button>
                <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">{running ? "正在自动生产，可关闭页面，进度持续保存" : "已暂停（页面刷新后自动暂停，点击继续可续跑）"}</span>
            </div>

            <div className="flex flex-wrap gap-2">
                {KIND_ORDER.filter((kind) => plan.tasks.some((task) => task.kind === kind)).map((kind) => {
                    const tasks = plan.tasks.filter((task) => task.kind === kind);
                    const done = tasks.filter((task) => task.status === "success" || task.status === "skipped" || task.status === "failed").length;
                    return (
                        <Tag key={kind} className="m-0">
                            {KIND_META[kind].label} {done}/{tasks.length}
                        </Tag>
                    );
                })}
            </div>

            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
                {plan.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} progress={progress[task.id]} onSkip={() => onSkip(task.id)} onRetry={() => onRetry(task.id)} />
                ))}
            </div>
        </div>
    );
}

// 完成/终止态：结果汇总 + 失败清单快捷处理 + 重新规划
function DoneView({ plan, aborted, onReplan, onRetry, onGotoStep }: { plan: DirectorPlan; aborted: boolean; onReplan: () => void; onRetry: (taskId: string) => void; onGotoStep: (step: number) => void }) {
    const success = plan.tasks.filter((task) => task.status === "success").length;
    const failedTasks = plan.tasks.filter((task) => task.status === "failed");
    const skipped = plan.tasks.filter((task) => task.status === "skipped").length;
    return (
        <div className="space-y-4 text-stone-800 dark:text-stone-100">
            <div className="flex items-center gap-2">
                {aborted ? <XCircle className="size-5 text-stone-400" /> : <CheckCircle2 className="size-5 text-green-600" />}
                <span className="text-base font-semibold">{aborted ? "自动生产已终止" : "自动生产已完成"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
                <Tag color="green" className="m-0">成功 {success}</Tag>
                <Tag color={failedTasks.length ? "red" : "default"} className="m-0">失败 {failedTasks.length}</Tag>
                <Tag className="m-0">跳过 {skipped}</Tag>
            </div>
            <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">
                成片不会自动合成：请到第 6 步「配音成片」检查配音与画面后，点击「一键成片」。
            </p>
            {failedTasks.length ? (
                <div className="space-y-1.5">
                    {failedTasks.map((task) => (
                        <div key={task.id} className="space-y-1 border border-red-300 bg-red-50/50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
                            <div className="flex items-center gap-2">
                                <span className="font-medium text-stone-700 dark:text-stone-200">{task.label}</span>
                                <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => onRetry(task.id)}>
                                    重试
                                </Button>
                                <Button size="small" type="link" className="ml-auto p-0" onClick={() => onGotoStep(KIND_META[task.kind].step)}>
                                    去对应步骤处理
                                </Button>
                            </div>
                            <p className="text-xs text-red-500">{task.error || "任务执行失败"}</p>
                        </div>
                    ))}
                </div>
            ) : null}
            <div className="flex gap-2">
                <Button type="primary" onClick={() => onGotoStep(5)}>
                    去第 6 步一键成片
                </Button>
                <Button onClick={onReplan}>重新规划</Button>
            </div>
        </div>
    );
}

function TaskRow({ task, progress, onSkip, onRetry }: { task: DirectorTask; progress?: number; onSkip: () => void; onRetry: () => void }) {
    return (
        <div className="flex items-start gap-2 border border-stone-200 bg-white/70 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900/50">
            <TaskStatusIcon status={task.status} className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-stone-700 dark:text-stone-200">{task.label}</span>
                    {task.status === "running" && task.kind === "shotVideo" ? <span className="text-xs text-stone-400">· {Math.min(99, Math.round(progress || 0))}%</span> : null}
                    {task.status === "pending" && task.error ? <span className="text-xs text-amber-600 dark:text-amber-500">重试中：{task.error}</span> : null}
                </div>
                {task.status === "failed" && task.error ? <p className="mt-0.5 text-xs text-red-500">{task.error}</p> : null}
                {task.status === "skipped" && task.error ? <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{task.error}</p> : null}
            </div>
            {task.status === "failed" ? (
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
                        重试
                    </Button>
                    <Button size="small" icon={<SkipForward className="size-3.5" />} onClick={onSkip}>
                        跳过
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

function TaskStatusIcon({ status, className }: { status: DirectorTask["status"]; className?: string }) {
    if (status === "running") return <LoaderCircle className={`animate-spin text-stone-400 ${className || ""}`} />;
    if (status === "success") return <CheckCircle2 className={`text-green-600 ${className || ""}`} />;
    if (status === "failed") return <XCircle className={`text-red-500 ${className || ""}`} />;
    if (status === "skipped") return <SkipForward className={`text-stone-400 ${className || ""}`} />;
    return <Circle className={`text-stone-300 dark:text-stone-600 ${className || ""}`} />;
}
