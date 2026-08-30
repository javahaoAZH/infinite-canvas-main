"use client";

import { ImagePlus, Images, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { App, Button, Empty, Tag } from "antd";

import { buildShotImagePrompt, resolveArtStyle } from "@/app/(user)/drama/prompts";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { collectCharacterReferences, dramaImageConfig, useDramaStore, type DramaMedia, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";

export function ShotImagesStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateProject = useDramaStore((state) => state.updateProject);
    const artStyle = useDramaStore((state) => state.artStyle);
    const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [batchRunning, setBatchRunning] = useState(false);

    const patchShotImage = (shotId: string, media: DramaMedia) => {
        const current = useDramaStore.getState().projects.find((item) => item.id === project.id);
        updateProject(project.id, { shotImages: { ...(current?.shotImages || {}), [shotId]: media } });
    };

    const generateShotImage = async (shotId: string) => {
        const shot = useDramaStore.getState().projects.find((item) => item.id === project.id)?.shots.find((item) => item.id === shotId);
        if (!shot) return;
        if (!shot.description.trim()) throw new Error("请先在分镜步骤填写画面描述");
        const config = dramaImageConfig(effectiveConfig);
        if (!isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的图片模型渠道");
        const references = collectCharacterReferences(useDramaStore.getState().projects.find((item) => item.id === project.id)?.characters || []);
        const prompt = buildShotImagePrompt(shot.description, resolveArtStyle(useDramaStore.getState().artStyle).promptBase);
        const images = references.length ? await requestEdit(config, prompt, references) : await requestGeneration(config, prompt);
        const image = images[0];
        if (!image) throw new Error("图片接口没有返回结果");
        const uploaded = await uploadImage(image.dataUrl);
        patchShotImage(shotId, { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType });
    };

    const runSingle = async (shotId: string) => {
        setBusyIds((current) => ({ ...current, [shotId]: true }));
        setErrors((current) => ({ ...current, [shotId]: "" }));
        try {
            await generateShotImage(shotId);
        } catch (error) {
            setErrors((current) => ({ ...current, [shotId]: error instanceof Error ? error.message : "分镜图生成失败，可重试" }));
        } finally {
            setBusyIds((current) => ({ ...current, [shotId]: false }));
        }
    };

    const runBatch = async () => {
        const pending = project.shots.filter((shot) => !project.shotImages[shot.id]);
        if (!pending.length) return message.info("所有分镜图都已生成");
        setBatchRunning(true);
        let failed = 0;
        for (const shot of pending) {
            setBusyIds((current) => ({ ...current, [shot.id]: true }));
            setErrors((current) => ({ ...current, [shot.id]: "" }));
            try {
                await generateShotImage(shot.id);
            } catch (error) {
                failed += 1;
                setErrors((current) => ({ ...current, [shot.id]: error instanceof Error ? error.message : "分镜图生成失败，可重试" }));
            } finally {
                setBusyIds((current) => ({ ...current, [shot.id]: false }));
            }
        }
        setBatchRunning(false);
        message[failed ? "warning" : "success"](failed ? `批量生成完成，${failed} 个分镜失败，可单独重试` : "全部分镜图生成完成");
    };

    const referenceCount = collectCharacterReferences(project.characters).length;

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
                    <span>
                        逐分镜生成画面，{referenceCount > 0 ? `已带上 ${referenceCount} 张角色视图作为参考图，保持角色一致性。` : "暂无角色视图参考，可回到上一步分配视图。"}
                    </span>
                    <span className="flex items-center gap-1">
                        画面风格
                        <Tag className="m-0">{resolveArtStyle(artStyle).label}</Tag>
                    </span>
                </div>
                <Button type="primary" icon={<Images className="size-4" />} loading={batchRunning} onClick={() => void runBatch()}>
                    生成全部
                </Button>
            </div>

            {project.shots.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分镜，请先完成分镜步骤" className="py-16" />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {project.shots.map((shot, index) => {
                        const media = project.shotImages[shot.id];
                        const busy = busyIds[shot.id];
                        return (
                            <div key={shot.id} className="flex flex-col border border-stone-200 bg-white/70 dark:border-stone-800 dark:bg-stone-900/50">
                                <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-stone-100 dark:bg-stone-800">
                                    {busy ? (
                                        <LoaderCircle className="size-6 animate-spin text-stone-400" />
                                    ) : media ? (
                                        <img src={media.url} alt={`分镜 ${index + 1}`} className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="text-xs text-stone-400 dark:text-stone-500">分镜 {index + 1} · 未生成</span>
                                    )}
                                </div>
                                <div className="flex-1 space-y-2 p-3">
                                    <p className="line-clamp-3 min-h-10 text-xs leading-5 text-stone-600 dark:text-stone-300">{shot.description || "（暂无画面描述）"}</p>
                                    {errors[shot.id] ? <p className="text-xs text-red-500">{errors[shot.id]}</p> : null}
                                    <Button size="small" block icon={<ImagePlus className="size-4" />} loading={busy} onClick={() => void runSingle(shot.id)}>
                                        {media ? "重新生成" : "生成分镜图"}
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
