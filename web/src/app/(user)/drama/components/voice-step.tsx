"use client";

import { Film, LoaderCircle, Music2, Send, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Empty, Progress } from "antd";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";

import { CanvasNodeType, type CanvasNodeData, type InsertAssetPayload } from "@/app/(user)/canvas/types";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { resolveMediaUrl } from "@/services/file-storage";
import { createRenderTask, getRenderTask, RENDER_POLL_INTERVAL_MS, type RenderTaskResponse, type RenderTimelineSpec } from "@/services/api/render";
import { dramaAudioConfig, useDramaStore, type DramaMedia, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function VoiceStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const router = useRouter();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateProject = useDramaStore((state) => state.updateProject);
    const token = useUserStore((state) => state.token);
    const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [batchRunning, setBatchRunning] = useState(false);
    const [renderTask, setRenderTask] = useState<RenderTaskResponse | null>(null);
    const [renderSubmitting, setRenderSubmitting] = useState(false);
    const [renderError, setRenderError] = useState("");
    const pollingRef = useRef(false);

    useEffect(() => {
        return () => {
            pollingRef.current = false;
        };
    }, []);

    const patchShotAudio = (shotId: string, media: DramaMedia) => {
        const current = useDramaStore.getState().projects.find((item) => item.id === project.id);
        updateProject(project.id, { shotAudios: { ...(current?.shotAudios || {}), [shotId]: media } });
    };

    const generateShotAudio = async (shotId: string) => {
        const current = useDramaStore.getState().projects.find((item) => item.id === project.id);
        const shot = current?.shots.find((item) => item.id === shotId);
        if (!shot?.dialogue.trim()) throw new Error("该分镜没有对白，请先在分镜步骤填写");
        const config = dramaAudioConfig(effectiveConfig);
        if (!isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的音频模型渠道");
        const blob = await requestAudioGeneration(config, shot.dialogue.trim());
        const stored = await storeGeneratedAudio(blob);
        patchShotAudio(shotId, { url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, mimeType: stored.mimeType, durationMs: stored.durationMs });
    };

    const runSingle = async (shotId: string) => {
        setBusyIds((current) => ({ ...current, [shotId]: true }));
        setErrors((current) => ({ ...current, [shotId]: "" }));
        try {
            await generateShotAudio(shotId);
        } catch (error) {
            setErrors((current) => ({ ...current, [shotId]: error instanceof Error ? error.message : "配音生成失败，可重试" }));
        } finally {
            setBusyIds((current) => ({ ...current, [shotId]: false }));
        }
    };

    const runBatch = async () => {
        const pending = project.shots.filter((shot) => shot.dialogue.trim() && !project.shotAudios[shot.id]);
        if (!pending.length) return message.info("没有待生成的配音（需要有对白的分镜）");
        setBatchRunning(true);
        let failed = 0;
        for (const shot of pending) {
            setBusyIds((current) => ({ ...current, [shot.id]: true }));
            setErrors((current) => ({ ...current, [shot.id]: "" }));
            try {
                await generateShotAudio(shot.id);
            } catch (error) {
                failed += 1;
                setErrors((current) => ({ ...current, [shot.id]: error instanceof Error ? error.message : "配音生成失败，可重试" }));
            } finally {
                setBusyIds((current) => ({ ...current, [shot.id]: false }));
            }
        }
        setBatchRunning(false);
        message[failed ? "warning" : "success"](failed ? `批量生成完成，${failed} 个分镜失败，可单独重试` : "全部配音生成完成");
    };

    // 组装 InsertAssetPayload：剧本 + 分镜视频 + 分镜配音，经画布导入通道写入节点
    const buildPayloads = (): InsertAssetPayload[] => {
        const payloads: InsertAssetPayload[] = [];
        if (project.script.trim()) payloads.push({ kind: "text", content: project.script.trim(), title: `${project.title} · 剧本` });
        project.shots.forEach((shot, index) => {
            const video = project.shotVideos[shot.id];
            if (video) payloads.push({ kind: "video", url: video.url, storageKey: video.storageKey, title: `分镜 ${index + 1} 视频`, width: video.width, height: video.height, mimeType: video.mimeType, source: "asset" });
            const audio = project.shotAudios[shot.id];
            if (audio) payloads.push({ kind: "audio", url: audio.url, storageKey: audio.storageKey, title: `分镜 ${index + 1} 配音`, bytes: audio.bytes, mimeType: audio.mimeType, durationMs: audio.durationMs, source: "asset" });
        });
        return payloads;
    };

    const sendToCanvas = () => {
        const payloads = buildPayloads();
        if (!payloads.length) return message.warning("还没有可发送的内容，请先生成分镜视频或配音");
        const canvasStore = useCanvasStore.getState();
        if (!canvasStore.hydrated) return message.info("画布数据正在加载，请稍后再试");
        const nodes = payloads.map((payload, index) => payloadToNode(payload, index));
        const canvasProjectId = canvasStore.importProject({ title: `${project.title} · 漫剧成片`, nodes });
        message.success("已发送到画布");
        router.push(`/canvas/view?id=${canvasProjectId}`);
    };

    const buildFinalVideo = async () => {
        if (!token) return message.warning("请先登录后再使用一键成片");
        const shotsWithVideo = project.shots.filter((shot) => project.shotVideos[shot.id]);
        if (!shotsWithVideo.length) return message.warning("请先生成至少一个分镜视频");
        setRenderSubmitting(true);
        setRenderError("");
        setRenderTask(null);
        try {
            const items: RenderTimelineSpec["items"] = [];
            let width = 1280;
            let height = 720;
            for (const shot of shotsWithVideo) {
                const video = project.shotVideos[shot.id];
                const videoUrl = await resolveMediaUrl(video.storageKey, video.url);
                if (videoUrl.startsWith("blob:")) throw new Error("分镜视频保存在本地浏览器中，请登录并重新生成视频后再一键成片");
                if (video.width && video.height) ({ width, height } = { width: video.width, height: video.height });
                items.push({ kind: "video", source: videoUrl });
                const audio = project.shotAudios[shot.id];
                if (audio) {
                    const audioUrl = await resolveMediaUrl(audio.storageKey, audio.url);
                    if (audioUrl.startsWith("blob:")) throw new Error("分镜配音保存在本地浏览器中，请登录并重新生成配音后再一键成片");
                    items.push({ kind: "audio", source: audioUrl, durationMs: audio.durationMs || Math.max(1000, Math.round((shot.seconds || 5) * 1000)) });
                }
            }
            const timeline: RenderTimelineSpec = { fps: 30, width, height, items };
            const task = await createRenderTask(token, timeline);
            setRenderTask(task);
            pollingRef.current = true;
            while (pollingRef.current && task.status !== "completed" && task.status !== "failed") {
                await new Promise((resolve) => setTimeout(resolve, RENDER_POLL_INTERVAL_MS));
                if (!pollingRef.current) return;
                const latest = await getRenderTask(token, task.id);
                setRenderTask(latest);
                if (latest.status === "completed" || latest.status === "failed") break;
                task.status = latest.status;
            }
        } catch (error) {
            setRenderError(error instanceof Error ? error.message : "一键成片失败，可重试");
        } finally {
            setRenderSubmitting(false);
        }
    };

    const dialogueShots = project.shots.filter((shot) => shot.dialogue.trim());
    const renderVideoUrl = renderTask?.url || renderTask?.video_url || "";

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6">
            <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-stone-500 dark:text-stone-400">逐分镜为对白生成配音，完成后可发送到画布或一键成片。</div>
                    <Button type="primary" icon={<Music2 className="size-4" />} loading={batchRunning} onClick={() => void runBatch()}>
                        生成全部配音
                    </Button>
                </div>
                {dialogueShots.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所有分镜都没有对白，可回到分镜步骤补充" className="py-10" />
                ) : (
                    <div className="space-y-3">
                        {dialogueShots.map((shot) => {
                            const index = project.shots.findIndex((item) => item.id === shot.id);
                            const media = project.shotAudios[shot.id];
                            const busy = busyIds[shot.id];
                            return (
                                <div key={shot.id} className="flex flex-wrap items-center gap-3 border border-stone-200 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                                    <span className="flex size-7 shrink-0 items-center justify-center bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">{index + 1}</span>
                                    <p className="min-w-40 flex-1 text-sm text-stone-700 dark:text-stone-200">「{shot.dialogue}」</p>
                                    {media ? <audio src={media.url} controls className="h-9 max-w-60" /> : null}
                                    {errors[shot.id] ? <p className="w-full text-xs text-red-500">{errors[shot.id]}</p> : null}
                                    <Button size="small" loading={busy} onClick={() => void runSingle(shot.id)}>
                                        {media ? "重新生成" : "生成配音"}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className="border border-stone-200 bg-white/70 p-5 dark:border-stone-800 dark:bg-stone-900/50">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">产出与成片</h3>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    已生成 {Object.keys(project.shotImages).length} 张分镜图、{Object.keys(project.shotVideos).length} 个分镜视频、{Object.keys(project.shotAudios).length} 条配音。
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                    <Button icon={<Send className="size-4" />} onClick={sendToCanvas}>
                        发送到画布
                    </Button>
                    <Button type="primary" icon={<Film className="size-4" />} loading={renderSubmitting} onClick={() => void buildFinalVideo()}>
                        一键成片
                    </Button>
                </div>
                {renderError ? <p className="mt-3 text-sm text-red-500">{renderError}</p> : null}
                {renderTask ? (
                    <div className="mt-4 space-y-3">
                        {renderTask.status === "completed" && renderVideoUrl ? (
                            <>
                                <video src={renderVideoUrl} controls className="max-h-80 w-full bg-black" />
                                <a href={renderVideoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-stone-600 underline dark:text-stone-300">
                                    <Video className="size-4" /> 打开 / 下载成片
                                </a>
                            </>
                        ) : renderTask.status === "failed" ? (
                            <p className="text-sm text-red-500">{renderTask.error?.message || "成片渲染失败，可重试"}</p>
                        ) : (
                            <div className="flex items-center gap-3">
                                <LoaderCircle className="size-4 animate-spin text-stone-400" />
                                <Progress percent={Math.min(99, Math.round(renderTask.progress || 0))} className="max-w-sm flex-1" />
                                <span className="text-xs text-stone-500 dark:text-stone-400">正在合成成片，请勿关闭页面</span>
                            </div>
                        )}
                    </div>
                ) : null}
            </section>
        </div>
    );
}

// InsertAssetPayload → 画布节点：按产出顺序横向排布，视频在上、音频在下
function payloadToNode(payload: InsertAssetPayload, index: number): CanvasNodeData {
    const row = payload.kind === "audio" ? 1 : 0;
    const column = Math.floor(index / 2);
    const position = { x: column * 480, y: row * 320 };
    if (payload.kind === "text") {
        return { id: `text-${nanoid()}`, type: CanvasNodeType.Text, title: payload.title, position: { x: -420, y: 0 }, width: 340, height: 240, metadata: { content: payload.content, status: "success" } };
    }
    if (payload.kind === "image") {
        return { id: `image-${nanoid()}`, type: CanvasNodeType.Image, title: payload.title, position, width: 340, height: 240, metadata: { content: payload.dataUrl, storageKey: payload.storageKey, status: "success", naturalWidth: payload.width, naturalHeight: payload.height, bytes: payload.bytes, mimeType: payload.mimeType } };
    }
    if (payload.kind === "video") {
        return { id: `video-${nanoid()}`, type: CanvasNodeType.Video, title: payload.title, position, width: 420, height: 236, metadata: { content: payload.url, storageKey: payload.storageKey, status: "success", naturalWidth: payload.width, naturalHeight: payload.height, bytes: payload.bytes, mimeType: payload.mimeType || "video/mp4" } };
    }
    return { id: `audio-${nanoid()}`, type: CanvasNodeType.Audio, title: payload.title, position, width: 340, height: 160, metadata: { content: payload.url, storageKey: payload.storageKey, status: "success", bytes: payload.bytes, mimeType: payload.mimeType || "audio/mpeg", durationMs: payload.durationMs } };
}
