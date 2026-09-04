"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, FolderOpen, ImageIcon, Mic, Plus, ShieldCheck, Square, Upload, Video } from "lucide-react";
import { App, Button, Dropdown, Select } from "antd";

import { productionStages, type ProductionStage } from "@/app/(user)/drama/services/production-readiness";
import { useCanvasStore } from "../stores/use-canvas-store";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasAgentConfig, type CanvasAssistantReference } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";

type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: (event: { results: ArrayLike<Array<{ transcript: string }>> }) => void;
    onend: () => void;
    onerror: () => void;
    start: () => void;
    stop: () => void;
};

const PROMPT_TEMPLATES = [
    { key: "novel-to-shots", label: "小说改编分镜", template: "把下面的小说片段改编成连续分镜，逐镜给出画面描述、对白与出图提示词：\n" },
    { key: "first-frame", label: "首帧提示词", template: "为以下画面生成电影感首帧提示词（主体、光线、镜头、氛围）：\n" },
    { key: "promo", label: "宣传片脚本", template: "生成一支 15 秒宣传片脚本，含镜头节奏与画面描述：\n" },
];

export type CanvasAssistantComposerProps = {
    prompt: string;
    isRunning: boolean;
    references: CanvasAssistantReference[];
    availableReferences?: CanvasResourceReference[];
    pendingReferences?: CanvasResourceReference[];
    agentConfig: CanvasAgentConfig;
    onAgentConfigChange: (patch: Partial<CanvasAgentConfig>) => void;
    onPromptChange: (prompt: string) => void;
    onReferenceIdsChange: (ids: string[]) => void;
    onSubmit: (prompt?: string, referenceIds?: string[]) => void | Promise<void>;
    onStop?: () => void;
    onOpenUpload: () => void;
    onOpenAssets: () => void;
    onPasteImage: (file: File) => void;
    // 首页专用：目标画布项目选择器（传入才显示；不传 = 画布内面板，无此语义）
    targetProjectId?: string;
    onTargetProjectChange?: (projectId: string) => void;
};

