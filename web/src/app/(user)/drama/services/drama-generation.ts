import { nanoid } from "nanoid";

import { buildCharacterImagePrompt, buildScriptSystemPrompt, buildShotImagePrompt, buildShotVideoPrompt, classifyShotFrame, resolveArtStyleBase, resolveScenePreset } from "@/app/(user)/drama/prompts";
import { parseStructuredScript, type StructuredCharacter } from "@/app/(user)/drama/services/drama-review";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { requestVideoGeneration } from "@/services/api/video";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { createRenderTask, type RenderTaskResponse, type RenderTimelineSpec } from "@/services/api/render";
import { resolveMediaUrl } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import {
    collectCharacterReferences,
    dramaAudioConfig,
    dramaImageConfig,
    dramaVideoConfig,
    newDramaShot,
    toReferenceImage,
    useDramaStore,
    type DramaCharacter,
    type DramaMedia,
} from "@/stores/use-drama-store";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { callTextModel } from "./drama-review";

function findProject(projectId: string) {
    return useDramaStore.getState().projects.find((item) => item.id === projectId);
}

function assertImageChannel(config: AiConfig) {
    if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的图片模型渠道");
}

// 剧本结构化：文本模型结构化出分镜与角色，并清空三张媒体表（与手动步骤行为一致）
export async function structureScript(projectId: string, effectiveConfig: AiConfig): Promise<{ shotsCount: number; charactersCount: number }> {
    const project = findProject(projectId);
    if (!project) throw new Error("漫剧项目不存在");
    const script = project.script.trim();
    if (!script) throw new Error("请先输入或粘贴剧本内容");
    const genre = useDramaStore.getState().genre;
    const content = await callTextModel(buildScriptSystemPrompt(genre), script, effectiveConfig);
    const structured = parseStructuredScript(content);
    const characters = mergeCharacters(project.characters, structured.characters || []);
    const shots = structured.shots!.map((shot) => newDramaShot({ description: shot.description!, dialogue: shot.dialogue || "", narration: shot.narration || "", seconds: shot.seconds }));
    useDramaStore.getState().updateProject(projectId, {
        shots,
        characters,
        shotImages: {},
        shotVideos: {},
        shotAudios: {},
        ...(structured.title && !project.title.trim() ? { title: structured.title } : {}),
    });
    return { shotsCount: shots.length, charactersCount: characters.length };
}

// Qoder 大脑结构化直写入口（不经文本模型）：语义与 structureScript 成功路径一致——
// newDramaShot 构建、seconds 钳 1-30、同名角色 mergeCharacters 保留已有立绘/视图、清空三张媒体表、title 仅在原 title 为空时回填
export type StructuredScriptInput = {
    title?: string;
    characters?: Array<{ name?: string; description?: string }>;
    shots: Array<{ description?: string; dialogue?: string; narration?: string; seconds?: number }>;
};

export function applyStructuredScript(projectId: string, structured: StructuredScriptInput): { shotCount: number; characterCount: number } {
    const project = findProject(projectId);
    if (!project) throw new Error("漫剧项目不存在");
    if (!structured.shots.length) throw new Error("分镜列表不能为空");
    const characters = mergeCharacters(project.characters, structured.characters || []);
    const shots = structured.shots.map((shot) =>
        newDramaShot({ description: (shot.description || "").trim(), dialogue: (shot.dialogue || "").trim(), narration: (shot.narration || "").trim(), seconds: clampShotSeconds(shot.seconds) }),
    );
    useDramaStore.getState().updateProject(projectId, {
        shots,
        characters,
        shotImages: {},
        shotVideos: {},
        shotAudios: {},
        ...(structured.title && !project.title.trim() ? { title: structured.title } : {}),
    });
    return { shotCount: shots.length, characterCount: characters.length };
}

// 按分镜 id 部分更新（审查检测 → 修复 → 回写闭环用）：只覆盖传入字段，秒数钳 1-30；
// 不动未提及分镜、不清空三张媒体表、保留已有媒体关联；id 不存在时报错列出无效 id
export type DramaShotPatch = { id: string; description?: string; dialogue?: string; narration?: string; seconds?: number };

export function updateDramaShots(projectId: string, patches: DramaShotPatch[]): { shotCount: number } {
    const project = findProject(projectId);
    if (!project) throw new Error("漫剧项目不存在");
    if (!patches.length) throw new Error("分镜更新列表不能为空");
    const invalid = patches.map((patch) => patch.id).filter((id) => !project.shots.some((shot) => shot.id === id));
    if (invalid.length) throw new Error(`以下分镜 id 不存在：${invalid.join("、")}`);
    const patchById = new Map(patches.map((patch) => [patch.id, patch]));
    const shots = project.shots.map((shot) => {
        const patch = patchById.get(shot.id);
        if (!patch) return shot;
        return {
            ...shot,
            ...(typeof patch.description === "string" ? { description: patch.description } : {}),
            ...(typeof patch.dialogue === "string" ? { dialogue: patch.dialogue } : {}),
            ...(typeof patch.narration === "string" ? { narration: patch.narration } : {}),
            ...(patch.seconds !== undefined ? { seconds: clampShotSeconds(patch.seconds) } : {}),
        };
    });
    useDramaStore.getState().updateProject(projectId, { shots });
    return { shotCount: shots.length };
}

