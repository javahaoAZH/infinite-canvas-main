"use client";

import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Drama, Ellipsis, FolderPlus, LockKeyhole, Network, PencilLine, Trash2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Dropdown, Empty, Input, Modal, Select, Steps } from "antd";
import saveAs from "file-saver";

import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useDramaStore, useActiveDramaProject } from "@/stores/use-drama-store";
import { useUserStore } from "@/stores/use-user-store";
import { checkEpisodeAssets } from "@/services/api/drama-assets";
import { getBridgeSnapshot, onBridgeStatusChange } from "./services/drama-bridge";
import { initDramaCanvasAutoSync, syncDramaProjectToCanvas } from "./services/drama-canvas-sync";
import { ComfyWorkflowsModal } from "./components/comfy-workflows-modal";
import { CharactersStep } from "./components/characters-step";
import { DirectorEntry } from "./components/director/director-entry";
import { ScriptStep } from "./components/script-step";
import { ShotImagesStep } from "./components/shot-images-step";
import { ShotVideosStep } from "./components/shot-videos-step";
import { ProductionPlanStep } from "./components/production-plan-step";
import { VoiceStep } from "./components/voice-step";
import { productionStages, type ProductionStage } from "./services/production-readiness";

const STEP_ITEMS = [
    { title: "原文拆解", content: "建立覆盖台账" },
    { title: "生产规划", content: "资产圣经与逐镜包" },
    { title: "资产生产", content: "母版、派生与版本确认" },
    { title: "关键帧 / 分镜", content: "先小样验收，再批量生成" },
    { title: "动态镜头", content: "以确认分镜生成视频" },
    { title: "配音成片", content: "配音、画布与成片" },
];

