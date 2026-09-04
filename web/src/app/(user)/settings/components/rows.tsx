"use client";

// 设置页共用行卡片：与页面主体分离，供模型渠道/存储等分区组件复用
import { Children, type ReactNode } from "react";

export function SettingsRow({ title, desc, control, search }: { title: string; desc?: string; control: ReactNode; search: string }) {
    if (search && !`${title}${desc || ""}`.toLowerCase().includes(search)) return null;
    return (
        <div className="flex items-center justify-between gap-6 px-4 py-3.5">
            <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{title}</div>
                {desc ? <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{desc}</div> : null}
            </div>
            <div className="shrink-0">{control}</div>
        </div>
    );
}

export function SettingsSection({ id, title, search, children }: { id: string; title: string; search: string; children: ReactNode }) {
    const rows = Children.toArray(children);
    if (search && rows.length === 0) return null;
    return (
        <section id={id} className="scroll-mt-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
            <div className="divide-y divide-border rounded-xl border border-border bg-card/40">{rows}</div>
        </section>
    );
}
