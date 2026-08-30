"use client";

import { Workflow } from "lucide-react";
import { useState } from "react";
import { Button } from "antd";

import { DirectorDrawer } from "@/app/(user)/drama/components/director/director-drawer";
import type { DramaProject } from "@/stores/use-drama-store";
import { useDirectorStore } from "@/stores/use-director-store";

// 顶部常驻入口：任意步骤可见进度；运行/暂停中显示 已完成/总数 徽标
export function DirectorEntry({ project }: { project: DramaProject }) {
    const [open, setOpen] = useState(false);
    const plan = useDirectorStore((state) => state.plans[project.id]);
    const active = plan && (plan.status === "running" || plan.status === "paused");
    const terminal = plan ? plan.tasks.filter((task) => task.status === "success" || task.status === "skipped" || task.status === "failed").length : 0;
    return (
        <>
            <Button icon={<Workflow className="size-4" />} onClick={() => setOpen(true)}>
                自动生产
                {active && plan ? (
                    <span className={`ml-1.5 px-1.5 py-0.5 text-xs leading-none ${plan.status === "running" ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-400"}`}>
                        {terminal}/{plan.tasks.length}
                    </span>
                ) : null}
            </Button>
            <DirectorDrawer project={project} open={open} onClose={() => setOpen(false)} />
        </>
    );
}
