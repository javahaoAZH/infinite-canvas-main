"use client";

import { Copy, FolderPlus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Card, Drawer, Empty, Image, Input, Pagination, Spin, Tag, Typography } from "antd";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import {
    CHARACTER_VIEW_LABELS,
    CHARACTER_VIEW_ORDER,
    getCharacterInfo,
    updateCharacterInfo,
    useAssetStore,
    type CharacterAsset,
    type CharacterViewImage,
} from "@/stores/use-asset-store";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";

const PAGE_SIZE = 12;

export default function AssetLibraryPage() {
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const [keyword, setKeyword] = useState("");
    const [selectedType, setSelectedType] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [selectedAsset, setSelectedAsset] = useState<AssetLibraryItem | null>(null);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const assets = useAssetStore((state) => state.assets);
    const removeAsset = useAssetStore((state) => state.removeAsset);

    const query = useQuery({
        queryKey: ["asset-library", keyword, selectedType, selectedTags, page],
        queryFn: () => fetchAssetLibrary({ keyword, type: selectedType, tag: selectedTags, page, pageSize: PAGE_SIZE }),
        retry: false,
        enabled: selectedType !== "character",
    });

    // 角色为纯前端本地资产，直接从我的素材中读取，不走后端素材库接口
    const characters = useMemo(() => {
        if (selectedType !== "character") return [];
        const queryText = keyword.trim().toLowerCase();
        return assets
            .filter((asset) => asset.kind === "character")
            .filter((asset) => !selectedTags.length || asset.tags.some((tag) => selectedTags.includes(tag)))
            .filter((asset) => {
                if (!queryText) return true;
                const info = getCharacterInfo(asset);
                return [asset.title, info?.description || "", ...(asset.tags || [])].join(" ").toLowerCase().includes(queryText);
            });
    }, [assets, keyword, selectedTags, selectedType]);
    const characterPageItems = characters.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const selectedCharacter = (assets.find((asset) => asset.id === selectedCharacterId && asset.kind === "character") as CharacterAsset | undefined) || null;

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : "获取素材库失败");
        }
    }, [message, query.error, query.isError]);

    const isReady = selectedType === "character" || query.isFetched || query.isError;
    const items = query.data?.items || [];
    const availableTags = query.data?.tags || [];
    const total = query.data?.total || 0;

    const toggleTag = (tag: string) => {
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const saveToMyAssets = async (asset: AssetLibraryItem) => {
        try {
            if (asset.type === "image") {
                addAsset({
                    kind: "image",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    source: asset.category,
                    note: asset.description,
                    data: { dataUrl: asset.url, width: 0, height: 0, bytes: 0, mimeType: "image/*" },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            } else if (asset.type === "video") {
                addAsset({
                    kind: "video",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    source: asset.category,
                    note: asset.description,
                    data: { url: asset.url, width: 0, height: 0, bytes: 0, mimeType: "video/mp4" },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            } else if (asset.type === "audio") {
                addAsset({
                    kind: "audio",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    source: asset.category,
                    note: asset.description,
                    data: { url: asset.url, mimeType: "audio/mpeg" },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            } else {
                addAsset({
                    kind: "text",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    source: asset.category,
                    note: asset.description,
                    data: { content: asset.content },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            }
            message.success("已加入我的素材");
        } catch {
            message.error("加入失败");
        }
    };

    // 删除角色沿用现有素材删除链路，不额外新增逻辑
    const deleteCharacter = (character: CharacterAsset) => {
        modal.confirm({
            title: "删除角色",
            content: `确定删除角色「${getCharacterInfo(character)?.name || character.title}」吗？删除后会从我的素材中移除。`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                removeAsset(character.id);
                setSelectedCharacterId(null);
                message.success("角色已删除");
            },
        });
    };

    if (!isReady) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spin />
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">素材库</h1>
                        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">挑选团队素材，加入我的素材后继续编辑和使用。</p>
                    </div>
                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <Input
                            size="large"
                            className="w-full"
                            prefix={<Search className="size-4 text-stone-400" />}
                            value={keyword}
                            placeholder="按标题查询"
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                        />
                    </div>
                    <div className="mx-auto mt-6 max-w-6xl space-y-3">
                        <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                            <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">类型</div>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { label: "全部", value: "" },
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                    { label: "视频", value: "video" },
                                    { label: "音频", value: "audio" },
                                    { label: "角色", value: "character" },
                                ].map((item) => (
                                    <Tag.CheckableTag
                                        key={item.value || "all"}
                                        checked={selectedType === item.value}
                                        className={cn("prompt-filter-tag", selectedType === item.value && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            setSelectedType(item.value);
                                        }}
                                    >
                                        {item.label}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                            <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">标签</div>
                            <div className="flex flex-wrap gap-2">
                                <Tag.CheckableTag
                                    checked={selectedTags.length === 0}
                                    className={cn("prompt-filter-tag", selectedTags.length === 0 && "is-active")}
                                    onChange={() => {
                                        setPage(1);
                                        setSelectedTags([]);
                                    }}
                                >
                                    全部
                                </Tag.CheckableTag>
                                {availableTags.map((tag) => (
                                    <Tag.CheckableTag
                                        key={tag}
                                        checked={selectedTags.includes(tag)}
                                        className={cn("prompt-filter-tag", selectedTags.includes(tag) && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            toggleTag(tag);
                                        }}
                                    >
                                        {tag}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    {selectedType === "character" ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
                            {characterPageItems.map((asset) => (
                                <CharacterCard key={asset.id} asset={asset as CharacterAsset} onOpen={() => setSelectedCharacterId(asset.id)} />
                            ))}
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
                            {items.map((asset) => (
                                <LibraryCard key={asset.id} asset={asset} onOpen={() => setSelectedAsset(asset)} onAdd={() => void saveToMyAssets(asset)} />
                            ))}
                        </div>
                    )}

                    {selectedType === "character" && !characters.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无角色，可在后续流程中创建角色资产" className="py-20" /> : null}
                    {selectedType !== "character" && !items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到素材" className="py-20" /> : null}

                    <div className="flex justify-center">
                        <Pagination current={page} pageSize={PAGE_SIZE} total={selectedType === "character" ? characters.length : total} showSizeChanger={false} onChange={(nextPage) => setPage(nextPage)} />
                    </div>
                </div>
            </main>

            <Drawer title="素材详情" open={Boolean(selectedAsset)} size="large" onClose={() => setSelectedAsset(null)}>
                {selectedAsset ? (
                    <div className="space-y-5">
                        {selectedAsset.coverUrl ? (
                            <Image src={selectedAsset.coverUrl} alt={selectedAsset.title} className="rounded-lg" />
                        ) : (
                            <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{selectedAsset.content || "暂无封面"}</div>
                        )}
                        <div>
                            <Typography.Title level={4} className="!mb-2">
                                {selectedAsset.title}
                            </Typography.Title>
                            <div className="flex flex-wrap gap-1.5">
                                <Tag>{assetTypeLabel(selectedAsset.type)}</Tag>
                                {selectedAsset.tags.map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                ))}
                            </div>
                        </div>
                        <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                            <Typography.Text type="secondary" className="block text-xs">
                                内容
                            </Typography.Text>
                            {selectedAsset.type === "text" ? <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{selectedAsset.content}</Typography.Paragraph> : <Typography.Text className="mt-2 block">{selectedAsset.url}</Typography.Text>}
                        </div>
                        {selectedAsset.description ? <Typography.Paragraph type="secondary">{selectedAsset.description}</Typography.Paragraph> : null}
                        <div className="flex flex-wrap gap-2">
                            {selectedAsset.type === "text" ? (
                                <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(selectedAsset.content)}>
                                    复制文本
                                </Button>
                            ) : null}
                            {selectedAsset.type !== "text" ? (
                                <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(selectedAsset.url)}>
                                    复制链接
                                </Button>
                            ) : null}
                            <Button icon={<FolderPlus className="size-4" />} onClick={() => void saveToMyAssets(selectedAsset)}>
                                加入我的素材
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Drawer>

            <CharacterDetailDrawer asset={selectedCharacter} onClose={() => setSelectedCharacterId(null)} onDelete={() => selectedCharacter && deleteCharacter(selectedCharacter)} />
        </div>
    );
}

function LibraryCard({ asset, onOpen, onAdd }: { asset: AssetLibraryItem; onOpen: () => void; onAdd: () => void }) {
    const cover = asset.coverUrl;
    return (
        <Card
            hoverable
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{asset.content || "暂无封面"}</div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                        <Tag className="m-0 shrink-0 text-[11px]">{assetTypeLabel(asset.type)}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {asset.type === "text" ? asset.content : asset.url}
                    </Typography.Paragraph>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {asset.tags.slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags.length ? <Tag className="m-0 text-[11px]">无标签</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>
                    查看
                </Button>
                <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={onAdd}>
                    加入我的素材
                </Button>
            </div>
        </Card>
    );
}

function assetTypeLabel(type: AssetLibraryItem["type"]) {
    if (type === "image") return "图片";
    if (type === "video") return "视频";
    if (type === "audio") return "音频";
    return "文本";
}

function CharacterViewCell({ view, label }: { view?: CharacterViewImage; label: string }) {
    return view?.url ? (
        <img src={view.url} alt={label} className="size-full object-cover" />
    ) : (
        <div className="flex size-full flex-col items-center justify-center gap-0.5 bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
            <span className="text-[11px]">{label}</span>
            <span className="text-[10px]">暂无</span>
        </div>
    );
}

export function CharacterCard({ asset, onOpen }: { asset: CharacterAsset; onOpen: () => void }) {
    const info = getCharacterInfo(asset);
    return (
        <Card
            hoverable
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    <div className="grid aspect-[4/3] w-full grid-cols-2 gap-px bg-stone-200 dark:bg-stone-700">
                        {CHARACTER_VIEW_ORDER.map((viewKey) => (
                            <CharacterViewCell key={viewKey} view={info?.views[viewKey]} label={CHARACTER_VIEW_LABELS[viewKey]} />
                        ))}
                    </div>
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{info?.name || asset.title}</h2>
                        <Tag className="m-0 shrink-0 text-[11px]">角色</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {info?.description || "暂无描述"}
                    </Typography.Paragraph>
                </div>
            </button>
            <div className="px-4 pb-4">
                <Button size="small" onClick={onOpen}>
                    查看 / 编辑
                </Button>
            </div>
        </Card>
    );
}

export function CharacterDetailDrawer({ asset, onClose, onDelete }: { asset: CharacterAsset | null; onClose: () => void; onDelete: () => void }) {
    const info = asset ? getCharacterInfo(asset) : null;
    return (
        <Drawer title="角色详情" open={Boolean(asset)} size="large" onClose={onClose}>
            {asset && info ? (
                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                        {CHARACTER_VIEW_ORDER.map((viewKey) => {
                            const view = info.views[viewKey];
                            return (
                                <div key={viewKey}>
                                    <Typography.Text type="secondary" className="mb-1 block text-xs">
                                        {CHARACTER_VIEW_LABELS[viewKey]}
                                    </Typography.Text>
                                    {view?.url ? (
                                        <Image src={view.url} alt={CHARACTER_VIEW_LABELS[viewKey]} className="aspect-[3/4] w-full rounded-lg object-cover" />
                                    ) : (
                                        <div className="flex aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-stone-300 text-xs text-stone-400 dark:border-stone-700 dark:text-stone-500">暂无{CHARACTER_VIEW_LABELS[viewKey]}图</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {info.voicePreset ? (
                        <div className="flex items-center gap-2">
                            <Typography.Text type="secondary" className="text-xs">
                                声音预设
                            </Typography.Text>
                            <Tag className="m-0">{info.voicePreset}</Tag>
                        </div>
                    ) : null}
                    <CharacterEditForm key={asset.id} asset={asset} />
                    <div>
                        <Button danger icon={<Trash2 className="size-4" />} onClick={onDelete}>
                            删除角色
                        </Button>
                    </div>
                </div>
            ) : null}
        </Drawer>
    );
}

function CharacterEditForm({ asset }: { asset: CharacterAsset }) {
    const { message } = App.useApp();
    const info = getCharacterInfo(asset);
    const originalName = info?.name || asset.title;
    const originalDescription = info?.description || "";
    const [name, setName] = useState(originalName);
    const [description, setDescription] = useState(originalDescription);
    const dirty = name.trim() !== originalName || description.trim() !== originalDescription;

    const save = () => {
        if (!name.trim()) {
            message.error("请输入角色名称");
            return;
        }
        updateCharacterInfo(asset.id, { name: name.trim(), description: description.trim() || undefined });
        message.success("角色信息已更新");
    };

    return (
        <div className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <div>
                <Typography.Text type="secondary" className="mb-1 block text-xs">
                    角色名称
                </Typography.Text>
                <Input value={name} placeholder="角色名称" onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
                <Typography.Text type="secondary" className="mb-1 block text-xs">
                    角色描述
                </Typography.Text>
                <Input.TextArea value={description} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="可选，记录角色设定、外貌、性格等描述" onChange={(event) => setDescription(event.target.value)} />
            </div>
            {dirty ? (
                <Button type="primary" size="small" onClick={save}>
                    保存修改
                </Button>
            ) : null}
        </div>
    );
}
