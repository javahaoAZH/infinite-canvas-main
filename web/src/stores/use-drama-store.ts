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

export type DramaAssetRef = {
    key: string;
    purpose: string;
    variant?: string;
    files?: string[];
    referenceRole?: "身份" | "结构" | "姿态构图" | "场景空间" | "道具结构" | "风格" | "特效合成" | "声音";
    referencePriority?: "主参考" | "辅助参考";
};

export type DramaPlannedAsset = {
    key: string;
    category: "角色" | "场景" | "道具" | "生物" | "特效" | "图形" | "声音" | "风格";
    name: string;
    layer: "身份母版" | "状态变体" | "表演动作" | "空间布局" | "合成层";
    factLevel: "原文明确" | "原文推断" | "改编设计";
    sourceEvidence: string;
    specification: string;
    lock: string;
    deliverables: string[];
    dependencies: string[];
    priority: "P0" | "P1" | "P2" | "P3";
    referenceRole?: DramaAssetRef["referenceRole"];
    generationPrompt?: string;
    avoidPrompt?: string;
    reviewCriteria?: string[];
};

export type DramaSourceCoverage = {
    quote: string;
    disposition: "画面" | "对白" | "旁白" | "音效" | "合并" | "暂不采用";
    shotNumbers: number[];
    note?: string;
};

export type DramaShot = {
    id: string;
    description: string;
    dialogue: string;
    // 可选旁白画外音（VO），旧数据可能缺失
    narration?: string;
    // 可选镜头语言字段（旧数据可能缺失）：景别 / 运镜 / 转场，参与分镜图与视频提示词拼接（A4）
    shotSize?: string;
    camera?: string;
    transition?: string;
    // 可选导演字段（制作分镜表标准，旧数据可能缺失）：动作与情绪进提示词，出场角色用于精确锚点注入，
    // 出图/图生视频提示词非空时覆盖提示词的内容段（画风基底与一致性约束仍由项目级统一拼接）
    action?: string;
    emotion?: string;
    characters?: string[];
    imagePrompt?: string;
    videoPrompt?: string;
    // 小说证据与制作连续性：审查器据此检查是否误读、漏拍或把改编设计冒充原文事实
    sourceEvidence?: string;
    location?: string;
    storyTime?: string;
    shotPurpose?: string;
    startState?: string;
    endState?: string;
    continuity?: string;
    // 每镜可人工核对的通过条件，必须覆盖人物、资产、空间、动作/特效与连续性中的本镜风险点
    qualityCriteria?: string;
    assetRefs?: DramaAssetRef[];
    seconds: number;
};

export type DramaCharacter = {
    id: string;
    name: string;
    description: string;
    candidates: DramaMedia[];
    views: Partial<Record<CharacterViewKind, DramaMedia>>;
    assetId?: string;
    // 配音音色参考音频（IndexTTS2 音色克隆用），需公网可访问地址
    voiceRef?: DramaMedia;
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
    // 旁白默认音色参考音频（对白优先用出场角色自己的音色参考）
    narratorVoiceRef?: DramaMedia;
    // 关联的生产线画布项目（实时同步用）；首次同步时创建并回填
    canvasProjectId?: string;
    // 绑定的资产清单项目文件夹名（D 盘项目文件夹/资产清单.json）；缺省用项目标题
    assetProject?: string;
    // 剧本拆解得到的待生产资产圣经；分集导出时与磁盘清单按 key/分类/名称合并，不覆盖已确认版本
    plannedAssets?: DramaPlannedAsset[];
    sourceCoverage?: DramaSourceCoverage[];
    // 用户已逐项核对通过的代表关键帧；对应分镜图一旦重生成或重新注入必须移除确认
    keyframeApprovals?: string[];
    // 资产清单发生可影响生产门禁的变更时递增；用于低成本刷新远端开工检查，避免随每次分镜输入重复请求。
    assetRevision?: number;
    episode?: string;
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
    // 场景/世界观预设（drama/prompts.ts 中 SCENE_PRESETS 的 id），空字符串表示不指定，角色四视图 / 分镜图 / 图生视频三个视觉步骤共用
    scene: string;
    // 媒体生成忙碌登记（不持久化）：key 为 `${projectId}:${kind}:${subjectId}`，kind 取 character/shotImage/shotVideo/audio；供画布实时同步渲染「生成中」占位节点
    busyMedia: Record<string, { kind: string; startedAt: number }>;
    setBusyMedia: (key: string, value: { kind: string; startedAt: number }) => void;
    // startedAt 可选：传入时仅当登记值一致才清除，防并发重入误清新登记；不传则照旧按键清除
    clearBusyMedia: (key: string, startedAt?: number) => void;
    // 媒体生成失败登记（不持久化，不进 partialize）：key 与 busyMedia 同格式；手动步骤/导演台生成失败时写入，画布同步优先读取展示失败原因
    failedMedia: Record<string, { error: string; at: number }>;
    setFailedMedia: (key: string, error: string) => void;
    clearFailedMedia: (key: string) => void;
    createProject: (title?: string) => string;
    openProject: (id: string) => void;
    renameProject: (id: string, title: string) => void;
    deleteProject: (id: string) => void;
    updateProject: (id: string, patch: Partial<Omit<DramaProject, "id" | "createdAt">>) => void;
    setArtStyle: (artStyle: string) => void;
    setCustomArtStyle: (customArtStyle: string) => void;
    setGenre: (genre: string) => void;
    setScene: (scene: string) => void;
};

