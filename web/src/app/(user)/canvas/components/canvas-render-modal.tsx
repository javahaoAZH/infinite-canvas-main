import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { App, Button, Checkbox, Input, InputNumber, Modal, Progress, Radio, Select, Switch } from "antd";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clapperboard, Download, FileVideo, Film, GripVertical, Image as ImageIcon, LoaderCircle, Music2, RotateCcw, Sparkles, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { CanvasNodeType } from "../types";
import {
    createRenderTask,
    deleteRenderTask,
    exportJianyingDraft,
    getRenderFFmpegStatus,
    getRenderTask,
    listRenderTasks,
    RENDER_POLL_INTERVAL_MS,
    type RenderFFmpegStatus,
    type RenderTaskResponse,
    type RenderTimelineSpec,
} from "@/services/api/render";
import { buildSrtFromDialogue, createSubtitleAbortSignal, splitDialogueWithAI } from "@/services/api/subtitle";

type RenderModalItem = {
    key: string;
    kind: "video" | "image" | "audio";
    title: string;
    source: string;
    selected: boolean;
    seconds: number;
    preview?: string;
    localOnly: boolean;
};

type SubtitleEntryRow = {
    key: string;
    text: string;
    startSec: number;
    endSec: number;
};

const RENDER_SIZE_OPTIONS = [
    { value: "1280x720", label: "横屏 1280×720" },
    { value: "720x1280", label: "竖屏 720×1280" },
    { value: "1920x1080", label: "高清横屏 1920×1080" },
    { value: "1080x1920", label: "高清竖屏 1080×1920" },
];

// 支持「开始秒-结束秒 文本」格式行，其余视为纯文本行。
const DIALOGUE_TIMED_LINE = /^\s*(\d+(?:\.\d+)?)\s*[-~—]\s*(\d+(?:\.\d+)?)\s*[:：]?\s*(.+)$/;

function renderStatusLabel(status?: string) {
    switch (status) {
        case "queued":
            return "排队中…";
        case "preparing":
            return "正在下载并准备素材…";
        case "rendering":
            return "渲染中…";
        case "completed":
            return "成片已完成";
        case "failed":
            return "成片失败";
        default:
            return "处理中…";
    }
}

function isActiveRenderStatus(status?: string) {
    return status === "queued" || status === "preparing" || status === "rendering";
}

// 前端解析剧本对白：带时间行直接采用，纯文本行按视频总时长均分时间段。
function parseDialogueLines(raw: string, totalSeconds: number): SubtitleEntryRow[] {
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) throw new Error("请先粘贴剧本对白");
    const timed: Array<Omit<SubtitleEntryRow, "key">> = [];
    const plain: string[] = [];
    lines.forEach((line, index) => {
        const match = line.match(DIALOGUE_TIMED_LINE);
        if (!match) {
            plain.push(line);
            return;
        }
        const startSec = Number(match[1]);
        const endSec = Number(match[2]);
        if (!(endSec > startSec)) throw new Error(`第 ${index + 1} 行的结束时间必须晚于开始时间`);
        timed.push({ text: match[3].trim(), startSec, endSec });
    });
    if (plain.length > 0) {
        if (totalSeconds <= 0) throw new Error("纯文本对白需要先填写总时长，才能均分时间段");
        const segment = totalSeconds / plain.length;
        plain.forEach((text, index) => {
            timed.push({ text, startSec: round1(index * segment), endSec: round1((index + 1) * segment) });
        });
    }
    timed.sort((a, b) => a.startSec - b.startSec);
    return timed
        .filter((entry) => entry.text)
        .map((entry, index) => ({ key: `d-${index}`, ...entry }));
}

function round1(value: number) {
    return Math.round(value * 10) / 10;
}

