"use client";

import { Clapperboard, LoaderCircle, RotateCcw, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, App, Button, Empty, Progress, Tag } from "antd";

import { resolveArtStyleLabel } from "@/app/(user)/drama/prompts";
import { generateShotVideo } from "@/app/(user)/drama/services/drama-generation";
import { approvedRepresentativeIds, representativeShotIds } from "@/app/(user)/drama/services/production-readiness";
import { useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig } from "@/stores/use-config-store";

export function ShotVideosStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const artStyle = useDramaStore((state) => state.artStyle);
    const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
    const [progressMap, setProgressMap] = useState<Record<string, number>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [batchRunning, setBatchRunning] = useState(false);
    // 批量停止开关：置 true 后不再派发新任务，在途请求自然结束（与导演台「终止」同语义）
    const batchCancelRef = useRef(false);
    const representativeIds = representativeShotIds(project);
    const approvedIds = approvedRepresentativeIds(project);
    const keyframeGateReady = representativeIds.length > 0 && approvedIds.length === representativeIds.length;
    const imageCount = project.shots.filter((shot) => project.shotImages[shot.id]).length;
    const allImagesReady = Boolean(project.shots.length) && imageCount === project.shots.length;

    const runSingle = async (shotId: string) => {
        setBusyIds((current) => ({ ...current, [shotId]: true }));
        setErrors((current) => ({ ...current, [shotId]: "" }));
        setProgressMap((current) => ({ ...current, [shotId]: 0 }));
        try {
            await generateShotVideo(project.id, shotId, effectiveConfig, (progress) => {
                setProgressMap((prev) => ({ ...prev, [shotId]: progress }));
            });
        } catch (error) {
            setErrors((current) => ({ ...current, [shotId]: error instanceof Error ? error.message : "视频生成失败，可重试" }));
        } finally {
            setBusyIds((current) => ({ ...current, [shotId]: false }));
        }
    };

    const runBatch = async () => {
        const pending = project.shots.filter((shot) => project.shotImages[shot.id] && !project.shotVideos[shot.id]);
        if (!pending.length) return message.info("没有待生成的分镜视频（需要先有分镜图）");
        batchCancelRef.current = false;
        setBatchRunning(true);
        let failed = 0;
        for (const shot of pending) {
            if (batchCancelRef.current) break;
            setBusyIds((current) => ({ ...current, [shot.id]: true }));
            setErrors((current) => ({ ...current, [shot.id]: "" }));
            try {
                await generateShotVideo(project.id, shot.id, effectiveConfig, (progress) => {
                    setProgressMap((prev) => ({ ...prev, [shot.id]: progress }));
                });
            } catch (error) {
                failed += 1;
                setErrors((current) => ({ ...current, [shot.id]: error instanceof Error ? error.message : "视频生成失败，可重试" }));
            } finally {
                setBusyIds((current) => ({ ...current, [shot.id]: false }));
            }
        }
        setBatchRunning(false);
        if (batchCancelRef.current) message.info("已停止批量生成：在途请求自然结束，剩余视频可随时重新发起");
        else message[failed ? "warning" : "success"](failed ? `批量生成完成，${failed} 个分镜失败，可单独重试` : "全部分镜视频生成完成");
    };

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4">
            <Alert
                type={keyframeGateReady && allImagesReady ? "success" : "warning"}
                showIcon
                message={keyframeGateReady ? `代表关键帧已确认 ${approvedIds.length}/${representativeIds.length}` : `代表关键帧待确认 ${approvedIds.length}/${representativeIds.length}`}
                description={allImagesReady ? "全镜首帧已齐，可按镜头逐条生成动态镜头。" : `全镜首帧 ${imageCount}/${project.shots.length}，请先回到“关键帧 / 分镜”补齐；视频生成不会使用缺失首帧的镜头。`}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
                    <span>逐镜使用已确认首帧和动态提示词生成视频；先抽检动作、运镜和人物一致性，再批量补齐。</span>
                    <span className="flex items-center gap-1">
                        画面风格
                        <Tag className="m-0">{resolveArtStyleLabel(artStyle)}</Tag>
                    </span>
                </div>
                <Button type="primary" icon={<Clapperboard className="size-4" />} loading={batchRunning} disabled={!keyframeGateReady || !allImagesReady} onClick={() => void runBatch()}>
                    批量生成动态镜头
                </Button>
                {batchRunning ? <Button danger icon={<Square className="size-4 fill-current" />} onClick={() => { batchCancelRef.current = true; }}>停止</Button> : null}
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
                                        disabled={!shotImage || !keyframeGateReady}
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