const DRAMA_STORE_KEY = "infinite-canvas:drama_store";

export function newDramaShot(partial?: Partial<Omit<DramaShot, "id">>): DramaShot {
    return { id: nanoid(), description: "", dialogue: "", narration: "", characters: [], assetRefs: [], seconds: 5, ...partial };
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
        plannedAssets: [],
        sourceCoverage: [],
        keyframeApprovals: [],
        assetRevision: 0,
        episode: "ep01",
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
            return { ...character, candidates, views: Object.fromEntries(viewEntries), ...(character.voiceRef ? { voiceRef: await resolveMedia(character.voiceRef, "media") } : {}) };
        }),
    );
    return {
        ...project,
        shots: project.shots || [],
        characters,
        shotImages: Object.fromEntries(shotImages),
        shotVideos: Object.fromEntries(shotVideos),
        shotAudios: Object.fromEntries(shotAudios),
        ...(project.narratorVoiceRef ? { narratorVoiceRef: await resolveMedia(project.narratorVoiceRef, "media") } : {}),
    };
}

const dramaStorage: PersistStorage<DramaStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<DramaStore>;
        // 旧数据无 artStyle 字段时回落默认，不报错
        parsed.state.artStyle = typeof parsed.state.artStyle === "string" && parsed.state.artStyle.trim() ? parsed.state.artStyle : "default";
        // 旧数据无自定义画风、题材与场景字段时回落空（等价默认画风 / 不指定题材 / 不指定场景）
        parsed.state.customArtStyle = typeof parsed.state.customArtStyle === "string" ? parsed.state.customArtStyle : "";
        parsed.state.genre = typeof parsed.state.genre === "string" ? parsed.state.genre : "";
        parsed.state.scene = typeof parsed.state.scene === "string" ? parsed.state.scene : "";
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
            scene: "",
            busyMedia: {},
            setBusyMedia: (key, value) => set((state) => ({ busyMedia: { ...state.busyMedia, [key]: value } })),
            clearBusyMedia: (key, startedAt) =>
                set((state) => {
                    const registered = state.busyMedia[key];
                    if (!registered) return state;
                    // 登记值比对：并发重入时新登记会覆盖旧值，旧的 finally 不应误清新登记；仅登记时间一致才删，不一致返回原状态（重新登记则重新写入，避免重复删除导致状态对象异常变动）
                    if (startedAt !== undefined && registered.startedAt !== startedAt) return state;
                    const busyMedia = { ...state.busyMedia };
                    delete busyMedia[key];
                    return { busyMedia };
                }),
            failedMedia: {},
            setFailedMedia: (key, error) => set((state) => ({ failedMedia: { ...state.failedMedia, [key]: { error, at: Date.now() } } })),
            clearFailedMedia: (key) =>
                set((state) => {
                    if (!(key in state.failedMedia)) return state;
                    const failedMedia = { ...state.failedMedia };
                    delete failedMedia[key];
                    return { failedMedia };
                }),
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
            setScene: (scene) => set({ scene }),
        }),
        {
            name: DRAMA_STORE_KEY,
            storage: dramaStorage,
            partialize: (state) => ({ projects: state.projects, activeId: state.activeId, artStyle: state.artStyle, customArtStyle: state.customArtStyle, genre: state.genre, scene: state.scene }) as StorageValue<DramaStore>["state"],
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

// 分镜图参考图：每名角色取一张已分配视图（优先正面）；不静默截断，避免多人镜漏掉后排角色身份参考
export function collectCharacterReferences(characters: DramaCharacter[]): ReferenceImage[] {
    const references: ReferenceImage[] = [];
    for (const character of characters) {
        const views = Object.values(character.views).filter(Boolean) as DramaMedia[];
        const picked = character.views.front ? [character.views.front, ...views.filter((view) => view !== character.views.front)] : views;
        const media = picked[0];
        if (media) references.push(toReferenceImage(media, character.name));
    }
    return references;
}
