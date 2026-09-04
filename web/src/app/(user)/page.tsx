"use client";

import { Drama, Folder } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { nanoid } from "nanoid";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { uploadAssetMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { AssetPickerModal } from "./canvas/components/asset-picker-modal";
import { CanvasAssistantComposer } from "./canvas/components/canvas-assistant-composer";
import { useCanvasStore } from "./canvas/stores/use-canvas-store";
import {
    CanvasNodeType,
    type CanvasAgentConfig,
    type CanvasAssistantReference,
    type InsertAssetPayload,
    type PendingAgentAsset,
} from "./canvas/types";
import { canvasResourceLabel } from "./canvas/utils/canvas-resource-references";

function toPendingAgentAsset(payload: InsertAssetPayload, label: string): PendingAgentAsset {
    const nodeId = nanoid();
    let reference: CanvasAssistantReference;
    if (payload.kind === "text") {
        reference = { id: nodeId, type: CanvasNodeType.Text, title: payload.title, label, text: payload.content };
    } else {
        const common = { id: nodeId, title: payload.title, label, storageKey: payload.storageKey, mimeType: payload.mimeType };
        if (payload.kind === "image") reference = { ...common, type: CanvasNodeType.Image, dataUrl: payload.dataUrl };
        else if (payload.kind === "video") reference = { ...common, type: CanvasNodeType.Video, url: payload.url };
        else reference = { ...common, type: CanvasNodeType.Audio, url: payload.url };
    }
    return { nodeId, payload, reference };
}

// 首页＝Codex 新对话形态：居中 composer + 最近项目列表；轮播与提示词画廊移至侧栏「探索」
export default function IndexPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const effectiveConfig = useEffectiveConfig();
    const createProject = useCanvasStore((state) => state.createProject);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const dramaProjects = useDramaStore((state) => state.projects);
    const [prompt, setPrompt] = useState("");
    const [pendingAssets, setPendingAssets] = useState<PendingAgentAsset[]>([]);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [targetProjectId, setTargetProjectId] = useState("");
    const [agentConfig, setAgentConfig] = useState<CanvasAgentConfig>(() => ({
        imageQuality: effectiveConfig.quality,
        imageSize: effectiveConfig.size,
        videoQuality: effectiveConfig.vquality,
        videoSize: effectiveConfig.videoSize,
    }));
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const pendingAssetCountsRef = useRef<Record<InsertAssetPayload["kind"], number>>({ text: 0, image: 0, video: 0, audio: 0 });

    // A#32 首启引导：仅首次启动展示三步引导
    useEffect(() => {
        if (localStorage.getItem("infinite-canvas:onboarded")) return;
        localStorage.setItem("infinite-canvas:onboarded", "1");
        Modal.info({
            title: "欢迎使用无限画布",
            width: 480,
            okText: "开始创作",
            content: (
                <ol className="mt-2 space-y-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
                    <li>1. 在输入框描述创作目标，Agent 会自主创建画布并生成分镜与图片</li>
                    <li>2. 到「设置 → 模型渠道」配置你的 API Key 与默认模型（底行也可直接切换）</li>
                    <li>3. 用「AI 漫剧」把小说一路推进到成片</li>
                </ol>
            ),
        });
    }, []);

    const addPendingAsset = (payload: InsertAssetPayload) => {
        const asset = toPendingAgentAsset(payload, canvasResourceLabel(payload.kind, pendingAssetCountsRef.current[payload.kind]++));
        setPendingAssets((current) => [...current, asset]);
        setPrompt((current) => `${current}${current.endsWith(" ") ? "" : " "}${asset.reference.label} `);
    };

    const uploadFile = async (file: File) => {
        try {
            if (file.type.startsWith("image/")) {
                const uploaded = await uploadImage(file);
                addPendingAsset({ kind: "image", dataUrl: uploaded.url, title: file.name, ...uploaded });
            } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
                const uploaded = await uploadAssetMediaFile(file);
                if (file.type.startsWith("video/")) addPendingAsset({ kind: "video", title: file.name, ...uploaded });
                else addPendingAsset({ kind: "audio", title: file.name, ...uploaded });
            } else {
                throw new Error("仅支持图片、视频和音频文件");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
        }
    };

    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadFile(file);
    };

    const submit = (nextPrompt = prompt, referenceIds = pendingAssets.map((asset) => asset.nodeId)) => {
        const text = nextPrompt.trim();
        if (!text || submitting) return;
        if (!hydrated) {
            message.info("画布数据正在加载，请稍后再试");
            return;
        }
        setSubmitting(true);
        const agentRequest = { prompt: text, assets: pendingAssets.filter((asset) => referenceIds.includes(asset.nodeId)) };
        if (targetProjectId) {
            // 目标为已有画布：注入 Agent 请求后直接进入该项目
            useCanvasStore.getState().updateProject(targetProjectId, { agentConfig, pendingAgentRequest: agentRequest });
            router.push(`/canvas/view?id=${targetProjectId}`);
            return;
        }
        const titles = new Set(useCanvasStore.getState().projects.map(({ title }) => title));
        let title = "无限画布";
        for (let i = 1; titles.has(title); i++) title = `无限画布 ${i}`;
        const projectId = createProject(title, {
            agentConfig,
            pendingAgentRequest: agentRequest,
        });
        router.push(`/canvas/view?id=${projectId}`);
    };

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col items-center justify-center px-6 py-10">
                <div className="w-full">
                    <CanvasAssistantComposer
                        prompt={prompt}
                        isRunning={false}
                        references={pendingAssets.map((asset) => asset.reference)}
                        agentConfig={agentConfig}
                        onAgentConfigChange={(patch) => setAgentConfig((current) => ({ ...current, ...patch }))}
                        targetProjectId={targetProjectId}
                        onTargetProjectChange={setTargetProjectId}
                        onPromptChange={setPrompt}
                        onReferenceIdsChange={(ids) => setPendingAssets((current) => current.filter((asset) => ids.includes(asset.nodeId)))}
                        onSubmit={submit}
                        onOpenUpload={() => uploadInputRef.current?.click()}
                        onOpenAssets={() => setAssetPickerOpen(true)}
                        onPasteImage={(file) => void uploadFile(file)}
                    />
                    <input ref={uploadInputRef} hidden type="file" accept="image/*,video/*,audio/*" onChange={onUploadInputChange} />
                </div>

                {effectiveConfig.showSuggestions !== "" ? (
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                        {["把这段小说改成 27 镜分镜", "给镜头 1 生成首帧", "做一支 15 秒宣传片", "整理我的素材库"].map((suggestion, index) => (
                            <button
                                key={suggestion}
                                type="button"
                                onClick={() => setPrompt(suggestion)}
                                style={{ animationDelay: `${index * 90}ms` }}
                                className="composer-suggestion h-8 rounded-full border border-border/70 px-3 text-xs text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                ) : null}

                <div className="mt-10 w-full">
                    <div className="mb-1.5 px-3 text-xs text-muted-foreground">最近</div>
                    <div className="flex flex-col gap-0.5">
                        {canvasProjects.slice(0, 5).map((project) => (
                            <Link
                                key={project.id}
                                href={`/canvas/view?id=${project.id}`}
                                className={cn("flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground")}
                            >
                                <Folder className="size-4 shrink-0" />
                                <span className="truncate">{project.title}</span>
                                <span className="ml-auto shrink-0 text-xs opacity-60">{new Date(project.updatedAt).toLocaleDateString()}</span>
                            </Link>
                        ))}
                        {dramaProjects.slice(0, 3).map((project) => (
                            <Link
                                key={project.id}
                                href="/drama"
                                className={cn("flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground")}
                            >
                                <Drama className="size-4 shrink-0" />
                                <span className="truncate">{project.title}</span>
                            </Link>
                        ))}
                        {!canvasProjects.length && !dramaProjects.length ? <div className="px-3 py-2 text-xs text-muted-foreground">暂无最近项目，输入创作目标开始</div> : null}
                    </div>
                </div>
            </div>
            <AssetPickerModal
                open={assetPickerOpen}
                defaultTab="my-assets"
                onInsert={(payload) => {
                    addPendingAsset(payload);
                    setAssetPickerOpen(false);
                }}
                onClose={() => setAssetPickerOpen(false)}
            />
        </main>
    );
}
