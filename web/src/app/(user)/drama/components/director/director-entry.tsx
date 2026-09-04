"use client";

import { Workflow } from "lucide-react";
import { useState } from "react";
import { Button } from "antd";

import { DirectorDrawer } from "@/app/(user)/drama/components/director/director-drawer";
import type { DramaProject } from "@/stores/use-drama-store";
import { useDirectorStore } from "@/stores/use-director-store";

// 顶部常驻入口：任意步骤可见进度；运行/暂停中显示 已完成/总数 徽标；分类 chips 可点开抽屉看任务参数（台账 A#10）
export function DirectorEntry({ project }: { project: DramaProject }) {
    const [open, setOpen] = useState(false);
    const plan = useDirectorStore((state) => state.plans[project.id]);
    const active = plan && (plan.status === "running" || plan.status === "paused");
    const terminal = plan ? plan.tasks.filter((task) => task.status === "success" || task.status === "skipped" || task.status === "failed").length : 0;
    const KIND_LABEL = { character: "立绘", shotImage: "分镜图", shotVideo: "视频", audio: "配音" } as const;
    return (
        <>
            <span className="flex flex-wrap items-center gap-2">
                <Button icon={<Workflow className="size-4" />} onClick={() => setOpen(true)}>
                    自动生产
                    {active && plan ? (
                        <span className={`ml-1.5 px-1.5 py-0.5 text-xs leading-none ${plan.status === "running" ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-400"}`}>
                            {terminal}/{plan.tasks.length}
                        </span>
                    ) : null}
                </Button>
                {plan ? (
                    <span className="flex items-center gap-1.5">
                        {(["character", "shotImage", "shotVideo", "audio"] as const).filter((kind) => plan.tasks.some((task) => task.kind === kind)).map((kind) => {
                            const tasks = plan.tasks.filter((task) => task.kind === kind);
                            const done = tasks.filter((task) => task.status === "success" || task.status === "skipped").length;
                            return (
                                <button
                                    key={kind}
                                    type="button"
                                    title="点击查看任务参数与状态"
                                    onClick={() => setOpen(true)}
                                    className="h-7 rounded-full border border-stone-200 px-2.5 text-xs text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200"
                                >
                                    {KIND_LABEL[kind]} {done}/{tasks.length}
                                </button>
                            );
                        })}
                    </span>
                ) : null}
            </span>
            <DirectorDrawer project={project} open={open} onClose={() => setOpen(false)} />
        </>
    );
}
