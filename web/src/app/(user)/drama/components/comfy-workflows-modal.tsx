"use client";

import { useEffect, useState } from "react";
import { Empty, Modal, Progress, Spin, Tag } from "antd";

import {
    comfyWorkflowModelName,
    fetchComfyQueue,
    fetchComfyWorkflows,
    type ComfyJob,
    type ComfyQueueResponse,
    type ComfyWorkflowItem,
} from "@/services/api/comfy-workflows";

import { startComfyStatusPolling, stopComfyStatusPolling } from "../services/comfy-status";

const KIND_LABEL: Record<string, string> = {
    txt2img: "文生图",
    img2img: "图生图",
    img2video: "图生视频",
    txt2video: "文生视频",
};

// 队列轮询间隔（与画布算力状态轮询器一致）
const QUEUE_POLL_MS = 5000;

// 任务展示名：工作流名（去 .json）优先，其次类型，最后兑底任务 ID
const jobDisplayName = (job: ComfyJob): string => (job.workflow ? comfyWorkflowModelName(job.workflow) : "") || (job.kind ? KIND_LABEL[job.kind] || job.kind : "") || job.job_id;

// 任务进度：优先 progress_percent，其次 progress.value/max 折算，均无则返回 undefined（仅展示状态）
function jobPercent(job: ComfyJob): number | undefined {
    if (typeof job.progress_percent === "number") return Math.min(100, Math.max(0, Math.floor(job.progress_percent)));
    const value = job.progress?.value;
    const max = job.progress?.max;
    if (typeof value === "number" && typeof max === "number" && max > 0) return Math.min(100, Math.max(0, Math.floor((value / max) * 100)));
    return undefined;
}

const jobFinishedAt = (job: ComfyJob): number => new Date(job.finished_at_utc || job.created_at_utc || 0).getTime() || 0;

// 展示算力服务器上可用的 ComfyUI 工作流，并标注当前生产线出图 / 视频各用哪一个
export function ComfyWorkflowsModal({
    open,
    onClose,
    imageModel,
    videoModel,
}: {
    open: boolean;
    onClose: () => void;
    imageModel: string;
    videoModel: string;
}) {
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState<ComfyWorkflowItem[]>([]);
    const [error, setError] = useState("");
    const [queue, setQueue] = useState<ComfyQueueResponse | null>(null);
    const [queueFailed, setQueueFailed] = useState(false);

    const probeModel = imageModel || videoModel;

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setError("");
        fetchComfyWorkflows(probeModel)
            .then((result) => setItems(result.items || []))
            .catch((err) => setError(err instanceof Error ? err.message : "读取算力工作流失败"))
            .finally(() => setLoading(false));
    }, [open, probeModel]);

    // 打开期间 5s 轮询队列快照；失败静默（区块显示「暂无任务信息」），关闭即停。
    // 同时把当前模型登记进画布算力状态轮询器，弹窗打开期间画布节点也保持刷新。
    useEffect(() => {
        if (!open || !probeModel) return;
        startComfyStatusPolling(probeModel, "modal");
        let cancelled = false;
        const loadQueue = () => {
            fetchComfyQueue(probeModel)
                .then((result) => {
                    if (cancelled) return;
                    setQueue(result);
                    setQueueFailed(false);
                })
                .catch(() => {
                    if (!cancelled) setQueueFailed(true);
                });
        };
        loadQueue();
        const interval = setInterval(loadQueue, QUEUE_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
            stopComfyStatusPolling("modal");
        };
    }, [open, probeModel]);

    const queueItems = queue?.items || [];
    const runningJobs = queueItems.filter((job) => job.status === "queued" || job.status === "running");
    const recentCompleted = queueItems.filter((job) => job.status === "completed").sort((a, b) => jobFinishedAt(b) - jobFinishedAt(a)).slice(0, 3);
    const recentFailed = queueItems.filter((job) => job.status === "failed").sort((a, b) => jobFinishedAt(b) - jobFinishedAt(a)).slice(0, 2);
    const queueEmpty = !queueFailed && runningJobs.length === 0 && recentCompleted.length === 0 && recentFailed.length === 0;

    const usedLabel = (name: string): string => {
        const base = comfyWorkflowModelName(name);
        if (imageModel && base === imageModel) return "当前出图 / 改图";
        if (videoModel && base === videoModel) return "当前图生视频";
        return "";
    };

    return (
        <Modal title="算力服务器 · ComfyUI 工作流" open={open} footer={null} onCancel={onClose} width={560} destroyOnClose>
            {loading ? (
                <div className="flex justify-center py-12">
                    <Spin />
                </div>
            ) : error ? (
                <p className="py-8 text-center text-sm text-red-500">{error}</p>
            ) : items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="服务器上没有可用的 ComfyUI 工作流" className="py-8" />
            ) : (
                <div className="space-y-2">
                    {items.map((item) => {
                        const base = comfyWorkflowModelName(item.name);
                        const used = usedLabel(item.name);
                        return (
                            <div key={item.name} className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{base}</p>
                                    <p className="text-xs text-stone-500 dark:text-stone-400">{KIND_LABEL[item.kind] || item.kind}</p>
                                    {item.load_error ? <p className="truncate text-xs text-red-500">{item.load_error}</p> : null}
                                </div>
                                {used ? <Tag color="blue">{used}</Tag> : null}
                                <Tag color={item.available ? "green" : "red"}>{item.available ? "可用" : "不可用"}</Tag>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
                <p className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">运行中任务（每 5 秒自动刷新）</p>
                {queueFailed || queueEmpty ? (
                    <p className="py-1 text-xs text-stone-400 dark:text-stone-500">暂无任务信息</p>
                ) : (
                    <div className="space-y-2">
                        {runningJobs.map((job) => {
                            const percent = jobPercent(job);
                            return (
                                <div key={job.job_id} className="rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/30">
                                    <div className="flex items-center gap-2">
                                        <p className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-100">{jobDisplayName(job)}</p>
                                        <Tag color={job.status === "queued" ? "default" : "processing"}>{job.status === "queued" ? "排队中" : "运行中"}</Tag>
                                    </div>
                                    {percent !== undefined ? <Progress percent={percent} size="small" className="mt-1" /> : null}
                                    {job.current_node ? <p className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">当前节点：{job.current_node}</p> : null}
                                </div>
                            );
                        })}
                        {recentCompleted.map((job) => (
                            <div key={job.job_id} className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-1.5 dark:border-stone-800">
                                <p className="min-w-0 flex-1 truncate text-xs text-stone-600 dark:text-stone-300">{jobDisplayName(job)}</p>
                                <Tag color="success">已完成</Tag>
                            </div>
                        ))}
                        {recentFailed.map((job) => (
                            <div key={job.job_id} className="rounded-md border border-stone-200 px-3 py-1.5 dark:border-stone-800">
                                <div className="flex items-center gap-2">
                                    <p className="min-w-0 flex-1 truncate text-xs text-stone-600 dark:text-stone-300">{jobDisplayName(job)}</p>
                                    <Tag color="error">失败</Tag>
                                </div>
                                {job.error ? <p className="mt-0.5 truncate text-xs text-red-500">{job.error}</p> : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}
