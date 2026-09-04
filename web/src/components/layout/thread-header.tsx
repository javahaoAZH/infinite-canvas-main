"use client";

// 线程头范式（台账批次 B #9）：图标 + 标题 + 自定义动作位 + ⋯ 菜单位；生图/视频台与漫剧页头部统一使用
import { MoreHorizontal } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";
import type { ReactNode } from "react";

export function ThreadHeader({ icon, title, desc, actions, menuItems }: { icon: ReactNode; title: string; desc?: string; actions?: ReactNode; menuItems?: MenuProps["items"] }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
                <span className="shrink-0 text-muted-foreground [&>svg]:size-4">{icon}</span>
                <div className="min-w-0">
                    <h1 className="truncate text-sm font-medium leading-5 text-foreground">{title}</h1>
                    {desc ? <p className="truncate text-xs leading-4 text-muted-foreground">{desc}</p> : null}
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {actions}
                {menuItems?.length ? (
                    <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
                        <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground" aria-label="更多操作" title="更多操作">
                            <MoreHorizontal className="size-4" />
                        </button>
                    </Dropdown>
                ) : null}
            </div>
        </div>
    );
}