function ProductionGateRail({ stages, activeId, onNavigate }: { stages: ProductionStage[]; activeId: ProductionStage["id"]; onNavigate: (stage: ProductionStage) => void }) {
    return (
        <section className="border border-border bg-card/55 p-3" aria-label="生产门禁">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-medium text-foreground">制作门禁</div>
                    <p className="text-xs text-muted-foreground">只在当前产物通过后开放下一段生产，避免带错资产批量返工。</p>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{stages.filter((stage) => stage.ready).length}/{stages.length} READY</span>
            </div>
            <div className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                {stages.map((stage) => {
                    const active = stage.id === activeId;
                    return (
                        <button key={stage.id} type="button" className={`min-h-20 bg-card p-3 text-left transition-colors hover:bg-accent/55 ${active ? "shadow-[inset_0_2px_0_hsl(var(--primary))]" : ""}`} onClick={() => onNavigate(stage)}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[10px] text-muted-foreground">{stage.code}</span>
                                {stage.ready ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : active ? <CircleDashed className="size-3.5 text-amber-500" /> : <LockKeyhole className="size-3.5 text-muted-foreground/60" />}
                            </div>
                            <div className="mt-2 text-xs font-medium text-foreground">{stage.label}</div>
                            <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{stage.detail}</div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

// 头部轻量通道状态入口：状态点 + 标签，点击前往插件与渠道页（开关/令牌/注册配置在那里）
function BridgeStatusEntry() {
    const router = useRouter();
    const [snapshot, setSnapshot] = useState(() => getBridgeSnapshot());
    useEffect(() => onBridgeStatusChange(setSnapshot), []);
    const label = !snapshot.enabled ? "Qoder 通道" : snapshot.status === "connected" ? "Qoder 已连接" : snapshot.status === "connecting" ? "Qoder 连接中" : "Qoder 未连接";
    const dotClass = !snapshot.enabled ? "bg-stone-300 dark:bg-stone-600" : snapshot.status === "connected" ? "bg-emerald-500" : snapshot.status === "connecting" ? "animate-pulse bg-amber-500" : "bg-orange-500";
    return (
        <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-100"
            onClick={() => router.push("/plugins")}
        >
            <span className={`size-2 shrink-0 rounded-full ${dotClass}`} />
            {label}
        </button>
    );
}

export default function DramaPage() {
    const { message, modal } = App.useApp();
    const router = useRouter();
    useEffect(() => {
        initDramaCanvasAutoSync();
    }, []);
    const projects = useDramaStore((state) => state.projects);
    const createProject = useDramaStore((state) => state.createProject);
    const openProject = useDramaStore((state) => state.openProject);
    const renameProject = useDramaStore((state) => state.renameProject);
    const deleteProject = useDramaStore((state) => state.deleteProject);
    const updateProject = useDramaStore((state) => state.updateProject);
    const project = useActiveDramaProject();
    const effectiveConfig = useEffectiveConfig();
    const token = useUserStore((state) => state.token);
    const [comfyOpen, setComfyOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [assetGate, setAssetGate] = useState({ ready: false, detail: "等待资产清单开工检查" });
    const [planView, setPlanView] = useState<"coverage" | "assets" | "shots">("coverage");
    const [imageView, setImageView] = useState<"keyframes" | "storyboards">("keyframes");

    useEffect(() => {
        if (!project || !token) {
            setAssetGate({ ready: false, detail: token ? "当前项目不存在" : "严格资产模式需要先登录" });
            return;
        }
        let alive = true;
        checkEpisodeAssets(token, project.assetProject || project.title, project.episode || "ep01")
            .then((check) => {
                if (!alive) return;
                const issues = check.缺产出.length + check.未确认.length + check.依赖阻塞.length + (check.未定义引用?.length || 0) + (check.缺少文件?.length || 0) + (check.空资产镜头?.length || 0) + (check.字段不完整镜头?.length || 0) + (check.覆盖台账问题?.length || 0);
                setAssetGate({ ready: check.可开工, detail: check.可开工 ? "清单、版本、文件与逐镜引用均已确认" : `资产清单还有 ${issues} 项阻断` });
            })
            .catch(() => alive && setAssetGate({ ready: false, detail: "资产清单尚未同步或检查失败" }));
        return () => { alive = false; };
    }, [project?.id, project?.assetProject, project?.title, project?.episode, project?.assetRevision, token]);

    if (!project) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-6 bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <Drama className="size-10 text-stone-300 dark:text-stone-600" />
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有漫剧项目" />
                <Button type="primary" icon={<FolderPlus className="size-4" />} onClick={() => createProject()}>
                    新建漫剧项目
                </Button>
            </div>
        );
    }

    const localStages = productionStages(project);
    const localMasterReady = localStages.find((stage) => stage.id === "masters")?.ready || false;
    const stages = localStages.map((stage) => stage.id === "masters" ? {
        ...stage,
        ready: assetGate.ready && localMasterReady,
        detail: !localMasterReady ? "本集出场角色还没有身份参考视图" : assetGate.detail,
    } : stage);
    const ready = Object.fromEntries(stages.map((stage) => [stage.id, stage.ready])) as Record<ProductionStage["id"], boolean>;
    const foundationReady = ready.source && ready.assets && ready.shots;
    const canEnterStep = (target: number) => target === 0
        || (target === 1 && ready.source)
        || (target === 2 && foundationReady)
        || (target === 3 && foundationReady && ready.masters)
        || (target === 4 && ready.keyframes && ready.storyboards)
        || (target === 5 && ready.keyframes && ready.videos);
    const navigateStep = (target: number) => {
        if (target <= project.step || canEnterStep(target)) return updateProject(project.id, { step: target });
        message.warning("前置生产门禁尚未通过，请先补齐当前阶段的缺失项");
    };
    const navigateGate = (stage: ProductionStage) => {
        if (stage.id === "source") {
            if (!stage.ready) return navigateStep(0);
            setPlanView("coverage");
            return navigateStep(1);
        }
        if (stage.id === "assets" || stage.id === "shots") {
            setPlanView(stage.id);
            return navigateStep(1);
        }
        if (stage.id === "keyframes" || stage.id === "storyboards") {
            setImageView(stage.id);
            return navigateStep(3);
        }
        navigateStep(stage.step);
    };
    const activeGateId: ProductionStage["id"] = project.step === 1 ? (planView === "coverage" ? "source" : planView)
        : project.step === 2 ? "masters"
            : project.step === 3 ? imageView
                : project.step === 4 ? "videos"
                    : project.step === 5 ? "finish"
                        : "source";
    const nextReady = project.step === 0 ? ready.source
        : project.step === 1 ? foundationReady
            : project.step === 2 ? ready.masters
            : project.step === 3 ? ready.keyframes && ready.storyboards
                : project.step === 4 ? ready.videos
                    : false;
    const nextHint = project.step === 0 ? "需先建立完整原文覆盖台账"
        : project.step === 1 ? "需完成资产规划和逐镜生产包"
            : project.step === 2 ? "需完成本集所用角色身份参考与资产确认"
            : project.step === 3 ? "需先确认代表关键帧，再完成全部分镜图"
                : project.step === 4 ? "需完成全部动态镜头"
                    : "已到最终阶段";

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
                    <header className="flex flex-wrap items-center gap-3">
                        <div>
                            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                                <Drama className="size-6" />
                                AI 漫剧生产线
                            </h1>
                            <p className="mt-1 text-sm text-muted-foreground">原文证据 → 资产圣经 → 连续性分镜 → 资产确认 → 代表帧验收 → 批量生产。</p>
                        </div>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            <BridgeStatusEntry />
                            <DirectorEntry project={project} />
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        {
                                            key: "preview-storyboard",
                                            label: "预览分镜稿",
                                            onClick: () => {
                                                const lines = [`# ${project.title} 分镜稿`, ""];
                                                project.shots.forEach((shot, index) => {
                                                    lines.push(`## 镜 ${index + 1}`, `- 画面：${shot.description || "（未填写）"}`);
                                                    if (shot.dialogue.trim()) lines.push(`- 对白：${shot.dialogue.trim()}`);
                                                    if ((shot.narration || "").trim()) lines.push(`- 旁白：${shot.narration!.trim()}`);
                                                    if (shot.imagePrompt?.trim()) lines.push(`- 出图提示词：${shot.imagePrompt.trim()}`);
                                                    if (shot.videoPrompt?.trim()) lines.push(`- 视频提示词：${shot.videoPrompt.trim()}`);
                                                    lines.push("");
                                                });
                                                Modal.info({ title: "分镜稿预览（Markdown）", width: 640, content: <pre className="thin-scrollbar max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">{lines.join("\n")}</pre> });
                                            },
                                        },
                                        {
                                            key: "export-storyboard",
                                            label: "导出分镜稿（Markdown）",
                                            onClick: () => {
                                                const lines = [`# ${project.title} 分镜稿`, ""];
                                                project.shots.forEach((shot, index) => {
                                                    lines.push(`## 镜 ${index + 1}`, `- 画面：${shot.description || "（未填写）"}`);
                                                    if (shot.dialogue.trim()) lines.push(`- 对白：${shot.dialogue.trim()}`);
                                                    if ((shot.narration || "").trim()) lines.push(`- 旁白：${shot.narration!.trim()}`);
                                                    if (shot.imagePrompt?.trim()) lines.push(`- 出图提示词：${shot.imagePrompt.trim()}`);
                                                    if (shot.videoPrompt?.trim()) lines.push(`- 视频提示词：${shot.videoPrompt.trim()}`);
                                                    lines.push("");
                                                });
                                                saveAs(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }), `${project.title}-分镜稿.md`);
                                                message.success("分镜稿已导出");
                                            },
                                        },
                                    ],
                                }}
                            >
                                <Button icon={<Ellipsis className="size-4" />} aria-label="更多操作" title="分享与导出" />
                            </Dropdown>
                            <Button
                                icon={<Network className="size-4" />}
                                onClick={() => {
                                    const canvasProjectId = syncDramaProjectToCanvas(project.id);
                                    if (!canvasProjectId) return message.info("画布数据正在加载，请稍后再试");
                                    router.push(`/canvas/view?id=${canvasProjectId}`);
                                }}
                            >
                                工作流画布
                            </Button>
                            <Button icon={<Workflow className="size-4" />} onClick={() => setComfyOpen(true)}>
                                ComfyUI 工作流
                            </Button>
                            <Button type="primary" icon={<Network className="size-4" />} onClick={() => router.push(`/assets?tab=project&project=${encodeURIComponent(project.title)}`)}>
                                资产清单
                            </Button>
                            <Select
                                className="min-w-44"
                                value={project.id}
                                options={projects.map((item) => ({ value: item.id, label: item.title }))}
                                onChange={(id) => openProject(id)}
                            />
                            <Button icon={<FolderPlus className="size-4" />} onClick={() => createProject()}>
                                新建
                            </Button>
                            <Button
                                icon={<PencilLine className="size-4" />}
                                onClick={() => {
                                    setRenameValue(project.title);
                                    setRenameOpen(true);
                                }}
                            >
                                重命名
                            </Button>
                            <Button
                                danger
                                icon={<Trash2 className="size-4" />}
                                onClick={() =>
                                    modal.confirm({
                                        title: "删除漫剧项目",
                                        content: `确定删除「${project.title}」吗？项目内的分镜与生成记录会一并删除。`,
                                        okText: "删除",
                                        okButtonProps: { danger: true },
                                        cancelText: "取消",
                                        onOk: () => {
                                            deleteProject(project.id);
                                            message.success("项目已删除");
                                        },
                                    })
                                }
                            >
                                删除
                            </Button>
                        </div>
                    </header>

                    <Steps
                        size="small"
                        current={project.step}
                        items={STEP_ITEMS}
                        onChange={navigateStep}
                    />

                    <ProductionGateRail stages={stages} activeId={activeGateId} onNavigate={navigateGate} />

                    <div className="min-h-96">
                        {project.step === 0 ? <ScriptStep project={project} /> : null}
                        {project.step === 1 ? <ProductionPlanStep project={project} activeView={planView} onViewChange={setPlanView} /> : null}
                        {project.step === 2 ? <CharactersStep project={project} /> : null}
                        {project.step === 3 ? <ShotImagesStep project={project} activeView={imageView} onViewChange={setImageView} /> : null}
                        {project.step === 4 ? <ShotVideosStep project={project} /> : null}
                        {project.step === 5 ? <VoiceStep project={project} /> : null}
                    </div>

                    <footer className="flex items-center justify-between border-t border-border pt-4">
                        <Button icon={<ChevronLeft className="size-4" />} disabled={project.step === 0} onClick={() => updateProject(project.id, { step: project.step - 1 })}>
                            上一步
                        </Button>
                        <span className="text-center text-xs text-muted-foreground">
                            第 {project.step + 1} / {STEP_ITEMS.length} 步 · {STEP_ITEMS[project.step].title}{!nextReady && project.step < STEP_ITEMS.length - 1 ? ` · ${nextHint}` : ""}
                        </span>
                        <Button
                            type="primary"
                            icon={<ChevronRight className="size-4" />}
                            iconPlacement="end"
                            disabled={project.step === STEP_ITEMS.length - 1 || !nextReady}
                            onClick={() => navigateStep(project.step + 1)}
                        >
                            下一步
                        </Button>
                    </footer>
                </div>
            </main>

            <ComfyWorkflowsModal open={comfyOpen} onClose={() => setComfyOpen(false)} imageModel={effectiveConfig.imageModel || effectiveConfig.model} videoModel={effectiveConfig.videoModel || ""} />
            <Modal
                title="重命名漫剧项目"
                open={renameOpen}
                okText="保存"
                cancelText="取消"
                onCancel={() => setRenameOpen(false)}
                onOk={() => {
                    renameProject(project.id, renameValue);
                    setRenameOpen(false);
                }}
            >
                <Input value={renameValue} placeholder="项目名称" onChange={(event) => setRenameValue(event.target.value)} />
            </Modal>
        </div>
    );
}
