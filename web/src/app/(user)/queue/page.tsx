"use client";

// 已安排队列页（台账批次 A #5）：渲染与生产任务总览——导演台计划进度、生成中/失败媒体、成片任务入口
import { AlertCircle, ArrowRight, Clapperboard, LoaderCircle, PauseCircle } from "lucide-react";
import Link from "next/link";

import { useDirectorStore } from "@/stores/use-director-store";
import { useDramaStore } from "@/stores/use-drama-store";

const KIND_LABEL: Record<string, string> = { script: "剧本", review: "审查", character: "立绘", shotImage: "分镜图", shotVideo: "视频", audio: "配音", render: "成片" };

export default function QueuePage() {
    const plans = useDirectorStore((state) => state.plans);
    const dramaProjects = useDramaStore((state) => state.projects);
    const busyMedia = useDramaStore((state) => state.busyMedia);
    const failedMedia = useDramaStore((state) => state.failedMedia);
    const entries = Object.values(plans);
    const busyCount = Object.keys(busyMedia).length;

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-6 py-10">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">已安排</h1>
                    <p className="mt-1 text-sm text-muted-foreground">渲染与生产任务总览：导演台计划、生成中与失败任务（点击进入对应项目处理）</p>
                </div>

                {busyCount ? (
                    <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                            <LoaderCircle className="size-4 animate-spin text-sky-500" />
                            {busyCount} 个媒体正在生成
                        </div>
                    </section>
                ) : null}

                {Object.entries(failedMedia).length ? (
                    <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                            <AlertCircle className="size-4 text-red-500" />
                            {Object.keys(failedMedia).length} 个失败任务
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {Object.entries(failedMedia).slice(0, 5).map(([key, value]) => (
                                <div key={key} className="truncate">
                                    {key}：{value.error || "未知错误"}
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}

                {entries.length ? (
                    entries.map((plan) => {
                        const project = dramaProjects.find((item) => item.id === plan.projectId);
                        const done = plan.tasks.filter((task) => task.status === "success" || task.status === "skipped").length;
                        const failed = plan.tasks.filter((task) => task.status === "failed").length;
                        return (
                            <Link key={plan.projectId} href="/drama" className="block rounded-xl border border-border bg-card/40 p-4 transition-colors hover:bg-foreground/5">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        {plan.status === "running" ? <LoaderCircle className="size-4 shrink-0 animate-spin text-sky-500" /> : plan.status === "paused" ? <PauseCircle className="size-4 shrink-0 text-amber-500" /> : <Clapperboard className="size-4 shrink-0 text-muted-foreground" />}
                                        <span className="truncate text-sm font-medium text-foreground">{project?.title || plan.projectId}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">{plan.status === "running" ? "生产中" : plan.status === "paused" ? "已暂停" : plan.status === "aborted" ? "已终止" : "已完成"}</span>
                                    </div>
                                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                                    {(["character", "shotImage", "shotVideo", "audio", "render"] as const).filter((kind) => plan.tasks.some((task) => task.kind === kind)).map((kind) => {
                                        const tasks = plan.tasks.filter((task) => task.kind === kind);
                                        const doneKind = tasks.filter((task) => task.status === "success" || task.status === "skipped").length;
                                        return (
                                            <span key={kind} className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                                                {KIND_LABEL[kind] || kind} {doneKind}/{tasks.length}
                                            </span>
                                        );
                                    })}
                                    {failed ? <span className="rounded-full border border-red-500/40 px-2 py-0.5 text-red-500">失败 {failed}</span> : null}
                                    <span className="text-muted-foreground">总进度 {done}/{plan.tasks.length}</span>
                                </div>
                            </Link>
                        );
                    })
                ) : (
                    <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
                        暂无已安排的任务。到
                        <Link href="/drama" className="mx-1 underline underline-offset-2">
                            AI 漫剧
                        </Link>
                        发起自动生产，或在工作台生成媒体后这里会显示进度。
                    </div>
                )}
            </div>
        </main>
    );
}
