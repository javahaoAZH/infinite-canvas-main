"use client";

import { ChevronLeft, ChevronRight, Drama, FolderPlus, PencilLine, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Steps } from "antd";

import { useConfigStore } from "@/stores/use-config-store";
import { useDramaStore, useActiveDramaProject } from "@/stores/use-drama-store";
import { getBridgeSnapshot, onBridgeStatusChange } from "./services/drama-bridge";
import { CharactersStep } from "./components/characters-step";
import { DirectorEntry } from "./components/director/director-entry";
import { ScriptStep } from "./components/script-step";
import { ShotImagesStep } from "./components/shot-images-step";
import { ShotVideosStep } from "./components/shot-videos-step";
import { ShotsStep } from "./components/shots-step";
import { VoiceStep } from "./components/voice-step";

const STEP_ITEMS = [
    { title: "剧本", content: "输入剧本并结构化" },
    { title: "分镜", content: "编辑分镜内容" },
    { title: "角色四视图", content: "生成立绘并分配视图" },
    { title: "分镜图", content: "逐分镜生成画面" },
    { title: "图生视频", content: "逐分镜生成视频" },
    { title: "配音成片", content: "配音、画布与成片" },
];

// 头部轻量通道状态入口：状态点 + 标签，点击打开配置弹窗（开关/令牌/注册配置在「配置与用户偏好」中）
function BridgeStatusEntry() {
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const [snapshot, setSnapshot] = useState(() => getBridgeSnapshot());
    useEffect(() => onBridgeStatusChange(setSnapshot), []);
    const label = !snapshot.enabled ? "Qoder 通道" : snapshot.status === "connected" ? "Qoder 已连接" : snapshot.status === "connecting" ? "Qoder 连接中" : "Qoder 未连接";
    const dotClass = !snapshot.enabled ? "bg-stone-300 dark:bg-stone-600" : snapshot.status === "connected" ? "bg-emerald-500" : snapshot.status === "connecting" ? "animate-pulse bg-amber-500" : "bg-orange-500";
    return (
        <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-100"
            onClick={() => setConfigDialogOpen(true)}
        >
            <span className={`size-2 shrink-0 rounded-full ${dotClass}`} />
            {label}
        </button>
    );
}

export default function DramaPage() {
    const { message, modal } = App.useApp();
    const projects = useDramaStore((state) => state.projects);
    const createProject = useDramaStore((state) => state.createProject);
    const openProject = useDramaStore((state) => state.openProject);
    const renameProject = useDramaStore((state) => state.renameProject);
    const deleteProject = useDramaStore((state) => state.deleteProject);
    const updateProject = useDramaStore((state) => state.updateProject);
    const project = useActiveDramaProject();
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState("");

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
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">剧本 → 分镜 → 角色四视图 → 分镜图 → 图生视频 → 配音成片，六步完成一部漫剧。</p>
                        </div>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            <BridgeStatusEntry />
                            <DirectorEntry project={project} />
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
                        onChange={(step) => updateProject(project.id, { step })}
                    />

                    <div className="min-h-96">
                        {project.step === 0 ? <ScriptStep project={project} /> : null}
                        {project.step === 1 ? <ShotsStep project={project} /> : null}
                        {project.step === 2 ? <CharactersStep project={project} /> : null}
                        {project.step === 3 ? <ShotImagesStep project={project} /> : null}
                        {project.step === 4 ? <ShotVideosStep project={project} /> : null}
                        {project.step === 5 ? <VoiceStep project={project} /> : null}
                    </div>

                    <footer className="flex items-center justify-between border-t border-stone-200 pt-4 dark:border-stone-800">
                        <Button icon={<ChevronLeft className="size-4" />} disabled={project.step === 0} onClick={() => updateProject(project.id, { step: project.step - 1 })}>
                            上一步
                        </Button>
                        <span className="text-xs text-stone-400 dark:text-stone-500">
                            第 {project.step + 1} / {STEP_ITEMS.length} 步 · {STEP_ITEMS[project.step].title}
                        </span>
                        <Button
                            type="primary"
                            icon={<ChevronRight className="size-4" />}
                            iconPlacement="end"
                            disabled={project.step === STEP_ITEMS.length - 1}
                            onClick={() => updateProject(project.id, { step: project.step + 1 })}
                        >
                            下一步
                        </Button>
                    </footer>
                </div>
            </main>

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
