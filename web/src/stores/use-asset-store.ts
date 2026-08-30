"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { fetchUserAssetData, syncUserAssetData } from "@/services/api/user-config";

export type AssetKind = "text" | "image" | "video" | "audio" | "character";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes?: number; mimeType: string; durationMs?: number } };
export type CharacterAsset = AssetBase<"character"> & { data: { storageKey?: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset | CharacterAsset;

// 角色资产约定：沿用现有 Asset 结构，角色信息保存在 metadata.character，tags 含 "character"
export type CharacterViewKind = "front" | "side" | "back" | "threeQuarter";
export type CharacterViewImage = { url: string; storageKey?: string };
export type CharacterViewMap = Partial<Record<CharacterViewKind, CharacterViewImage>>;
export type CharacterInfo = {
    name: string;
    views: CharacterViewMap;
    description?: string;
    voicePreset?: string;
};

export const CHARACTER_VIEW_ORDER: CharacterViewKind[] = ["front", "side", "back", "threeQuarter"];
export const CHARACTER_VIEW_LABELS: Record<CharacterViewKind, string> = {
    front: "正面",
    side: "侧面",
    back: "背面",
    threeQuarter: "四分之三",
};

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    hydrateAccountAssets: (token: string, syncEnabled?: boolean) => Promise<void>;
    syncAccountAssets: (token: string) => Promise<void>;
    stopAccountAssetSync: () => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let activeAssetSyncToken = "";
let accountAssetSyncEnabled = false;
let isHydratingAccountAssets = false;
let syncTimer: number | null = null;

type AssetSnapshot = { assets: Asset[] };

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "character") {
                    const info = getCharacterInfo(asset);
                    if (!info) return asset;
                    const views: CharacterViewMap = {};
                    await Promise.all(
                        CHARACTER_VIEW_ORDER.map(async (viewKey) => {
                            const view = info.views[viewKey];
                            if (!view) return;
                            views[viewKey] = view.storageKey ? { ...view, url: await resolveImageUrl(view.storageKey, view.url) } : view;
                        }),
                    );
                    const coverUrl = asset.coverUrl.startsWith("blob:") && views.front?.storageKey ? await resolveImageUrl(views.front.storageKey, asset.coverUrl) : asset.coverUrl;
                    return { ...asset, coverUrl, metadata: { ...(asset.metadata || {}), character: { ...info, views } } };
                }
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey)
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                scheduleAssetSync(get);
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => {
                    const assets = state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset));
                    window.setTimeout(() => scheduleAssetSync(get), 0);
                    return { assets };
                }),
            removeAsset: (id) =>
                set((state) => {
                    const deletedAsset = state.assets.find((asset) => asset.id === id);
                    const assets = state.assets.filter((asset) => asset.id !== id);

                    if (deletedAsset && deletedAsset.kind !== "text") {
                        // 待清理的 key：资产自身 storageKey + 角色各视图的 storageKey
                        const keysToRemove = collectAssetStorageKeys(deletedAsset);
                        window.setTimeout(async () => {
                            if (!keysToRemove.length) return;
                            const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                            const usedKeys = new Set<string>();
                            // 收集其余资产的 storageKey（含角色视图）
                            assets.forEach((a) => {
                                collectAssetStorageKeys(a).forEach((k) => usedKeys.add(k));
                            });
                            // 收集画布中引用的 storageKey
                            const projects = useCanvasStore.getState().projects;
                            const { collectImageStorageKeys } = await import("@/services/image-storage");
                            const { collectMediaStorageKeys } = await import("@/services/file-storage");
                            collectImageStorageKeys(projects, usedKeys);
                            collectMediaStorageKeys(projects, usedKeys);

                            // 收集本地/云端生图历史与视频历史中的 storageKey，避免生成结果卡片失效
                            try {
                                const localforage = (await import("localforage")).default;
                                const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                                await imageLogStore.iterate((log: any) => {
                                    if (log) {
                                        if (Array.isArray(log.images)) {
                                            log.images.forEach((img: any) => {
                                                if (img && img.storageKey) usedKeys.add(img.storageKey);
                                            });
                                        }
                                        if (Array.isArray(log.references)) {
                                            log.references.forEach((ref: any) => {
                                                if (ref && ref.storageKey) usedKeys.add(ref.storageKey);
                                            });
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error("Error iterating image_generation_logs", e);
                            }

                            try {
                                const localforage = (await import("localforage")).default;
                                const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                                await videoLogStore.iterate((log: any) => {
                                    if (log) {
                                        if (log.video && log.video.storageKey) {
                                            usedKeys.add(log.video.storageKey);
                                        }
                                        if (Array.isArray(log.references)) {
                                            log.references.forEach((ref: any) => {
                                                if (ref && ref.storageKey) usedKeys.add(ref.storageKey);
                                            });
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error("Error iterating video_generation_logs", e);
                            }

                            // 若全站没有其他地方再引用这些 storageKey，则执行真正的物理删除
                            for (const key of keysToRemove) {
                                if (usedKeys.has(key)) continue;
                                if (key.startsWith("image:") || key.startsWith("server:")) {
                                    const { deleteStoredImages } = await import("@/services/image-storage");
                                    await deleteStoredImages([key]);
                                }
                                if (key.startsWith("file:") || key.startsWith("video:") || key.startsWith("server:")) {
                                    const { deleteStoredMedia } = await import("@/services/file-storage");
                                    await deleteStoredMedia([key]);
                                }
                            }
                        }, 0);
                    }

                    window.setTimeout(() => scheduleAssetSync(get), 0);
                    return { assets };
                }),
            hydrateAccountAssets: async (token, syncEnabled = false) => {
                if (!token) return;
                activeAssetSyncToken = token;
                accountAssetSyncEnabled = syncEnabled;
                isHydratingAccountAssets = true;
                try {
                    const remote = await fetchUserAssetData<AssetSnapshot>(token);
                    const remoteAssets = Array.isArray(remote?.assets) ? remote.assets : [];
                    if (syncEnabled) {
                        set({ assets: remoteAssets });
                    } else {
                        const localHasAssets = get().assets.length > 0;
                        if (!localHasAssets && remoteAssets.length) {
                            set({ assets: remoteAssets });
                        }
                    }
                } finally {
                    isHydratingAccountAssets = false;
                }
            },
            syncAccountAssets: async (token) => {
                if (!token || !accountAssetSyncEnabled) return;
                await syncUserAssetData(token, { assets: get().assets });
            },
            stopAccountAssetSync: () => {
                activeAssetSyncToken = "";
                if (syncTimer) window.clearTimeout(syncTimer);
                syncTimer = null;
            },
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                    const logKeys: string[] = [];
                    try {
                        const localforage = (await import("localforage")).default;
                        const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                        await imageLogStore.iterate((log: any) => {
                            if (log) {
                                if (Array.isArray(log.images)) {
                                    log.images.forEach((img: any) => {
                                        if (img && img.storageKey) logKeys.push(img.storageKey);
                                    });
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                        const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                        await videoLogStore.iterate((log: any) => {
                            if (log) {
                                if (log.video && log.video.storageKey) {
                                    logKeys.push(log.video.storageKey);
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                    } catch (e) {
                        console.error("Error gathering log keys in cleanupImages", e);
                    }

                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra, logKeys });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra, logKeys });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
        },
    ),
);

// 收集单个资产的 storageKey：资产自身 + 角色各视图（metadata.character.views[*].storageKey）
export function collectAssetStorageKeys(asset: Asset): string[] {
    const keys: string[] = [];
    if (asset.kind !== "text" && asset.data.storageKey) keys.push(asset.data.storageKey);
    if (asset.kind === "character") {
        const info = getCharacterInfo(asset);
        if (info) {
            CHARACTER_VIEW_ORDER.forEach((viewKey) => {
                const storageKey = info.views[viewKey]?.storageKey;
                if (storageKey) keys.push(storageKey);
            });
        }
    }
    return keys;
}

function scheduleAssetSync(get: () => AssetStore) {
    if (isHydratingAccountAssets || !activeAssetSyncToken || !accountAssetSyncEnabled || typeof window === "undefined") return;
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
        void get().syncAccountAssets(activeAssetSyncToken).catch(() => {});
    }, 600);
}

// 类型安全读取角色信息，容忍 metadata 缺失或旧数据中 views 为纯 URL 字符串的情况
export function getCharacterInfo(asset: Asset): CharacterInfo | null {
    if (asset.kind !== "character") return null;
    const raw = (asset.metadata?.character && typeof asset.metadata.character === "object" ? asset.metadata.character : {}) as Record<string, unknown>;
    const rawViews = (raw.views && typeof raw.views === "object" ? raw.views : {}) as Record<string, unknown>;
    const views: CharacterViewMap = {};
    CHARACTER_VIEW_ORDER.forEach((viewKey) => {
        const value = rawViews[viewKey];
        if (typeof value === "string" && value.trim()) {
            views[viewKey] = { url: value.trim() };
        } else if (value && typeof value === "object" && typeof (value as CharacterViewImage).url === "string" && (value as CharacterViewImage).url.trim()) {
            const entry = value as CharacterViewImage;
            views[viewKey] = entry.storageKey ? { url: entry.url.trim(), storageKey: entry.storageKey } : { url: entry.url.trim() };
        }
    });
    const info: CharacterInfo = {
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : asset.title,
        views,
    };
    if (typeof raw.description === "string" && raw.description.trim()) info.description = raw.description;
    if (typeof raw.voicePreset === "string" && raw.voicePreset.trim()) info.voicePreset = raw.voicePreset;
    return info;
}

// 获取角色用于插入画布/展示的正面视图（缺正面图时退回任意视图或封面）
export function getCharacterCoverView(asset: CharacterAsset): CharacterViewImage | null {
    const info = getCharacterInfo(asset);
    if (!info) return asset.coverUrl ? { url: asset.coverUrl } : null;
    const fallback = CHARACTER_VIEW_ORDER.map((viewKey) => info.views[viewKey]).find(Boolean);
    return info.views.front || fallback || (asset.coverUrl ? { url: asset.coverUrl } : null);
}

type AddCharacterAssetParams = {
    name: string;
    views?: CharacterViewMap;
    description?: string;
    voicePreset?: string;
    tags?: string[];
    source?: string;
    coverUrl?: string;
};

// 新增角色资产的便捷入口，自动写入 metadata.character、"character" 标签与封面（默认取正面视图）
export function addCharacterAsset(params: AddCharacterAssetParams): string {
    const info: CharacterInfo = { name: params.name.trim() || "未命名角色", views: params.views || {} };
    if (params.description?.trim()) info.description = params.description.trim();
    if (params.voicePreset?.trim()) info.voicePreset = params.voicePreset.trim();
    const tags = Array.from(new Set(["character", ...(params.tags || [])]));
    return useAssetStore.getState().addAsset({
        kind: "character",
        title: info.name,
        coverUrl: params.coverUrl || info.views.front?.url || "",
        tags,
        source: params.source,
        data: {},
        metadata: { character: info },
    });
}

// 更新角色名称 / 描述 / 视图等角色信息（同步标题与封面）
export function updateCharacterInfo(id: string, patch: Partial<CharacterInfo>) {
    const asset = useAssetStore.getState().assets.find((item) => item.id === id);
    if (!asset || asset.kind !== "character") return;
    const current = getCharacterInfo(asset) || { name: asset.title, views: {} };
    const next: CharacterInfo = { ...current, ...patch, views: patch.views || current.views };
    const coverUrl = next.views.front?.url || asset.coverUrl;
    useAssetStore.getState().updateAsset(id, { title: next.name, coverUrl, metadata: { ...(asset.metadata || {}), character: next } });
}

export function mergeAssets(remoteAssets: Asset[], localAssets: Asset[]) {
    const records = new Map<string, Asset>();
    [...localAssets, ...remoteAssets].forEach((asset) => {
        const previous = records.get(asset.id);
        if (!previous || Date.parse(asset.updatedAt || "") >= Date.parse(previous.updatedAt || "")) {
            records.set(asset.id, asset);
        }
    });
    return Array.from(records.values()).sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}
