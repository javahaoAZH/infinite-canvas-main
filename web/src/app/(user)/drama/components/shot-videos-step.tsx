"use client";

import { Clapperboard, LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import { App, Button, Empty, Progress, Tag } from "antd";

import { buildShotVideoPrompt, resolveArtStyle } from "@/app/(user)/drama/prompts";
import { requestVideoGeneration } from "@/services/api/video";
import { dramaVideoConfig, toReferenceImage, useDramaStore, type DramaMedia, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";

export function ShotVideosStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateProject = useDramaStore((state) => state.updateProject);
    const artStyle = useDramaStore((state) => state.artStyle);
    const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
    const [progressMap, setProgressMap] = useState<Record<string, number>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [batchRunning, setBatchRunning] = useState(false);

    const patchShotVideo = (shotId: string, media: DramaMedia) => {
        const current = useDramaStore.getState().projects.find((item) => item.id === project.id);
        updateProject(project.id, { shotVideos: { ...(current?.shotVideos || {}), [shotId]: media } });
    };

    const generateShotVideo = async (shotId: string) => {
        const current = useDramaStore.getState().projects.find((item) => item.id === project.id);
        const shot = current?.shots.find((item) => item.id === shotId);
        const shotImage = current?.shotImages[shotId];
        if (!shot || !shotImage) throw new Error("请先生成该分镜的分镜图");
        const config = dramaVideoConfig(effectiveConfig);
        if (!isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的视频模型渠道");
        const prompt = buildShotVideoPrompt(shot.description, resolveArtStyle(useDramaStore.getState().artStyle).promptBase);
        const result = await requestVideoGeneration(config, prompt, [toReferenceImage(shotImage, "分镜图")], (progress) => {
            setProgressMap((prev) => ({ ...prev, [shotId]: progress }));
        });
        patchShotVideo(shotId, {
            url: result.url,
            storageKey: result.task.storageKey,
            width: result.width,
            height: result.height,
            durationMs: result.durationMs,
            mimeType: result.mimeType || "video/mp4",
        });
    };

    const runSingle = async (shotId: string) => {
        setBusyIds((current) => ({ ...current, [shotId]: true }));
        setErrors((current) => ({ ...current, [shotId]: "" }));
        setProgressMap((current) => ({ ...current, [shotId]: 0 }));
        try {
            await generateShotVideo(shotId);
        } catch (error) {
            setErrors((current) => ({ ...current, [shotId]: error instanceof Error ? error.message : "视频生成失败，可重试" }));
        } finally {
            setBusyIds((current) => ({ ...current, [shotId]: false }));
        }
    };

    const runBatch = async () => {
        const pending = project.shots.filter((shot) => project.shotImages[shot.id] && !project.shotVideos[shot.id]);
        if (!pending.length) return message.info("没有待生成的分镜视频（需要先有分镜图）");
        setBatchRunning(true);
        let failed = 0;
        for (const shot of pending) {
            setBusyIds((current) => ({ ...current, [shot.id]: true }));
            setErrors((current) => ({ ...current, [shot.id]: "" }));
            try {
                await generateShotVideo(shot.id);
            } catch (error) {
                failed += 1;
                setErrors((current) => ({ ...current, [shot.id]: error instanceof Error ? error.message : "视频生成失败，可重试" }));
            } finally {
                setBusyIds((current) => ({ ...current, [shot.id]: false }));
            }
        }
        setBatchRunning(false);
        message[failed ? "warning" : "success"](failed ? `批量生成完成，${failed} 个分镜失败，可单独重试` : "全部分镜视频生成完成");
    };

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
                    <span>逐分镜用分镜图生成视频，生成时间较长，请耐心等待；失败的分镜可单独重试。</span>
                    <span className="flex items-center gap-1">
                        画面风格
                        <Tag className="m-0">{resolveArtStyle(artStyle).label}</Tag>
                    </span>
                </div>
                <Button type="primary" icon={<Clapperboard className="size-4" />} loading={batchRunning} onClick={() => void runBatch()}>
                    生成全部
                </Button>
            </div>

            {project.shots.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分镜，请先完成分镜步骤" className="py-16" />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {project.shots.map((shot, index) => {
                        const media = project.shotVideos[shot.id];
                        const shotImage = project.shotImages[shot.id];
                        const busy = busyIds[shot.id];
                        return (
                            <div key={shot.id} className="flex flex-col border border-stone-200 bg-white/70 dark:border-stone-800 dark:bg-stone-900/50">
                                <div className="aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
                                    {busy ? (
                                        <div className="flex h-full flex-col items-center justify-center gap-2 px-6">
                                            <LoaderCircle className="size-6 animate-spin text-stone-400" />
                                            <Progress percent={Math.min(99, Math.round(progressMap[shot.id] || 0))} size="small" className="w-full" />
                                        </div>
                                    ) : media ? (
                                        <video src={media.url} controls className="h-full w-full object-contain" />
                                    ) : shotImage ? (
                                        <img src={shotImage.url} alt={`分镜 ${index + 1}`} className="h-full w-full object-cover opacity-60" />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-xs text-stone-400 dark:text-stone-500">分镜 {index + 1} · 缺少分镜图</div>
                                    )}
                                </div>
                                <div className="flex-1 space-y-2 p-3">
                                    <p className="line-clamp-2 min-h-7 text-xs leading-5 text-stone-600 dark:text-stone-300">{shot.description || "（暂无画面描述）"}</p>
                                    {errors[shot.id] ? <p className="text-xs text-red-500">{errors[shot.id]}</p> : null}
                                    <Button
                                        size="small"
                                        block
                                        icon={<RotateCcw className="size-4" />}
                                        loading={busy}
                                        disabled={!shotImage}
                                        onClick={() => void runSingle(shot.id)}
                                    >
                                        {media ? "重新生成视频" : "生成视频"}
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