export function CanvasRenderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const projectId = useSearchParams().get("id") ?? "";
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isAdmin = user?.role === "admin";
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const projects = useCanvasStore((state) => state.projects);
    const project = projects.find((item) => item.id === projectId);

    const [ffmpegStatus, setFFmpegStatus] = useState<RenderFFmpegStatus | null>(null);
    const [items, setItems] = useState<RenderModalItem[]>([]);
    const [sizeValue, setSizeValue] = useState("1280x720");
    const [fps, setFps] = useState(30);
    const [subtitles, setSubtitles] = useState(false);
    const [burnSubtitle, setBurnSubtitle] = useState(true);
    const [subtitleMode, setSubtitleMode] = useState<"manual" | "ai">("manual");
    const [dialogueText, setDialogueText] = useState("");
    const [subtitleEntries, setSubtitleEntries] = useState<SubtitleEntryRow[]>([]);
    const [subtitleTotalSeconds, setSubtitleTotalSeconds] = useState(0);
    const [srt, setSrt] = useState("");
    const [subtitleNotice, setSubtitleNotice] = useState("");
    const [subtitleNoticeOk, setSubtitleNoticeOk] = useState(true);
    const [aiSplitting, setAiSplitting] = useState(false);
    const [srtLoading, setSrtLoading] = useState(false);
    const [submittedSrt, setSubmittedSrt] = useState("");
    const [submittedBurn, setSubmittedBurn] = useState(false);
    const [task, setTask] = useState<RenderTaskResponse | null>(null);
    const [recentTasks, setRecentTasks] = useState<RenderTaskResponse[]>([]);
    const [deletingTaskId, setDeletingTaskId] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [exporting, setExporting] = useState(false);
    const dragIndexRef = useRef<number | null>(null);

    const [width, height] = useMemo(() => sizeValue.split("x").map(Number), [sizeValue]);

    const collectItems = useCallback(() => {
        const nodes = project?.nodes ?? [];
        return nodes
            .filter((node) => node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio || node.type === CanvasNodeType.Image)
            .map((node): RenderModalItem => {
                const kind = node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image";
                const storageKey = node.metadata?.storageKey || "";
                const content = node.metadata?.content || "";
                const source = storageKey.startsWith("server:") ? storageKey : /^https?:\/\//.test(content) ? content : "";
                const audioSeconds = node.metadata?.durationMs ? Math.max(1, Math.round(node.metadata.durationMs / 1000)) : 5;
                return {
                    key: node.id,
                    kind,
                    title: node.title || (kind === "video" ? "视频" : kind === "audio" ? "配音" : "图片"),
                    source,
                    selected: Boolean(source),
                    seconds: kind === "audio" ? audioSeconds : 5,
                    preview: kind === "image" && content.startsWith("data:image") ? content : undefined,
                    localOnly: !source,
                };
            });
    }, [project]);

    // 打开弹窗时探测 FFmpeg、收集画布素材，并恢复最近任务（进行中任务自动续轮询）。
    useEffect(() => {
        if (!open) return;
        setTask(null);
        setSubmitError("");
        setSubmitting(false);
        setItems(collectItems());
        setSubtitles(false);
        setBurnSubtitle(true);
        setSubtitleEntries([]);
        setDialogueText("");
        setSrt("");
        setSubtitleNotice("");
        setSubmittedSrt("");
        setSubmittedBurn(false);
        if (!token) return;
        let cancelled = false;
        getRenderFFmpegStatus(token)
            .then((status) => {
                if (!cancelled) setFFmpegStatus(status);
            })
            .catch(() => {
                if (!cancelled) setFFmpegStatus(null);
            });
        listRenderTasks(token)
            .then((tasks) => {
                if (cancelled) return;
                setRecentTasks(tasks);
                const active = tasks.find((item) => isActiveRenderStatus(item.status));
                if (active) setTask(active);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open, collectItems, token]);

    // 任务进行中时轮询进度。
    useEffect(() => {
        if (!open || !token || !task || !isActiveRenderStatus(task.status)) return;
        const timer = setInterval(() => {
            getRenderTask(token, task.id)
                .then(setTask)
                .catch(() => undefined);
        }, RENDER_POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [open, token, task]);

    // 当前任务到达终态后刷新最近任务列表。
    useEffect(() => {
        if (!open || !token || !task || isActiveRenderStatus(task.status)) return;
        listRenderTasks(token)
            .then(setRecentTasks)
            .catch(() => undefined);
    }, [open, token, task]);

    const handleDeleteTask = async (id: string) => {
        if (!token) return;
        setDeletingTaskId(id);
        try {
            await deleteRenderTask(token, id);
            if (task?.id === id) setTask(null);
            const tasks = await listRenderTasks(token);
            setRecentTasks(tasks);
            message.success("任务已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除任务失败");
        } finally {
            setDeletingTaskId("");
        }
    };

    const selectedItems = items.filter((item) => item.selected && !item.localOnly);
    const totalSeconds = selectedItems.reduce((total, item) => total + (item.kind === "video" ? 0 : item.seconds), 0);
    const ffmpegUnavailable = ffmpegStatus !== null && !ffmpegStatus.available;
    const busy = submitting || (task ? isActiveRenderStatus(task.status) : false);

    const moveItem = (from: number, to: number) => {
        if (from === to || from < 0 || to < 0) return;
        setItems((current) => {
            if (to >= current.length) return current;
            const next = [...current];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    };

    const notifySubtitle = (message: string, ok = false) => {
        setSubtitleNotice(message);
        setSubtitleNoticeOk(ok);
    };

    // 条目变化后清空已生成的 SRT，避免烧录到过期内容。
    const updateSubtitleEntries = (next: SubtitleEntryRow[]) => {
        setSubtitleEntries(next);
        setSrt("");
    };

    const toggleSubtitles = (checked: boolean) => {
        setSubtitles(checked);
        setSubtitleNotice("");
        if (checked && subtitleTotalSeconds <= 0) setSubtitleTotalSeconds(totalSeconds);
    };

    const handleParseDialogue = () => {
        try {
            const parsed = parseDialogueLines(dialogueText, subtitleTotalSeconds);
            updateSubtitleEntries(parsed);
            notifySubtitle(`已解析出 ${parsed.length} 条字幕，可继续手动调整`, true);
        } catch (error) {
            notifySubtitle(error instanceof Error ? error.message : "对白解析失败");
        }
    };

    const handleAISplit = async () => {
        if (!dialogueText.trim()) return notifySubtitle("请先粘贴剧本对白");
        if (subtitleTotalSeconds <= 0) return notifySubtitle("请先填写视频总时长，供 AI 估算时间轴");
        const textModel = effectiveConfig.textModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, textModel)) return notifySubtitle("请先在设置中配置可用的文本模型渠道");
        setAiSplitting(true);
        setSubtitleNotice("");
        const controller = createSubtitleAbortSignal();
        try {
            const entries = await splitDialogueWithAI(effectiveConfig, dialogueText, subtitleTotalSeconds, controller.signal);
            updateSubtitleEntries(entries.map((entry, index) => ({ key: `ai-${index}`, text: entry.text, startSec: entry.startMs / 1000, endSec: entry.endMs / 1000 })));
            notifySubtitle(`AI 切分出 ${entries.length} 条字幕，可继续手动调整`, true);
        } catch (error) {
            const aborted = error instanceof DOMException && error.name === "AbortError";
            const reason = aborted ? "AI 切分超时" : error instanceof Error ? error.message : "AI 切分失败";
            notifySubtitle(`${reason}，可重试，或改用「从对白文本生成」手动编辑`);
        } finally {
            setAiSplitting(false);
        }
    };

    const handleGenerateSrt = async () => {
        if (!token) return;
        if (subtitleEntries.length === 0) return notifySubtitle("请先解析或编辑字幕条目");
        for (let index = 0; index < subtitleEntries.length; index++) {
            const entry = subtitleEntries[index];
            if (!entry.text.trim()) return notifySubtitle(`第 ${index + 1} 条字幕文本不能为空`);
            if (!(entry.endSec > entry.startSec)) return notifySubtitle(`第 ${index + 1} 条字幕的结束时间必须晚于开始时间`);
        }
        setSrtLoading(true);
        setSubtitleNotice("");
        try {
            const result = await buildSrtFromDialogue(
                token,
                subtitleEntries.map((entry) => ({
                    text: entry.text.trim(),
                    startMs: Math.round(entry.startSec * 1000),
                    endMs: Math.round(entry.endSec * 1000),
                })),
            );
            setSrt(result.srt);
            notifySubtitle(`SRT 已生成（${subtitleEntries.length} 条）`, true);
        } catch (error) {
            notifySubtitle(error instanceof Error ? error.message : "SRT 生成失败，请稍后重试");
        } finally {
            setSrtLoading(false);
        }
    };

    // 不烧录时，成片完成后前端直接用已有 SRT 生成文件下载。
    const downloadSrtFile = () => {
        const blob = new Blob(["\uFEFF" + submittedSrt], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "subtitle.srt";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // 与提交渲染一致的时间线构造逻辑，供成片与剪映工程导出复用。
    const buildTimeline = (srtText: string, burn: boolean): RenderTimelineSpec => ({
        fps,
        width,
        height,
        srt: srtText,
        burnSubtitle: burn,
        items: selectedItems.map((item) => ({
            kind: item.kind,
            source: item.source,
            durationMs: item.kind === "video" ? undefined : Math.max(1, Math.round(item.seconds * 1000)),
        })),
    });

    const handleSubmit = async () => {
        if (!token || selectedItems.length === 0) return;
        const wantBurn = subtitles && burnSubtitle;
        if (wantBurn && !srt) {
            setSubmitError("已勾选烧录字幕，请先点「生成 SRT」");
            return;
        }
        setSubmitting(true);
        setSubmitError("");
        try {
            setSubmittedSrt(subtitles ? srt : "");
            setSubmittedBurn(wantBurn);
            setTask(await createRenderTask(token, buildTimeline(wantBurn ? srt : "", wantBurn)));
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "提交失败，请稍后重试");
        } finally {
            setSubmitting(false);
        }
    };

    // 导出剪映工程：不依赖 FFmpeg，字幕以文本轨段落导出（不烧录）。
    const handleExportJianying = async () => {
        if (!token || selectedItems.length === 0) return;
        if (subtitles && !srt) {
            message.error("已勾选生成字幕，请先点「生成 SRT」再导出");
            return;
        }
        setExporting(true);
        try {
            const blob = await exportJianyingDraft(token, buildTimeline(subtitles ? srt : "", false));
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `jianying-draft-${Date.now()}.zip`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            message.success("剪映工程已导出");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "剪映工程导出失败，请稍后重试");
        } finally {
            setExporting(false);
        }
    };

    const panelStyle = { background: theme.node.panel, color: theme.node.text };
    const rowStyle = { background: theme.node.fill, borderColor: theme.node.stroke };

    return (
        <Modal
            open={open}
            title={null}
            footer={null}
            width={560}
            onCancel={onClose}
            destroyOnHidden
            styles={{ root: { ...panelStyle, border: `1px solid ${theme.node.stroke}`, padding: 0, overflow: "hidden" }, mask: { background: "rgba(0,0,0,.45)" } }}
        >
            <div className="flex items-center justify-between gap-2 border-b px-5 py-4" style={{ borderColor: theme.node.stroke }}>
                <div className="flex items-center gap-2.5">
                    <Clapperboard className="size-4.5" style={{ color: theme.node.text }} />
                    <span className="text-base font-semibold">一键成片</span>
                </div>
                <span className="flex items-center gap-1 text-xs" style={{ color: theme.node.faint }}>
                    {ffmpegStatus?.available ? (
                        <>
                            <Check className="size-3" />
                            FFmpeg 已就绪{ffmpegStatus.version ? ` · ${ffmpegStatus.version}` : ""}
                        </>
                    ) : (
                        "按顺序拼接画布上的视频、配音与图片"
                    )}
                </span>
            </div>

            <div className="max-h-[62vh] overflow-y-auto px-5 py-4 thin-scrollbar">
                {!token ? (
                    <RenderNotice text="请先登录后再使用一键成片" theme={theme} />
                ) : ffmpegUnavailable ? (
                    <div className="flex flex-col gap-2 rounded-lg border p-3.5 text-sm" style={{ borderColor: "#d97706", background: colorTheme === "dark" ? "rgba(217,119,6,.12)" : "rgba(217,119,6,.08)" }}>
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: "#d97706" }} />
                            <div className="flex flex-col gap-1.5">
                                <span className="font-medium">未检测到可用的 FFmpeg，无法成片</span>
                                <span className="text-xs leading-5 opacity-75">{ffmpegStatus?.reason}</span>
                                <span className="text-xs leading-5 opacity-75">
                                    {isAdmin ? "请前往全局设置配置 FFmpeg 可执行文件路径，或先下载：" : "请联系管理员配置服务端 FFmpeg，或先下载："}
                                    <a href={ffmpegStatus?.downloadUrl} target="_blank" rel="noreferrer" className="ml-1 underline" style={{ color: theme.node.text }}>
                                        {ffmpegStatus?.downloadUrl}
                                    </a>
                                </span>
                            </div>
                        </div>
                    </div>
                ) : task ? (
                    <div className="flex flex-col gap-4 py-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            {busy ? <LoaderCircle className="size-4 animate-spin" style={{ color: theme.node.muted }} /> : task.status === "completed" ? <Film className="size-4" /> : <AlertTriangle className="size-4" style={{ color: "#dc2626" }} />}
                            {renderStatusLabel(task.status)}
                        </div>
                        <Progress
                            percent={Math.max(task.progress ?? 0, task.status === "completed" ? 100 : 0)}
                            status={task.status === "failed" ? "exception" : task.status === "completed" ? "success" : "active"}
                            strokeColor={theme.node.activeStroke}
                            trailColor={theme.node.fill}
                        />
                        {task.status === "completed" && task.url ? (
                            <div className="flex flex-col gap-3">
                                <video src={task.url} controls className="w-full rounded-lg border bg-black" style={{ borderColor: theme.node.stroke, maxHeight: 300 }} />
                                <div className="flex items-center gap-2 text-xs" style={{ color: theme.node.faint }}>
                                    {task.seconds ? <span>时长 {task.seconds} 秒</span> : null}
                                    {task.size ? <span>分辨率 {task.size}</span> : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button icon={<Download className="size-4" />} href={task.url} target="_blank">
                                        下载成片
                                    </Button>
                                    {submittedSrt && !submittedBurn ? (
                                        <Button icon={<Download className="size-4" />} onClick={downloadSrtFile}>
                                            下载 SRT
                                        </Button>
                                    ) : null}
                                    <Button icon={<RotateCcw className="size-4" />} onClick={() => setTask(null)}>
                                        再来一次
                                    </Button>
                                </div>
                            </div>
                        ) : null}
                        {task.status === "failed" ? (
                            <div className="flex flex-col gap-2">
                                <RenderNotice text={task.error?.message || "成片失败，请稍后重试"} theme={theme} />
                                <Button icon={<RotateCcw className="size-4" />} onClick={() => setTask(null)} className="self-start">
                                    返回编辑
                                </Button>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <>
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2 text-xs font-medium opacity-70">
                                输出尺寸
                                <Select size="small" value={sizeValue} onChange={setSizeValue} options={RENDER_SIZE_OPTIONS} popupMatchSelectWidth={false} />
                            </div>
                            <div className="flex items-center gap-2 text-xs font-medium opacity-70">
                                帧率
                                <Select
                                    size="small"
                                    value={fps}
                                    onChange={setFps}
                                    options={[
                                        { value: 24, label: "24 fps" },
                                        { value: 30, label: "30 fps" },
                                    ]}
                                    popupMatchSelectWidth={false}
                                />
                            </div>
                            <div className="ml-auto flex items-center gap-2 text-xs font-medium opacity-70">
                                生成字幕
                                <Switch size="small" checked={subtitles} onChange={toggleSubtitles} />
                            </div>
                        </div>
                        {subtitles ? (
                            <div className="mb-3 flex flex-col gap-2.5 rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                                <div className="flex flex-wrap items-center gap-3">
                                    <Radio.Group
                                        size="small"
                                        optionType="button"
                                        value={subtitleMode}
                                        onChange={(event) => setSubtitleMode(event.target.value)}
                                        options={[
                                            { value: "manual", label: "从对白文本生成" },
                                            { value: "ai", label: "AI 切分" },
                                        ]}
                                    />
                                    <div className="ml-auto flex items-center gap-1.5 text-xs opacity-70">
                                        总时长
                                        <InputNumber
                                            size="small"
                                            min={1}
                                            max={3600}
                                            value={subtitleTotalSeconds || undefined}
                                            onChange={(value) => setSubtitleTotalSeconds(Number(value) || 0)}
                                            className="!w-16"
                                        />
                                        秒
                                    </div>
                                </div>
                                <Input.TextArea
                                    rows={4}
                                    value={dialogueText}
                                    onChange={(event) => setDialogueText(event.target.value)}
                                    placeholder={"粘贴剧本对白，每行一条。\n可选格式：3.5-6 你好，世界；纯文本行将按总时长均分时间段。"}
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                    {subtitleMode === "manual" ? (
                                        <Button size="small" onClick={handleParseDialogue}>
                                            解析对白
                                        </Button>
                                    ) : (
                                        <Button size="small" loading={aiSplitting} icon={<Sparkles className="size-3.5" />} onClick={() => void handleAISplit()}>
                                            AI 切分
                                        </Button>
                                    )}
                                    <span className="text-[11px] opacity-60">
                                        {subtitleMode === "manual" ? "支持「开始秒-结束秒 文本」与纯文本行" : "调用当前文本渠道估算时间轴，结果可手动调整"}
                                    </span>
                                </div>
                                {subtitleEntries.length > 0 ? (
                                    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto thin-scrollbar">
                                        {subtitleEntries.map((entry, index) => (
                                            <div key={entry.key} className="flex items-center gap-1.5">
                                                <span className="w-5 shrink-0 text-right text-[11px] opacity-50">{index + 1}</span>
                                                <InputNumber
                                                    size="small"
                                                    min={0}
                                                    max={3600}
                                                    step={0.1}
                                                    precision={1}
                                                    value={entry.startSec}
                                                    onChange={(value) =>
                                                        updateSubtitleEntries(subtitleEntries.map((item) => (item.key === entry.key ? { ...item, startSec: Number(value) || 0 } : item)))
                                                    }
                                                    className="!w-16"
                                                />
                                                <span className="text-xs opacity-50">–</span>
                                                <InputNumber
                                                    size="small"
                                                    min={0}
                                                    max={3600}
                                                    step={0.1}
                                                    precision={1}
                                                    value={entry.endSec}
                                                    onChange={(value) =>
                                                        updateSubtitleEntries(subtitleEntries.map((item) => (item.key === entry.key ? { ...item, endSec: Number(value) || 0 } : item)))
                                                    }
                                                    className="!w-16"
                                                />
                                                <span className="text-xs opacity-50">秒</span>
                                                <Input
                                                    size="small"
                                                    value={entry.text}
                                                    onChange={(event) =>
                                                        updateSubtitleEntries(subtitleEntries.map((item) => (item.key === entry.key ? { ...item, text: event.target.value } : item)))
                                                    }
                                                    className="flex-1"
                                                />
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    className="!h-6 !w-6 !min-w-6 !p-0"
                                                    onClick={() => updateSubtitleEntries(subtitleEntries.filter((item) => item.key !== entry.key))}
                                                >
                                                    <X className="size-3.5" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                <div className="flex flex-wrap items-center gap-3">
                                    <Button
                                        size="small"
                                        type="primary"
                                        ghost={subtitleEntries.length === 0}
                                        loading={srtLoading}
                                        disabled={subtitleEntries.length === 0}
                                        onClick={() => void handleGenerateSrt()}
                                    >
                                        生成 SRT
                                    </Button>
                                    <Checkbox checked={burnSubtitle} onChange={(event) => setBurnSubtitle(event.target.checked)}>
                                        烧录进视频
                                    </Checkbox>
                                    {srt && !burnSubtitle ? <span className="text-[11px] opacity-60">不烧录时，成片完成后可下载外挂 SRT</span> : null}
                                </div>
                                {subtitleNotice ? (
                                    <div className="text-[11px]" style={{ color: subtitleNoticeOk ? theme.node.muted : "#dc2626" }}>
                                        {subtitleNotice}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {items.length === 0 ? (
                            <RenderNotice text="当前画布没有视频、配音或图片素材，请先在画布中生成或上传素材" theme={theme} />
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                {items.map((item, index) => (
                                    <div
                                        key={item.key}
                                        draggable={!item.localOnly}
                                        onDragStart={() => (dragIndexRef.current = index)}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={() => {
                                            if (dragIndexRef.current !== null) moveItem(dragIndexRef.current, index);
                                            dragIndexRef.current = null;
                                        }}
                                        className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
                                        style={{ ...rowStyle, opacity: item.localOnly ? 0.55 : 1 }}
                                    >
                                        <GripVertical className="size-4 shrink-0 cursor-grab opacity-50" />
                                        <Checkbox
                                            disabled={item.localOnly}
                                            checked={item.selected && !item.localOnly}
                                            onChange={(event) =>
                                                setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, selected: event.target.checked } : entry)))
                                            }
                                        />
                                        {item.preview ? (
                                            <img src={item.preview} alt={item.title} className="size-8 shrink-0 rounded object-cover" />
                                        ) : item.kind === "video" ? (
                                            <Film className="size-4.5 shrink-0 opacity-70" />
                                        ) : item.kind === "audio" ? (
                                            <Music2 className="size-4.5 shrink-0 opacity-70" />
                                        ) : (
                                            <ImageIcon className="size-4.5 shrink-0 opacity-70" />
                                        )}
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-sm">{item.title}</span>
                                            {item.localOnly ? <span className="text-[11px]" style={{ color: theme.node.faint }}>仅保存在本地，请先上传到云端后参与成片</span> : null}
                                        </div>
                                        {item.kind !== "video" && !item.localOnly ? (
                                            <div className="flex shrink-0 items-center gap-1 text-xs opacity-75">
                                                <InputNumber
                                                    size="small"
                                                    min={1}
                                                    max={3600}
                                                    value={item.seconds}
                                                    onChange={(value) =>
                                                        setItems((current) =>
                                                            current.map((entry) => (entry.key === item.key ? { ...entry, seconds: Number(value) || 5 } : entry)),
                                                        )
                                                    }
                                                    className="!w-16"
                                                />
                                                秒
                                            </div>
                                        ) : null}
                                        <div className="flex shrink-0 flex-col">
                                            <Button type="text" size="small" disabled={index === 0} className="!h-5 !w-5 !min-w-5 !p-0" onClick={() => moveItem(index, index - 1)}>
                                                <ArrowUp className="size-3.5" />
                                            </Button>
                                            <Button type="text" size="small" disabled={index === items.length - 1} className="!h-5 !w-5 !min-w-5 !p-0" onClick={() => moveItem(index, index + 1)}>
                                                <ArrowDown className="size-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {recentTasks.length > 0 ? (
                            <div className="mt-4 flex flex-col gap-1.5 rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                                <div className="text-xs font-medium opacity-70">最近任务</div>
                                {recentTasks.slice(0, 5).map((recent) => (
                                    <div key={recent.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                                        {isActiveRenderStatus(recent.status) ? (
                                            <LoaderCircle className="size-3.5 shrink-0 animate-spin" style={{ color: theme.node.muted }} />
                                        ) : recent.status === "completed" ? (
                                            <Film className="size-3.5 shrink-0 opacity-70" />
                                        ) : (
                                            <AlertTriangle className="size-3.5 shrink-0" style={{ color: "#dc2626" }} />
                                        )}
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-xs">
                                                {renderStatusLabel(recent.status)}
                                                {recent.seconds ? ` · ${recent.seconds} 秒` : ""}
                                            </span>
                                            {recent.status === "failed" && recent.error?.message ? (
                                                <span className="truncate text-[11px] opacity-60">{recent.error.message}</span>
                                            ) : null}
                                        </div>
                                        {isActiveRenderStatus(recent.status) ? (
                                            <Button size="small" type="text" onClick={() => setTask(recent)}>
                                                查看
                                            </Button>
                                        ) : recent.status === "completed" && recent.url ? (
                                            <Button size="small" type="text" href={recent.url} target="_blank" icon={<Download className="size-3.5" />}>
                                                预览/下载
                                            </Button>
                                        ) : null}
                                        <Button
                                            type="text"
                                            size="small"
                                            className="!h-6 !w-6 !min-w-6 !p-0"
                                            loading={deletingTaskId === recent.id}
                                            disabled={deletingTaskId !== "" && deletingTaskId !== recent.id}
                                            onClick={() => void handleDeleteTask(recent.id)}
                                        >
                                            <X className="size-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </>
                )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-5 py-3.5" style={{ borderColor: theme.node.stroke }}>
                <span className="text-xs" style={{ color: theme.node.faint }}>
                    {task && isActiveRenderStatus(task.status) ? "渲染在服务端进行，可关闭弹窗稍后查看" : !task ? `已选 ${selectedItems.length} 段${totalSeconds > 0 ? `，图片/配音约 ${totalSeconds} 秒` : ""}` : ""}
                </span>
                <div className="flex items-center gap-2">
                    <Button onClick={onClose}>{busy ? "关闭" : "取消"}</Button>
                    {!task ? (
                        <Button
                            icon={<FileVideo className="size-4" />}
                            loading={exporting}
                            disabled={!token || selectedItems.length === 0}
                            onClick={() => void handleExportJianying()}
                        >
                            导出剪映工程
                        </Button>
                    ) : null}
                    {!task ? (
                        <Button
                            type="primary"
                            loading={submitting}
                            disabled={!token || ffmpegUnavailable || selectedItems.length === 0}
                            onClick={() => void handleSubmit()}
                        >
                            开始成片
                        </Button>
                    ) : null}
                </div>
            </div>
            {submitError ? <div className="px-5 pb-3 text-xs" style={{ color: "#dc2626" }}>{submitError}</div> : null}
        </Modal>
    );
}

function RenderNotice({ text, theme }: { text: string; theme: (typeof canvasThemes)["light"] | (typeof canvasThemes)["dark"] }) {
    return (
        <div className="rounded-lg border px-3.5 py-3 text-sm opacity-80" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            {text}
        </div>
    );
}