export function CanvasAssistantComposer({
    prompt,
    isRunning,
    references,
    availableReferences,
    pendingReferences,
    agentConfig,
    onAgentConfigChange,
    onPromptChange,
    onReferenceIdsChange,
    onSubmit,
    onStop,
    onOpenUpload,
    onOpenAssets,
    onPasteImage,
    targetProjectId,
    onTargetProjectChange,
}: CanvasAssistantComposerProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const router = useRouter();
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const dramaProjects = useDramaStore((state) => state.projects);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    // A#11 执行渠道：仅有云端渠道权限且允许自定义时外露本地/云切换
    const canSwitchChannel = Boolean(token && user && (user.role === "admin" || publicSettings?.modelChannel?.allowUserRemoteChannel === true) && publicSettings?.modelChannel?.allowCustomChannel);
    const listeningRef = useRef<{ stop: () => void } | null>(null);
    // A#21 @ 触发：输入以 @ 结尾时打开素材选择，选中后作为引用 chip 插入
    const handlePromptChange = (value: string) => {
        if (value.endsWith("@")) onOpenAssets();
        onPromptChange(value);
    };
    // A#33 语音听写：WebView2/Chromium 支持的 Web Speech API
    const toggleDictation = () => {
        const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
        if (!Ctor) return message.warning("当前环境不支持语音听写");
        if (listeningRef.current) {
            listeningRef.current.stop();
            listeningRef.current = null;
            return;
        }
        const recognition = new Ctor();
        recognition.lang = "zh-CN";
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
            const text = Array.from(event.results)
                .map((result) => result[0]?.transcript)
                .join("");
            handlePromptChange(`${prompt}${prompt ? " " : ""}${text}`);
        };
        recognition.onend = () => (listeningRef.current = null);
        recognition.onerror = () => (listeningRef.current = null);
        listeningRef.current = recognition;
        recognition.start();
        message.info("正在听写，再说一遍内容后停顿即可");
    };
    // 门禁模式 chip：取最近更新的漫剧项目的首个未就绪门禁（请求批准式，全部就绪时不显示）
    const pendingGate = useMemo(() => {
        let latest: { title: string; updatedAt: string; stage: ProductionStage } | null = null;
        for (const project of dramaProjects) {
            const stage = productionStages(project).find((item) => !item.ready);
            if (!stage || (latest && project.updatedAt <= latest.updatedAt)) continue;
            latest = { title: project.title, updatedAt: project.updatedAt, stage };
        }
        return latest ? { title: latest.title, stage: latest.stage } : null;
    }, [dramaProjects]);
    const imageConfig = useMemo(() => ({ ...effectiveConfig, quality: agentConfig.imageQuality, size: agentConfig.imageSize }), [agentConfig.imageQuality, agentConfig.imageSize, effectiveConfig]);
    const videoConfig = useMemo(() => ({ ...effectiveConfig, vquality: agentConfig.videoQuality, size: agentConfig.videoSize }), [agentConfig.videoQuality, agentConfig.videoSize, effectiveConfig]);
    const promptReferences = useMemo(() => {
        const seen = new Set<string>();
        return [...(availableReferences || []), ...references.map(assistantToPromptReference)].filter((reference) => {
            if (seen.has(reference.nodeId)) return false;
            seen.add(reference.nodeId);
            return true;
        });
    }, [availableReferences, references]);
    const submit = (nextPrompt = prompt, referenceIds = references.map((reference) => reference.id)) => onSubmit(nextPrompt, referenceIds);

    return (
        <div className="px-2 pb-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="rounded-2xl border px-3 pb-3 pt-3" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                <CanvasPromptChipInput
                    value={prompt}
                    references={promptReferences}
                    pendingReferences={pendingReferences}
                    onChange={handlePromptChange}
                    onReferenceIdsChange={onReferenceIdsChange}
                    onPasteImage={onPasteImage}
                    onSubmit={submit}
                    className="thin-scrollbar min-h-20 max-h-[220px] w-full px-1 py-0 text-sm leading-5"
                    style={{ color: theme.node.text }}
                    placeholder="描述创作目标，或让我继续操作画布"
                    placeholderClassName="!left-1 !top-0"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1.5">
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    { key: "upload", icon: <Upload className="size-4" />, label: "上传文件" },
                                    { key: "assets", icon: <FolderOpen className="size-4" />, label: "我的素材" },
                                ],
                                onClick: ({ key }) => (key === "upload" ? onOpenUpload() : onOpenAssets()),
                            }}
                        >
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={{ color: theme.node.text }} icon={<Plus className="size-4" />} aria-label="添加素材" />
                        </Dropdown>
                        <ModelPicker
                            config={effectiveConfig}
                            value={effectiveConfig.textModel || effectiveConfig.model}
                            capability="text"
                            channelId={effectiveConfig.textChannelId}
                            onChange={(model, channelId) => {
                                updateConfig("textModel", model);
                                if (channelId) updateConfig("textChannelId", channelId);
                            }}
                            className="min-w-0 max-w-[9rem]"
                            onMissingConfig={() => router.push("/settings")}
                        />
                        {pendingGate ? (
                            <Button
                                type="text"
                                size="small"
                                className="!h-8 !max-w-[210px] !justify-start !rounded-full !px-2.5 !text-amber-600 dark:!text-amber-500"
                                style={{ background: theme.node.fill }}
                                icon={<ShieldCheck className="size-3.5" />}
                                onClick={() => router.push("/drama")}
                                title={`${pendingGate.title} · 点击打开漫剧生产`}
                            >
                                <span className="truncate">{pendingGate.stage.code} {pendingGate.stage.label} · {pendingGate.stage.detail}</span>
                            </Button>
                        ) : null}
                        {canSwitchChannel ? (
                            <Select
                                size="small"
                                value={effectiveConfig.channelMode}
                                onChange={(value) => updateConfig("channelMode", value)}
                                options={[{ label: "本地", value: "local" }, { label: "云端", value: "remote" }]}
                                className="!w-[76px]"
                                popupMatchSelectWidth={false}
                            />
                        ) : null}
                        {onTargetProjectChange ? (
                            <Select
                                size="small"
                                allowClear
                                placeholder="新画布"
                                value={targetProjectId || null}
                                onChange={(value) => onTargetProjectChange(value || "")}
                                options={canvasProjects.filter((project) => !project.archived).slice(0, 50).map((project) => ({ label: project.title, value: project.id }))}
                                className="!w-[120px]"
                                popupMatchSelectWidth={false}
                            />
                        ) : null}
                        <Select
                            size="small"
                            value={effectiveConfig.assistantMode || "chat"}
                            onChange={(value) => updateConfig("assistantMode", value)}
                            options={[{ label: "对话", value: "chat" }, { label: "执行", value: "execute" }]}
                            className="!w-[72px]"
                            popupMatchSelectWidth={false}
                        />
                        <CanvasImageSettingsPopover
                            config={imageConfig}
                            placement="topLeft"
                            showCount={false}
                            buttonIcon={<ImageIcon className="size-3.5" />}
                            buttonClassName="!h-8 !max-w-[116px] !justify-start !rounded-full !px-2.5"
                            onConfigChange={(key, value) => {
                                if (key === "quality") onAgentConfigChange({ imageQuality: value });
                                else if (key === "size") onAgentConfigChange({ imageSize: value });
                            }}
                        />
                        <CanvasVideoSettingsPopover
                            config={videoConfig}
                            placement="topLeft"
                            visualOnly
                            buttonIcon={<Video className="size-3.5" />}
                            buttonClassName="!h-8 !max-w-[124px] !justify-start !rounded-full !px-2.5"
                            onConfigChange={(key, value) => {
                                if (key === "vquality") onAgentConfigChange({ videoQuality: value });
                                else if (key === "size") onAgentConfigChange({ videoSize: value });
                            }}
                        />
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: PROMPT_TEMPLATES.map((item) => ({ key: item.key, label: item.label })),
                                onClick: ({ key }) => {
                                    const template = PROMPT_TEMPLATES.find((item) => item.key === key);
                                    if (template) handlePromptChange(`${prompt}${prompt ? "\n" : ""}${template.template}`);
                                },
                            }}
                        >
                            <Button type="text" shape="circle" className="!size-8 !min-w-8 !text-muted-foreground" title="提示词模板" aria-label="提示词模板" icon={<BookOpen className="size-4" />} />
                        </Dropdown>
                        <Button
                            type="text"
                            shape="circle"
                            className="!size-8 !min-w-8 !text-muted-foreground"
                            title={listeningRef.current ? "停止听写" : "语音听写"}
                            aria-label="语音听写"
                            icon={<Mic className="size-4" />}
                            onClick={toggleDictation}
                        />
                    </div>
                    <Button
                        type="primary"
                        shape="circle"
                        className="!size-10 !min-w-10"
                        disabled={!isRunning && !prompt.trim()}
                        onClick={() => (isRunning ? onStop?.() : void submit())}
                        aria-label={isRunning ? "停止" : "发送"}
                        icon={isRunning ? <Square className="size-4 fill-current" /> : <ArrowUp className="size-4" />}
                    />
                </div>
            </div>
        </div>
    );
}

export function assistantToPromptReference(reference: CanvasAssistantReference): CanvasResourceReference {
    const kind = reference.type === CanvasNodeType.Video ? "video" : reference.type === CanvasNodeType.Audio ? "audio" : reference.type === CanvasNodeType.Text ? "text" : "image";
    return { id: reference.id, nodeId: reference.id, kind, label: reference.label || reference.title, title: reference.title, previewUrl: reference.dataUrl || reference.url, text: reference.text, active: true };
}
