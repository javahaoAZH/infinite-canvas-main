"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Image, Tag } from "antd";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { cn } from "@/lib/utils";
import { HomeBannerCarousel, type HomeBanner } from "../home-banner-carousel";

const HOME_BANNERS: HomeBanner[] = [
    { imageUrl: "https://gcore.jsdelivr.net/gh/tigerowo/cdn-tdeh@v0.6/img/infinite-canvas/metaso.webp", videoUrl: "", linkUrl: "https://metaso.cn/minimax-h3/?s=tt", alt: "1" },
    { imageUrl: "https://gcore.jsdelivr.net/gh/tigerowo/cdn-tdeh@v0.5/img/infinite-canvas/3ddirectortl.webp", videoUrl: "", linkUrl: "", alt: "2" },
    { imageUrl: "https://gcore.jsdelivr.net/gh/tigerowo/cdn-tdeh@v0.4/img/infinite-canvas/agent.webp", videoUrl: "https://gcore.jsdelivr.net/gh/tigerowo/cdn-tdeh@v0.4/img/infinite-canvas/agent.webm", linkUrl: "", alt: "3" },
    { imageUrl: "https://gcore.jsdelivr.net/gh/tigerowo/cdn-tdeh@v0.4/img/infinite-canvas/panorama.webp", videoUrl: "", linkUrl: "", alt: "4" },
    { imageUrl: "https://gcore.jsdelivr.net/gh/tigerowo/cdn-tdeh@v0.4/img/infinite-canvas/3ddirector.webp", videoUrl: "", linkUrl: "", alt: "5" },
];

// 探索页：承接原首页的功能轮播与提示词画廊（首页改为 Codex 新对话形态）
export default function ExplorePage() {
    const { message } = App.useApp();
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, [message]);

    return (
        <main className="h-full overflow-y-auto overflow-x-hidden bg-background">
            <section className="mx-auto max-w-7xl px-6 py-8">
                <HomeBannerCarousel banners={HOME_BANNERS} />

                <section className="mx-auto mt-12 max-w-6xl border-t border-border pt-12">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <div className="flex flex-wrap items-center justify-center gap-3">
                                <h2 className="text-3xl font-semibold text-foreground">沉淀每一次好结果</h2>
                                <Button type="primary" size="middle" href="https://prompts.tdeh.top/" target="_blank" className="-translate-y-[6px]">提示词仓库</Button>
                            </div>
                            <p className="mt-3 text-base leading-7 text-muted-foreground">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                        </div>
                        <Button type="link" href="/prompts" className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            提示词库
                        </Button>
                    </div>
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden border border-border bg-secondary text-left",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            </section>
            <Image.PreviewGroup
                items={promptShowcase.map((item) => ({
                    src: item.coverUrl,
                    alt: item.title,
                }))}
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            />
        </main>
    );
}
