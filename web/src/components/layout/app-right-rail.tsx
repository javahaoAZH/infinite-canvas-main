"use client";

// Codex 同构右栏：输出内容（素材库最近产物）+ 来源（当前模型渠道）；标题栏开关控制显隐
import { Globe, Images, Link2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Image } from "antd";
import Link from "next/link";

import { useEffectiveConfig } from "@/stores/use-config-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

function assetThumb(asset: Asset): string {
    if (asset.kind === "image") return asset.data.dataUrl;
    if (asset.kind === "video") return "";
    return "";
}

export function AppRightRail() {
    const assets = useAssetStore((state) => state.assets);
    const config = useEffectiveConfig();
    const [expanded, setExpanded] = useState(false);

    const outputs = useMemo(() => assets.filter((asset) => asset.kind === "image" || asset.kind === "video"), [assets]);
    const visible = expanded ? outputs.slice(0, 24) : outputs.slice(0, 6);
    // 来源动态化（A#23）：最近一次生成所用模型优先，回退当前默认图/视频模型
    const sources = useMemo(() => {
        const models = [config.lastUsedSource, config.model, config.videoModel].filter(Boolean) as string[];
        return Array.from(new Set(models));
    }, [config]);

    return (
        <aside className="flex h-full w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card/60 p-3">
            <section>
                <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-medium text-muted-foreground">输出内容</span>
                    <Link href="/assets" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground" title="打开我的素材">
                        <Plus className="size-3.5" />
                    </Link>
                </div>
                {visible.length ? (
                    <div className="flex flex-col gap-1">
                        {visible.map((asset) => {
                            const thumb = assetThumb(asset);
                            return (
                                <div key={asset.id} className="flex h-8 items-center gap-2 rounded-lg px-1.5 text-sm text-foreground transition-colors hover:bg-foreground/8">
                                    {thumb ? (
                                        <Image src={thumb} alt={asset.title} width={22} height={22} className="rounded object-cover" />
                                    ) : (
                                        <span className="flex size-[22px] items-center justify-center rounded bg-secondary text-muted-foreground">
                                            <Images className="size-3" />
                                        </span>
                                    )}
                                    <span className="truncate text-[13px]">{asset.title}</span>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="px-1.5 py-2 text-xs text-muted-foreground">暂无产物，生成后自动出现在这里</div>
                )}
                {outputs.length > 6 ? (
                    <button type="button" className="mt-1 w-full rounded-lg px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground" onClick={() => setExpanded((value) => !value)}>
                        {expanded ? "收起" : `再显示 ${outputs.length - 6} 个`}
                    </button>
                ) : null}
            </section>

            <section className="border-t border-border pt-3">
                <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">来源</div>
                <div className="flex flex-col gap-1">
                    {sources.map((model) => (
                        <div key={model} className="flex h-8 items-center gap-2 rounded-lg px-1.5 text-[13px] text-foreground">
                            <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{model}</span>
                        </div>
                    ))}
                    <Link href="/cost" className="flex h-8 items-center gap-2 rounded-lg px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground">
                        <Link2 className="size-3.5 shrink-0" />
                        查看全部渠道与成本
                    </Link>
                </div>
            </section>
        </aside>
    );
}
