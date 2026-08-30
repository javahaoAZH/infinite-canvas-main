"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import type { CharacterViewKind } from "@/stores/use-asset-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

// 漫剧生产线统一媒体引用：url 用于展示，storageKey 用于本地持久化恢复与画布/成片复用
export type DramaMedia = {
    url: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    durationMs?: number;
};

export type DramaShot = {
    id: string;
    description: string;
    dialogue: string;
    // 可选旁白画外音（VO），旧数据可能缺失
    narration?: string;
    seconds: number;
};

export type DramaCharacter = {
    id: string;
    name: string;
    description: string;
    candidates: DramaMedia[];
    views: Partial<Record<CharacterViewKind, DramaMedia>>;
    assetId?: string;
};

export type DramaProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    step: number;
    script: string;
    shots: DramaShot[];
    characters: DramaCharacter[];
    shotImages: Record<string, DramaMedia>;
    shotVideos: Record<string, DramaMedia>;
    shotAudios: Record<string, DramaMedia>;
};

type DramaStore = {
    projects: DramaProject[];
    activeId: string | null;
    // 画面风格（drama/prompts.ts 中 ART_STYLES 的 id，或 "custom" 自定义），角色四视图 / 分镜图 / 图生视频三个视觉步骤共用
    artStyle: string;
    // 自定义画风描述（artStyle 为 custom 时生效），要求可观察写法
    customArtStyle: string;
    // 剧本题材卡（drama/prompts.ts 中 GENRE_CARDS 的 id），空字符串表示不指定
    genre: string;
    createProject: (title?: string) => string;
    openProject: (id: string) => void;
    renameProject: (id: string, title: string) => void;
    deleteProject: (id: string) => void;
    updateProject: (id: string, patch: Partial<Omit<DramaProject, "id" | "createdAt">>) => void;
    setArtStyle: (artStyle: string) => void;
    setCustomArtStyle: (customArtStyle: string) => void;
    setGenre: (genre: string) => void;
};

const DRAMA_STORE_KEY = "infinite-canvas:drama_store";

export function newDramaShot(partial?: Partial<Omit<DramaShot, "id">>): DramaShot {
    return { id: nanoid(), description: "", dialogue: "", narration: "", seconds: 5, ...partial };
}

export function createDramaProject(title: string): DramaProject {
    const now = new Date().toISOString();
    return {
        id: nanoid(),
        title: title.trim() || "未命名漫剧",
        createdAt: now,
        updatedAt: now,
        step: 0,
        script: "",
        shots: [],
        characters: [],
        shotImages: {},
        shotVideos: {},
        shotAudios: {},
    };
}

async function resolveMedia(media: DramaMedia, kind: "image" | "media"): Promise<DramaMedia> {
    if (!media.storageKey) return media;
    const url = kind === "image" ? await resolveImageUrl(media.storageKey, media.url) : await resolveMediaUrl(media.storageKey, media.url);
    return { ...media, url };
}

async function hydrateProject(project: DramaProject): Promise<DramaProject> {
    const [shotImages, shotVideos, shotAudios] = await Promise.all([
        Promise.all(Object.entries(project.shotImages || {}).map(async ([id, media]) => [id, await resolveMedia(media, "image")] as const)),
        Promise.all(Object.entries(project.shotVideos || {}).map(async ([id, media]) => [id, await resolveMedia(media, "media")] as const)),
        Promise.all(Object.entries(project.shotAudios || {}).map(async ([id, media]) => [id, await resolveMedia(media, "media")] as const)),
    ]);
    const characters = await Promise.all(
        (project.characters || []).map(async (character) => {
            const candidates = await Promise.all(character.candidates.map((media) => resolveMedia(media, "image")));
            const viewEntries = await Promise.all(
                Object.entries(character.views).map(async ([viewKey, media]) => [viewKey, await resolveMedia(media as DramaMedia, "image")] as const),
            );
            return { ...character, candidates, views: Object.fromEntries(viewEntries) };
        }),
    );
    return {
        ...project,
        shots: project.shots || [],
        characters,
        shotImages: Object.fromEntries(shotImages),
        shotVideos: Object.fromEntries(shotVideos),
        shotAudios: Object.fromEntries(shotAudios),
    };
}

