"use client";

// 侧栏增强组件（台账 A#7/A#8/A#30）：统一搜索 overlay、生产通知铃下拉、最近生成区
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import localforage from "localforage";
import { Dropdown, Input } from "antd";
import { Bell, Clapperboard, Folder, Image as ImageIcon, Lightbulb, Search, Sparkles } from "lucide-react";

import { getBridgeSnapshot, onBridgeStatusChange, type BridgeSnapshot } from "@/app/(user)/drama/services/drama-bridge";
import { approvedRepresentativeIds, representativeShotIds } from "@/app/(user)/drama/services/production-readiness";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { fetchPrompts } from "@/services/api/prompts";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";

type SearchResult = { key: string; icon: React.ReactNode; label: string; desc?: string; href: string };

export function SidebarSearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
    const router = useRouter();
    const canvasProjects = useCanvasStore((state) => state.projects);
    const dramaProjects = useDramaStore((state) => state.projects);
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [promptItems, setPromptItems] = useState<{ id: string; title: string }[]>([]);

    useEffect(() => {
        if (!open) {
            setKeyword("");
            setPromptItems([]);
            return;
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const query = keyword.trim();
        if (!query) {
            setPromptItems([]);
            return;
        }
        const timer = window.setTimeout(() => {
            void fetchPrompts({ keyword: query, pageSize: 5 })
                .then((payload) => setPromptItems(payload.items.map((item) => ({ id: item.id, title: item.title }))))
                .catch(() => setPromptItems([]));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [keyword, open]);

    const results = useMemo<SearchResult[]>(() => {
        const query = keyword.trim().toLowerCase();
        if (!query) return [];
        const list: SearchResult[] = [];
        canvasProjects
            .filter((project) => !project.archived && project.title.toLowerCase().includes(query))
            .slice(0, 4)
            .forEach((project) => list.push({ key: `canvas-${project.id}`, icon: <Folder className="size-3.5" />, label: project.title, desc: "画布项目", href: `/canvas/view?id=${project.id}` }));
        dramaProjects
            .filter((project) => project.title.toLowerCase().includes(query))
            .slice(0, 4)
            .forEach((project) => list.push({ key: `drama-${project.id}`, icon: <Clapperboard className="size-3.5" />, label: project.title, desc: "漫剧项目", href: "/drama" }));
        dramaProjects.forEach((project) => {
            project.shots.forEach((shot, index) => {
                if (list.length > 24) return;
                if (shot.description.toLowerCase().includes(query)) list.push({ key: `shot-${project.id}-${shot.id}`, icon: <Clapperboard className="size-3.5" />, label: `${project.title} · 镜 ${index + 1}`, desc: shot.description.slice(0, 40), href: "/drama" });
            });
        });
        assets
            .filter((asset) => asset.title.toLowerCase().includes(query))
            .slice(0, 4)
            .forEach((asset) => list.push({ key: `asset-${asset.id}`, icon: <ImageIcon className="size-3.5" />, label: asset.title, desc: "我的素材", href: "/assets" }));
        promptItems.forEach((item) => list.push({ key: `prompt-${item.id}`, icon: <Lightbulb className="size-3.5" />, label: item.title, desc: "提示词", href: "/prompts" }));
        return list;
    }, [assets, canvasProjects, dramaProjects, keyword, promptItems]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 px-6 pt-[12vh]" onClick={onClose}>
            <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <Input
                    size="large"
                    autoFocus
                    variant="borderless"
                    placeholder="搜索画布、漫剧、分镜、素材、提示词…"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onClose();
                        if (event.key === "Enter" && results[0]) {
                            router.push(results[0].href);
                            onClose();
                        }
                    }}
                />
                <div className="thin-scrollbar max-h-[52vh] overflow-y-auto border-t border-border">
                    {results.length ? (
                        results.map((result) => (
                            <button
                                key={result.key}
                                type="button"
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-foreground/8"
                                onClick={() => {
                                    router.push(result.href);
                                    onClose();
                                }}
                            >
                                <span className="shrink-0 text-muted-foreground">{result.icon}</span>
                                <span className="min-w-0 flex-1 truncate text-foreground">{result.label}</span>
                                {result.desc ? <span className="max-w-[180px] shrink-0 truncate text-xs text-muted-foreground">{result.desc}</span> : null}
                            </button>
                        ))
                    ) : (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground">{keyword.trim() ? "没有匹配结果" : "输入关键词开始搜索"}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

type Notification = { key: string; tone: "warn" | "info" | "danger"; label: string; href: string };

export function SidebarNotifications() {
    const router = useRouter();
    const dramaProjects = useDramaStore((state) => state.projects);
    const busyMedia = useDramaStore((state) => state.busyMedia);
    const failedMedia = useDramaStore((state) => state.failedMedia);
    const [snapshot, setSnapshot] = useState<BridgeSnapshot>(() => getBridgeSnapshot());

    useEffect(() => onBridgeStatusChange(setSnapshot), []);

    const notifications = useMemo<Notification[]>(() => {
        const list: Notification[] = [];
        dramaProjects.forEach((project) => {
            const representatives = representativeShotIds(project);
            const approved = approvedRepresentativeIds(project);
            if (representatives.length && approved.length < representatives.length) {
                list.push({ key: `gate-${project.id}`, tone: "warn", label: `「${project.title}」代表帧待确认 ${approved.length}/${representatives.length}`, href: "/drama" });
            }
        });
        const busyCount = Object.keys(busyMedia).length;
        if (busyCount) list.push({ key: "busy", tone: "info", label: `${busyCount} 个媒体生成中`, href: "/drama" });
        Object.entries(failedMedia).slice(0, 3).forEach(([key, value]) => list.push({ key: `failed-${key}`, tone: "danger", label: `生成失败：${value.error?.slice(0, 30) || "未知错误"}`, href: "/drama" }));
        if (snapshot.enabled && snapshot.status !== "connected") list.push({ key: "qoder", tone: "warn", label: snapshot.status === "connecting" ? "Qoder 通道连接中…" : "Qoder 通道未连接", href: "/plugins" });
        return list;
    }, [busyMedia, dramaProjects, failedMedia, snapshot]);

    const dotClass = (tone: Notification["tone"]) => (tone === "danger" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : "bg-sky-500");
    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            popupRender={() => (
                <div className="w-72 rounded-xl border border-border bg-card p-1.5 shadow-xl">
                    {notifications.length ? (
                        notifications.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-foreground/8"
                                onClick={() => router.push(item.href)}
                            >
                                <span className={cn("size-1.5 shrink-0 rounded-full", dotClass(item.tone))} />
                                <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                            </button>
                        ))
                    ) : (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">暂无通知</div>
                    )}
                </div>
            )}
        >
            <button type="button" className={cn("relative inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground")} title="通知" aria-label="通知">
                <Bell className="size-4" />
                {notifications.length ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500" /> : null}
            </button>
        </Dropdown>
    );
}

const recentLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });

export function SidebarRecentGenerations() {
    const [items, setItems] = useState<{ id: string; prompt: string; thumb?: string }[]>([]);
    useEffect(() => {
        let alive = true;
        void recentLogStore
            .getItem<{ id: string; prompt: string; images?: { url: string }[]; status?: string; createdAt?: number }[]>("image_generation_logs")
            .then((logs) => {
                if (!alive || !Array.isArray(logs)) return;
                setItems(
                    logs
                        .filter((log) => log.images?.length)
                        .slice(0, 3)
                        .map((log) => ({ id: log.id, prompt: log.prompt || "未命名生成", thumb: log.images![0].url })),
                );
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);
    if (!items.length) return null;
    return (
        <div className="mt-4">
            <div className="px-3 pb-1 text-xs text-muted-foreground">最近生成</div>
            <div className="flex flex-col gap-0.5 px-2">
                {items.map((item) => (
                    <a key={item.id} href="/image" className="flex h-9 items-center gap-2.5 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground">
                        {item.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumb} alt="" className="size-7 shrink-0 rounded-md object-cover" />
                        ) : (
                            <ImageIcon className="size-4 shrink-0" />
                        )}
                        <span className="truncate">{item.prompt}</span>
                    </a>
                ))}
            </div>
        </div>
    );
}