// 分镜秒数钳 1-30（非法/缺失回退 5），applyStructuredScript 与 updateDramaShots 共用
function clampShotSeconds(value: unknown): number {
    const seconds = Math.round(Number(value));
    if (!Number.isFinite(seconds)) return 5;
    return Math.max(1, Math.min(30, seconds));
}

// 同名角色保留已生成的立绘与视图分配，其余按 AI 结果重建
function mergeCharacters(existing: DramaCharacter[], incoming: StructuredCharacter[]): DramaCharacter[] {
    const merged: DramaCharacter[] = [];
    const used = new Set<string>();
    for (const item of incoming) {
        const name = (item.name || "").trim() || `角色 ${merged.length + 1}`;
        const previous = existing.find((character) => !used.has(character.id) && character.name === name);
        if (previous) {
            used.add(previous.id);
            merged.push({ ...previous, description: (item.description || "").trim() || previous.description });
        } else {
            merged.push({ id: nanoid(), name, description: (item.description || "").trim(), candidates: [], views: {} });
        }
    }
    return merged;
}

// 角色立绘候选：count 张并行生成（allSettled 收集，全失败才报错），结果写入 character.candidates
export async function generateCharacterCandidates(projectId: string, characterId: string, effectiveConfig: AiConfig, count = 4): Promise<DramaMedia[]> {
    const character = findProject(projectId)?.characters.find((item) => item.id === characterId);
    // 主体不存在时静默返回（手工步骤中角色可能已被删除），不报错不中断批量；director 侧另行标记跳过
    if (!character) return [];
    const description = character.description.trim();
    if (!description) throw new Error(`请先填写「${character.name || "角色"}」的角色描述`);
    const config = dramaImageConfig(effectiveConfig);
    assertImageChannel(config);
    const state = useDramaStore.getState();
    const prompt = buildCharacterImagePrompt(description, resolveArtStyleBase(state.artStyle, state.customArtStyle), resolveScenePreset(state.scene));
    const results = await Promise.allSettled(Array.from({ length: count }, () => requestGeneration(config, prompt)));
    const generated = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (!generated.length) {
        const reason = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
        throw new Error(reason instanceof Error ? reason.message : "立绘生成失败，请检查图片渠道配置后重试");
    }
    const candidates = await Promise.all(
        generated.map(async (image) => {
            const uploaded = await uploadImage(image.dataUrl);
            return { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType };
        }),
    );
    const current = findProject(projectId);
    useDramaStore.getState().updateProject(projectId, { characters: (current?.characters || []).map((item) => (item.id === characterId ? { ...item, candidates } : item)) });
    return candidates;
}

// 自动分配视图：把首选立绘（candidates[0]）分配到 front 视图，解锁分镜图角色参考
export function autoAssignViews(projectId: string, characterId: string) {
    const character = findProject(projectId)?.characters.find((item) => item.id === characterId);
    const preferred = character?.candidates[0];
    if (!character || !preferred || character.views.front?.url === preferred.url) return;
    const current = findProject(projectId);
    useDramaStore.getState().updateProject(projectId, {
        characters: (current?.characters || []).map((item) => (item.id === characterId ? { ...item, views: { ...item.views, front: preferred } } : item)),
    });
}

// 分镜图：有角色视图参考走图生图，否则文生图；角色锚点与画风/场景均实时读取最新状态
export async function generateShotImage(projectId: string, shotId: string, effectiveConfig: AiConfig): Promise<void> {
    const project = findProject(projectId);
    const shot = project?.shots.find((item) => item.id === shotId);
    // 主体不存在时静默返回（手工步骤中分镜可能已被删除），保持平移前的旧行为；director 侧另行标记跳过
    if (!shot) return;
    if (!shot.description.trim()) throw new Error("请先在分镜步骤填写画面描述");
    const config = dramaImageConfig(effectiveConfig);
    assertImageChannel(config);
    const state = useDramaStore.getState();
    const references = collectCharacterReferences(state.projects.find((item) => item.id === projectId)?.characters || []);
    // 本镜出场角色锚点：描述中命中角色名的优先，无命中取前 2 个有描述的角色，各取描述前 60 字
    const characters = (state.projects.find((item) => item.id === projectId)?.characters || []).filter((character) => character.description.trim());
    const matched = characters.filter((character) => character.name.trim() && shot.description.includes(character.name.trim())).slice(0, 3);
    const anchors = (matched.length ? matched : characters.slice(0, 2)).map((character) => `${character.name}：${character.description.slice(0, 60)}`);
    const prompt = buildShotImagePrompt(shot.description, resolveArtStyleBase(state.artStyle, state.customArtStyle), classifyShotFrame(shot), resolveScenePreset(useDramaStore.getState().scene), anchors);
    const images = references.length ? await requestEdit(config, prompt, references) : await requestGeneration(config, prompt);
    const image = images[0];
    if (!image) throw new Error("图片接口没有返回结果");
    const uploaded = await uploadImage(image.dataUrl);
    const current = findProject(projectId);
    useDramaStore.getState().updateProject(projectId, {
        shotImages: { ...(current?.shotImages || {}), [shotId]: { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType } },
    });
}