const dramaStorage: PersistStorage<DramaStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<DramaStore>;
        // 旧数据无 artStyle 字段时回落默认，不报错
        parsed.state.artStyle = typeof parsed.state.artStyle === "string" && parsed.state.artStyle.trim() ? parsed.state.artStyle : "default";
        // 旧数据无自定义画风与题材字段时回落空（等价默认画风 / 不指定题材）
        parsed.state.customArtStyle = typeof parsed.state.customArtStyle === "string" ? parsed.state.customArtStyle : "";
        parsed.state.genre = typeof parsed.state.genre === "string" ? parsed.state.genre : "";
        parsed.state.projects = await Promise.all((parsed.state.projects || []).map(hydrateProject));
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useDramaStore = create<DramaStore>()(
    persist(
        (set) => ({
            projects: [],
            activeId: null,
            artStyle: "default",
            customArtStyle: "",
            genre: "",
            createProject: (title) => {
                const project = createDramaProject(title || "");
                set((state) => ({ projects: [project, ...state.projects], activeId: project.id }));
                return project.id;
            },
            openProject: (id) => set({ activeId: id }),
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) =>
                        project.id === id ? { ...project, title: title.trim() || "未命名漫剧", updatedAt: new Date().toISOString() } : project,
                    ),
                })),
            deleteProject: (id) =>
                set((state) => {
                    const projects = state.projects.filter((project) => project.id !== id);
                    return { projects, activeId: state.activeId === id ? projects[0]?.id || null : state.activeId };
                }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
            setArtStyle: (artStyle) => set({ artStyle: artStyle.trim() || "default" }),
            setCustomArtStyle: (customArtStyle) => set({ customArtStyle }),
            setGenre: (genre) => set({ genre }),
        }),
        {
            name: DRAMA_STORE_KEY,
            storage: dramaStorage,
            partialize: (state) => ({ projects: state.projects, activeId: state.activeId, artStyle: state.artStyle, customArtStyle: state.customArtStyle, genre: state.genre }) as StorageValue<DramaStore>["state"],
        },
    ),
);

export function useActiveDramaProject(): DramaProject | null {
    const projects = useDramaStore((state) => state.projects);
    const activeId = useDramaStore((state) => state.activeId);
    return projects.find((project) => project.id === activeId) || projects[0] || null;
}

// 各步骤生成配置的组装：复用 use-config-store 的 effectiveConfig，只切换对应模型字段
export function dramaTextConfig(base: AiConfig): AiConfig {
    return { ...base, model: base.textModel || base.model, activeChannelId: base.textChannelId || base.activeChannelId };
}

export function dramaImageConfig(base: AiConfig): AiConfig {
    return { ...base, model: base.imageModel || base.model, imageModel: base.imageModel || base.model, count: "1" };
}

export function dramaVideoConfig(base: AiConfig): AiConfig {
    return { ...base, model: base.videoModel || base.model, size: base.videoSize };
}

export function dramaAudioConfig(base: AiConfig): AiConfig {
    return { ...base, model: base.audioModel || base.model };
}

export function toReferenceImage(media: DramaMedia, name: string): ReferenceImage {
    return { id: nanoid(), name, type: media.mimeType || "image/png", dataUrl: media.url, url: media.url, storageKey: media.storageKey };
}

// 分镜图参考图：收集所有角色已分配的视图（优先正面），最多 4 张
export function collectCharacterReferences(characters: DramaCharacter[]): ReferenceImage[] {
    const references: ReferenceImage[] = [];
    for (const character of characters) {
        const views = Object.values(character.views).filter(Boolean) as DramaMedia[];
        const picked = character.views.front ? [character.views.front, ...views.filter((view) => view !== character.views.front)] : views;
        const media = picked[0];
        if (media) references.push(toReferenceImage(media, character.name));
    }
    return references.slice(0, 4);
}
