"use client";

import { Film, LoaderCircle, Music2, Send, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Empty, Progress, Tag } from "antd";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";

import { CanvasNodeType, type CanvasNodeData, type InsertAssetPayload } from "@/app/(user)/canvas/types";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { createDramaRender, generateVoiceAudio } from "@/app/(user)/drama/services/drama-generation";
import { getRenderTask, isAuthedRenderOutputUrl, RENDER_POLL_INTERVAL_MS, type RenderTaskResponse } from "@/services/api/render";
import { useRenderOutputUrl } from "@/hooks/use-render-output-url";
import { useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type VoiceKind = "dialogue" | "narration";
type VoiceRow = { shotId: string; shotIndex: number; kind: VoiceKind; text: string };
// 附带镜头索引与音频槽位（0=对白、1=旁白），画布布局按镜头维度计算
type CanvasPayload = InsertAssetPayload & { shotIndex: number; audioSlot: number };

// 对白与旁白各占一条配音：对白沿用 shotId，旁白用 `${shotId}:narration`，shotAudios 天然支持
const voiceAudioKey = (row: Pick<VoiceRow, "shotId" | "kind">) => (row.kind === "dialogue" ? row.shotId : `${row.shotId}:narration`);

export function VoiceStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const router = useRouter();
    const effectiveConfig = useEffectiveConfig();
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

    const voiceRows: VoiceRow[] = project.shots.flatMap((shot, index) => [
        ...(shot.dialogue.trim() ? [{ shotId: shot.id, shotIndex: index, kind: "dialogue" as const, text: shot.dialogue.trim() }] : []),
        ...((shot.narration || "").trim() ? [{ shotId: shot.id, shotIndex: index, kind: "narration" as const, text: (shot.narration || "").trim() }] : []),
    ]);

    const generateRowAudio = async (row: VoiceRow) => {
        await generateVoiceAudio(project.id, voiceAudioKey(row), effectiveConfig);
    };

    const runSingle = async (row: VoiceRow) => {
        const key = voiceAudioKey(row);
        setBusyIds((current) => ({ ...current, [key]: true }));
        setErrors((current) => ({ ...current, [key]: "" }));
        try {
            await generateRowAudio(row);
        } catch (error) {
            setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "配音生成失败，可重试" }));
        } finally {
            setBusyIds((current) => ({ ...current, [key]: false }));
        }
    };

    const runBatch = async () => {
        const pending = voiceRows.filter((row) => !project.shotAudios[voiceAudioKey(row)]);
        if (!pending.length) return message.info("没有待生成的配音（需要有对白或旁白的分镜）");
        setBatchRunning(true);
        let failed = 0;
        for (const row of pending) {
            const key = voiceAudioKey(row);
            setBusyIds((current) => ({ ...current, [key]: true }));
            setErrors((current) => ({ ...current, [key]: "" }));
            try {
                await generateRowAudio(row);
            } catch (error) {
                failed += 1;
                setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "配音生成失败，可重试" }));
            } finally {
                setBusyIds((current) => ({ ...current, [key]: false }));
            }
        }
        setBatchRunning(false);
        message[failed ? "warning" : "success"](failed ? `批量生成完成，${failed} 条失败，可单独重试` : "全部配音生成完成");
    };

    // 组装 InsertAssetPayload：剧本 + 分镜视频 + 分镜配音（对白与旁白），经画布导入通道写入节点
    const buildPayloads = (): CanvasPayload[] => {
        const payloads: CanvasPayload[] = [];
        if (project.script.trim()) payloads.push({ kind: "text", content: project.script.trim(), title: `${project.title} · 剧本`, shotIndex: -1, audioSlot: 0 });
        project.shots.forEach((shot, index) => {
            const video = project.shotVideos[shot.id];
            if (video) payloads.push({ kind: "video", url: video.url, storageKey: video.storageKey, title: `分镜 ${index + 1} 视频`, width: video.width, height: video.height, mimeType: video.mimeType, source: "asset", shotIndex: index, audioSlot: 0 });
            const audio = project.shotAudios[shot.id];
            if (audio) payloads.push({ kind: "audio", url: audio.url, storageKey: audio.storageKey, title: `分镜 ${index + 1} 对白`, bytes: audio.bytes, mimeType: audio.mimeType, durationMs: audio.durationMs, source: "asset", shotIndex: index, audioSlot: 0 });
            const narrationAudio = project.shotAudios[`${shot.id}:narration`];
            if (narrationAudio) payloads.push({ kind: "audio", url: narrationAudio.url, storageKey: narrationAudio.storageKey, title: `分镜 ${index + 1} 旁白`, bytes: narrationAudio.bytes, mimeType: narrationAudio.mimeType, durationMs: narrationAudio.durationMs, source: "asset", shotIndex: index, audioSlot: 1 });
        });
        return payloads;
    };

    const sendToCanvas = () => {
        const payloads = buildPayloads();
        if (!payloads.length) return message.warning("还没有可发送的内容，请先生成分镜视频或配音");
        const canvasStore = useCanvasStore.getState();
        if (!canvasStore.hydrated) return message.info("画布数据正在加载，请稍后再试");
        const nodes = payloads.map((payload) => payloadToNode(payload));
        const canvasProjectId = canvasStore.importProject({ title: `${project.title} · 漫剧成片`, nodes });
        message.success("已发送到画布");
        router.push(`/canvas/view?id=${canvasProjectId}`);
    };

    // 一键成片：时间线组装与任务创建已抽取为 createDramaRender（与 Qoder 通道共用），此处保留校验提示与轮询展示
    const buildFinalVideo = async () => {
        if (!token) return message.warning("请先登录后再使用一键成片");
        if (!project.shots.some((shot) => project.shotVideos[shot.id])) return message.warning("请先生成至少一个分镜视频");
        setRenderSubmitting(true);
        setRenderError("");
        setRenderTask(null);
        try {
            const task = await createDramaRender(project.id);
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

    const narrationCount = project.shots.filter((shot) => (shot.narration || "").trim()).length;
    const renderVideoUrl = renderTask?.url || renderTask?.video_url || "";
    // 本地成片路径需鉴权：带 token 拉成 blob URL 播放/下载，外链直接透传
    const renderOutputUrl = useRenderOutputUrl(token, renderVideoUrl);

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6">
            <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-stone-500 dark:text-stone-400">
                        逐条为对白与旁白生成配音（共 {voiceRows.length} 条，其中旁白 {narrationCount} 条），完成后可发送到画布或一键成片。
                    </div>
                    <Button type="primary" icon={<Music2 className="size-4" />} loading={batchRunning} onClick={() => void runBatch()}>
                        生成全部配音
                    </Button>
                </div>
                {voiceRows.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所有分镜都没有对白与旁白，可回到分镜步骤补充" className="py-10" />
                ) : (
                    <div className="space-y-3">
                        {voiceRows.map((row) => {
                            const key = voiceAudioKey(row);
                            const media = project.shotAudios[key];
                            const busy = busyIds[key];
                            return (
                                <div key={key} className="flex flex-wrap items-center gap-3 border border-stone-200 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                                    <span className="flex size-7 shrink-0 items-center justify-center bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">{row.shotIndex + 1}</span>
                                    <Tag color={row.kind === "narration" ? "purple" : "default"} className="m-0">{row.kind === "narration" ? "旁白" : "对白"}</Tag>
                                    <p className="min-w-40 flex-1 text-sm text-stone-700 dark:text-stone-200">「{row.text}」</p>
                                    {media ? <audio src={media.url} controls className="h-9 max-w-60" /> : null}
                                    {errors[key] ? <p className="w-full text-xs text-red-500">{errors[key]}</p> : null}
                                    <Button size="small" loading={busy} onClick={() => void runSingle(row)}>
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
                                <video src={renderOutputUrl} controls className="max-h-80 w-full bg-black" />
                                {isAuthedRenderOutputUrl(renderVideoUrl) ? (
                                    <a href={renderOutputUrl || undefined} download={`render-${renderTask.id}.mp4`} className="inline-flex items-center gap-1 text-sm text-stone-600 underline dark:text-stone-300">
                                        <Video className="size-4" /> 打开 / 下载成片{renderOutputUrl ? "" : "（加载中…）"}
                                    </a>
                                ) : (
                                    <a href={renderVideoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-stone-600 underline dark:text-stone-300">
                                        <Video className="size-4" /> 打开 / 下载成片
                                    </a>
                                )}
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

// InsertAssetPayload → 画布节点：按镜头维度横向排布，视频在上、音频在下
// 列基准 = shotIndex * 480（与视频节点间距一致）；同一镜头的对白/旁白按 audioSlot * 400 水平错开，避免坐标重叠
function payloadToNode(payload: CanvasPayload): CanvasNodeData {
    const row = payload.kind === "audio" ? 1 : 0;
    const position = { x: payload.shotIndex * 480 + (payload.kind === "audio" ? payload.audioSlot * 400 : 0), y: row * 320 };
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