// 图生视频：依赖该分镜的分镜图，场景/画风实时读取；进度经 onProgress 回调
export async function generateShotVideo(projectId: string, shotId: string, effectiveConfig: AiConfig, onProgress?: (progress: number) => void): Promise<void> {
    const current = findProject(projectId);
    const shot = current?.shots.find((item) => item.id === shotId);
    // 分镜不存在时静默返回（可能被删除）；缺分镜图仍是真实错误，保持报错可重试
    if (!shot) return;
    const shotImage = current?.shotImages[shotId];
    if (!shotImage) throw new Error("请先生成该分镜的分镜图");
    const config = dramaVideoConfig(effectiveConfig);
    if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的视频模型渠道");
    const state = useDramaStore.getState();
    const prompt = buildShotVideoPrompt(shot.description, resolveArtStyleBase(state.artStyle, state.customArtStyle), shot.seconds, resolveScenePreset(useDramaStore.getState().scene));
    const result = await requestVideoGeneration(config, prompt, [toReferenceImage(shotImage, "分镜图")], (progress) => onProgress?.(progress));
    const latest = findProject(projectId);
    useDramaStore.getState().updateProject(projectId, {
        shotVideos: {
            ...(latest?.shotVideos || {}),
            [shotId]: { url: result.url, storageKey: result.task.storageKey, width: result.width, height: result.height, durationMs: result.durationMs, mimeType: result.mimeType || "video/mp4" },
        },
    });
}

// 配音：对白键 = shot.id，旁白键 = `${shot.id}:narration`，文本实时读取最新分镜
export async function generateVoiceAudio(projectId: string, audioKey: string, effectiveConfig: AiConfig): Promise<void> {
    const isNarration = audioKey.endsWith(":narration");
    const shotId = isNarration ? audioKey.slice(0, -":narration".length) : audioKey;
    const shot = findProject(projectId)?.shots.find((item) => item.id === shotId);
    // 主体不存在时静默返回（手工步骤中分镜可能已被删除）；director 侧另行标记跳过
    if (!shot) return;
    const text = (isNarration ? shot.narration || "" : shot.dialogue).trim();
    if (!text) throw new Error("该分镜没有可配音的对白或旁白");
    const config = dramaAudioConfig(effectiveConfig);
    if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的音频模型渠道");
    const blob = await requestAudioGeneration(config, text);
    const stored = await storeGeneratedAudio(blob);
    const current = findProject(projectId);
    useDramaStore.getState().updateProject(projectId, {
        shotAudios: { ...(current?.shotAudios || {}), [audioKey]: { url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, mimeType: stored.mimeType, durationMs: stored.durationMs } },
    });
}

// 一键成片服务（voice-step 薄壳与 Qoder 通道共用）：登录校验 → 按 shotsWithVideo 过滤 →
// blob: 媒体拒绝 → 组装 RenderTimelineSpec → createRenderTask（行为与原 voice-step 内联实现一致）
export async function createDramaRender(projectId: string): Promise<RenderTaskResponse> {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("成片需要登录账号");
    const project = findProject(projectId);
    if (!project) throw new Error("漫剧项目不存在");
    const shotsWithVideo = project.shots.filter((shot) => project.shotVideos[shot.id]);
    if (!shotsWithVideo.length) throw new Error("请先生成至少一个分镜视频");
    const items: RenderTimelineSpec["items"] = [];
    let width = 1280;
    let height = 720;
    for (const shot of shotsWithVideo) {
        const video = project.shotVideos[shot.id];
        const videoUrl = await resolveMediaUrl(video.storageKey, video.url);
        if (videoUrl.startsWith("blob:")) throw new Error("分镜视频保存在本地浏览器中，请登录并重新生成视频后再一键成片");
        if (video.width && video.height) ({ width, height } = { width: video.width, height: video.height });
        items.push({ kind: "video", source: videoUrl });
        for (const key of [shot.id, `${shot.id}:narration`]) {
            const audio = project.shotAudios[key];
            if (!audio) continue;
            const audioUrl = await resolveMediaUrl(audio.storageKey, audio.url);
            if (audioUrl.startsWith("blob:")) throw new Error("分镜配音保存在本地浏览器中，请登录并重新生成配音后再一键成片");
            items.push({ kind: "audio", source: audioUrl, durationMs: audio.durationMs || Math.max(1000, Math.round((shot.seconds || 5) * 1000)) });
        }
    }
    return createRenderTask(token, { fps: 30, width, height, items });
}
