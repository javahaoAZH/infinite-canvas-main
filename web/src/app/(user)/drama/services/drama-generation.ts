import { nanoid } from "nanoid";

import { buildCharacterImagePrompt, buildScriptSystemPrompt, buildShotImagePrompt, buildShotVideoPrompt, classifyShotFrame, resolveArtStyleBase, resolveScenePreset } from "@/app/(user)/drama/prompts";
import { parseStructuredScript, type StructuredCharacter } from "@/app/(user)/drama/services/drama-review";
import { COMFYUI_WORKFLOW_LIP_SYNC_VIDEO, COMFYUI_WORKFLOW_MULTI_REF_VIDEO, isComfyUIWorkflowConfig } from "@/lib/comfyui-workflow";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { requestVideoGeneration } from "@/services/api/video";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { createRenderTask, stageLocalRenderMedia, type RenderTaskResponse, type RenderTimelineSpec } from "@/services/api/render";
import { getMediaBlob, resolveMediaUrl, uploadAssetMediaFile, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, uploadImage } from "@/services/image-storage";
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
    type DramaShot,
} from "@/stores/use-drama-store";
import { normalizeLocalChannels, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceAudio } from "@/types/media";
import { callTextModel } from "./drama-review";

function findProject(projectId: string) {
    return useDramaStore.getState().projects.find((item) => item.id === projectId);
}

function assertImageChannel(config: AiConfig) {
    if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的图片模型渠道");
}

// noobai 系列工作流为纯文生图（服务端无 LoadImage 节点），命中时不能携带参考图走图生图
function isNoobaiTxt2ImgModel(model: string) {
    return model.startsWith("noobai");
}

// 汇总渠道与全局模型列表：优先本地渠道 models，其次 config.models
function channelModelPool(config: AiConfig): string[] {
    return [...normalizeLocalChannels(config).flatMap((channel) => channel.models), ...(config.models || [])];
}

// 立绘/无参考分镜的纯文生图模型挑选：优先 noobai-xl-lora，其次 noobai-xl-vpred，均无则回退当前图片模型
function pickAnimeTxt2ImgModel(config: AiConfig): string {
    const pool = channelModelPool(config);
    if (pool.includes("noobai-xl-lora")) return "noobai-xl-lora";
    if (pool.includes("noobai-xl-vpred")) return "noobai-xl-vpred";
    return config.imageModel;
}

// 带参考分镜的模型挑选：当前图片模型命中 noobai 系（不支持图生图）时改用渠道里的 qwen-image-edit，没有则保持原值
function pickReferenceEditModel(config: AiConfig): string {
    if (!isNoobaiTxt2ImgModel(config.imageModel || config.model)) return config.imageModel;
    return channelModelPool(config).includes("qwen-image-edit") ? "qwen-image-edit" : config.imageModel;
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
    const shots = structured.shots!.map((shot) =>
        newDramaShot({
            description: shot.description!,
            dialogue: shot.dialogue || "",
            narration: shot.narration || "",
            seconds: shot.seconds,
            ...(shot.shotSize ? { shotSize: shot.shotSize } : {}),
            ...(shot.camera ? { camera: shot.camera } : {}),
            ...(shot.transition ? { transition: shot.transition } : {}),
            ...(shot.action ? { action: shot.action } : {}),
            ...(shot.emotion ? { emotion: shot.emotion } : {}),
            ...(shot.imagePrompt ? { imagePrompt: shot.imagePrompt } : {}),
            ...(shot.videoPrompt ? { videoPrompt: shot.videoPrompt } : {}),
            ...(Array.isArray(shot.characters) ? { characters: shot.characters } : {}),
        }),
    );
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
    shots: Array<{
        description?: string;
        dialogue?: string;
        narration?: string;
        seconds?: number;
        shotSize?: string;
        camera?: string;
        transition?: string;
        action?: string;
        emotion?: string;
        characters?: string[];
        imagePrompt?: string;
        videoPrompt?: string;
    }>;
};

export function applyStructuredScript(projectId: string, structured: StructuredScriptInput): { shotCount: number; characterCount: number } {
    const project = findProject(projectId);
    if (!project) throw new Error("漫剧项目不存在");
    if (!structured.shots.length) throw new Error("分镜列表不能为空");
    const characters = mergeCharacters(project.characters, structured.characters || []);
    const shots = structured.shots.map((shot) =>
        newDramaShot({
            description: (shot.description || "").trim(),
            dialogue: (shot.dialogue || "").trim(),
            narration: (shot.narration || "").trim(),
            seconds: clampShotSeconds(shot.seconds),
            // 可选镜头语言字段（A4）与导演字段：空串视为未指定，不写入存储
            ...(shot.shotSize?.trim() ? { shotSize: shot.shotSize.trim() } : {}),
            ...(shot.camera?.trim() ? { camera: shot.camera.trim() } : {}),
            ...(shot.transition?.trim() ? { transition: shot.transition.trim() } : {}),
            ...(shot.action?.trim() ? { action: shot.action.trim() } : {}),
            ...(shot.emotion?.trim() ? { emotion: shot.emotion.trim() } : {}),
            ...(shot.imagePrompt?.trim() ? { imagePrompt: shot.imagePrompt.trim() } : {}),
            ...(shot.videoPrompt?.trim() ? { videoPrompt: shot.videoPrompt.trim() } : {}),
            // 出场角色：显式传数组就原样存（**空数组＝本镜明确无人**，不能丢），未传则不写入、保留描述匹配兜底
            ...(Array.isArray(shot.characters) ? { characters: shot.characters.map((name) => String(name).trim()).filter(Boolean) } : {}),
        }),
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
export type DramaShotPatch = {
    id: string;
    description?: string;
    dialogue?: string;
    narration?: string;
    seconds?: number;
    shotSize?: string;
    camera?: string;
    transition?: string;
    action?: string;
    emotion?: string;
    characters?: string[];
    imagePrompt?: string;
    videoPrompt?: string;
};

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
            ...(typeof patch.shotSize === "string" ? { shotSize: patch.shotSize.trim() || undefined } : {}),
            ...(typeof patch.camera === "string" ? { camera: patch.camera.trim() || undefined } : {}),
            ...(typeof patch.transition === "string" ? { transition: patch.transition.trim() || undefined } : {}),
            ...(typeof patch.action === "string" ? { action: patch.action.trim() || undefined } : {}),
            ...(typeof patch.emotion === "string" ? { emotion: patch.emotion.trim() || undefined } : {}),
            ...(typeof patch.imagePrompt === "string" ? { imagePrompt: patch.imagePrompt.trim() || undefined } : {}),
            ...(typeof patch.videoPrompt === "string" ? { videoPrompt: patch.videoPrompt.trim() || undefined } : {}),
            ...(Array.isArray(patch.characters) ? { characters: patch.characters.map((name) => String(name).trim()).filter(Boolean) } : {}),
        };
    });
    useDramaStore.getState().updateProject(projectId, { shots });
    return { shotCount: shots.length };
}

// 本镜出场角色解析（分镜图与图生视频共用）：分镜表**显式声明**的 characters 为准，
// 空数组＝本镜明确无人，不得兜底塞角色——否则空镜会被角色锚点与立绘参考图带偏、凭空长出人；
// 未声明时回落到描述命中角色名，都无命中再取前 2 个有描述的角色
function resolveShotCharacters(shot: DramaShot, projectCharacters: DramaCharacter[]): DramaCharacter[] {
    const described = projectCharacters.filter((character) => character.description.trim());
    if (Array.isArray(shot.characters)) {
        return shot.characters
            .map((name) => described.find((character) => character.name === String(name).trim()))
            .filter((character): character is DramaCharacter => Boolean(character));
    }
    const matched = described.filter((character) => character.name.trim() && shot.description.includes(character.name.trim())).slice(0, 3);
    return matched.length ? matched : described.slice(0, 2);
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
    // 忙碌登记：供画布实时同步渲染「生成中」占位节点，手动步骤与导演台两条路径共用
    const busyKey = `${projectId}:character:${characterId}`;
    const startedAt = Date.now();
    useDramaStore.getState().setBusyMedia(busyKey, { kind: "character", startedAt });
    try {
        const character = findProject(projectId)?.characters.find((item) => item.id === characterId);
        // 主体不存在时静默返回（手工步骤中角色可能已被删除），不报错不中断批量；director 侧另行标记跳过
        if (!character) return [];
        const description = character.description.trim();
        if (!description) throw new Error(`请先填写「${character.name || "角色"}」的角色描述`);
        // 立绘是纯文生图：浅拷贝覆盖 imageModel 优先走 noobai 系工作流（dramaImageConfig 会同步 model 字段）
        const config = dramaImageConfig({ ...effectiveConfig, imageModel: pickAnimeTxt2ImgModel(effectiveConfig) });
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
        // 成功写回后逐张候选归档到 D 盘项目文件夹（fire-and-forget，失败静默）
        candidates.forEach((candidate, index) => {
            archiveShotMediaToDisk(projectId, candidate.storageKey, `角色立绘-${character.name}-${index + 1}.${mediaExtension(candidate.mimeType || "image/png", "png")}`);
        });
        useDramaStore.getState().clearFailedMedia(busyKey);
        return candidates;
    } catch (error) {
        // 失败登记供画布同步优先展示失败原因；重新抛出保持原有报错行为（B9）
        useDramaStore.getState().setFailedMedia(busyKey, error instanceof Error ? error.message : "立绘生成失败");
        throw error;
    } finally {
        useDramaStore.getState().clearBusyMedia(busyKey, startedAt);
    }
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
    // 忙碌登记：供画布实时同步渲染「生成中」占位节点，手动步骤与导演台两条路径共用
    const busyKey = `${projectId}:shotImage:${shotId}`;
    const startedAt = Date.now();
    useDramaStore.getState().setBusyMedia(busyKey, { kind: "shotImage", startedAt });
    try {
        const project = findProject(projectId);
        const shot = project?.shots.find((item) => item.id === shotId);
        // 主体不存在时静默返回（手工步骤中分镜可能已被删除），保持平移前的旧行为；director 侧另行标记跳过
        if (!shot) return;
        if (!shot.description.trim()) throw new Error("请先在分镜步骤填写画面描述");
        const config = dramaImageConfig(effectiveConfig);
        assertImageChannel(config);
        const state = useDramaStore.getState();
        // 先定本镜出场角色，再据此决定参考图与是否要求立绘：纯空镜不带角色参考图（走纯文生图，避免图生图被人物带偏），也不要求先分配立绘
        const shotCharacters = resolveShotCharacters(shot, state.projects.find((item) => item.id === projectId)?.characters || []);
        const references = collectCharacterReferences(shotCharacters);
        if (shotCharacters.length && !references.length) throw new Error("请先在角色步骤为角色分配立绘视图，否则生成的人物可能不一致");
        const anchors = shotCharacters.map((character) => `${character.name}：${character.description.slice(0, 60)}`);
        const prompt = buildShotImagePrompt(shot.description, resolveArtStyleBase(state.artStyle, state.customArtStyle), classifyShotFrame(shot), resolveScenePreset(useDramaStore.getState().scene), anchors, shot);
        // 分工：无参考纯文生图走 noobai 系；有参考图时 noobai 系工作流无 LoadImage 不支持图生图，强制改用 qwen-image-edit
        const shotConfig = references.length
            ? dramaImageConfig({ ...effectiveConfig, imageModel: pickReferenceEditModel(effectiveConfig) })
            : dramaImageConfig({ ...effectiveConfig, imageModel: pickAnimeTxt2ImgModel(effectiveConfig) });
        const images = references.length ? await requestEdit(shotConfig, prompt, references) : await requestGeneration(shotConfig, prompt);
        const image = images[0];
        if (!image) throw new Error("图片接口没有返回结果");
        const uploaded = await uploadImage(image.dataUrl);
        const current = findProject(projectId);
        useDramaStore.getState().updateProject(projectId, {
            shotImages: { ...(current?.shotImages || {}), [shotId]: { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType } },
        });
        // 成功写入 store 后异步归档到 D 盘项目文件夹（不阻塞主流程、失败静默）
        archiveShotMediaToDisk(projectId, uploaded.storageKey, `分镜图-${shotNumber(projectId, shotId)}.${mediaExtension(uploaded.mimeType || "image/png", "png")}`);
        useDramaStore.getState().clearFailedMedia(busyKey);
    } catch (error) {
        // 失败登记供画布同步优先展示失败原因；重新抛出保持原有报错行为（B9）
        useDramaStore.getState().setFailedMedia(busyKey, error instanceof Error ? error.message : "分镜图生成失败");
        throw error;
    } finally {
        useDramaStore.getState().clearBusyMedia(busyKey, startedAt);
    }
}

// 图生视频：依赖该分镜的分镜图，场景/画风实时读取；进度经 onProgress 回调
export async function generateShotVideo(projectId: string, shotId: string, effectiveConfig: AiConfig, onProgress?: (progress: number) => void): Promise<void> {
    // 忙碌登记：供画布实时同步渲染「生成中」占位节点，手动步骤与导演台两条路径共用；进度仍走 onProgress 回调
    const busyKey = `${projectId}:shotVideo:${shotId}`;
    const startedAt = Date.now();
    useDramaStore.getState().setBusyMedia(busyKey, { kind: "shotVideo", startedAt });
    try {
        const current = findProject(projectId);
        const shot = current?.shots.find((item) => item.id === shotId);
        // 分镜不存在时静默返回（可能被删除）；缺分镜图仍是真实错误，保持报错可重试
        if (!shot) return;
        const shotImage = current?.shotImages[shotId];
        if (!shotImage) throw new Error("请先生成该分镜的分镜图");
        const config = dramaVideoConfig(effectiveConfig);
        if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的视频模型渠道");
        const state = useDramaStore.getState();
        const prompt = buildShotVideoPrompt(shot.description, resolveArtStyleBase(state.artStyle, state.customArtStyle), shot.seconds, resolveScenePreset(useDramaStore.getState().scene), shot);
        // 对白分流：ComfyUI 渠道且本镜对白配音已就绪 → 换对口型工作流（分镜图+音频驱动，无提示词）；其余保持多图参考路径（A2）
        const dialogueAudio = current?.shotAudios[shotId];
        if (dialogueAudio && isComfyUIWorkflowConfig(config, config.model)) {
            const result = await requestVideoGeneration(
                { ...config, model: COMFYUI_WORKFLOW_LIP_SYNC_VIDEO },
                prompt,
                { references: [toReferenceImage(shotImage, "分镜图")], audioReferences: [toReferenceAudio(dialogueAudio, "对白配音")] },
                (progress) => onProgress?.(progress),
            );
            const latest = findProject(projectId);
            useDramaStore.getState().updateProject(projectId, {
                shotVideos: {
                    ...(latest?.shotVideos || {}),
                    [shotId]: { url: result.url, storageKey: result.task.storageKey, width: result.width, height: result.height, durationMs: result.durationMs, mimeType: result.mimeType || "video/mp4" },
                },
            });
            archiveShotMediaToDisk(projectId, result.task.storageKey, `分镜视频-${shotNumber(projectId, shotId)}.${mediaExtension(result.mimeType || "video/mp4", "mp4")}`);
            useDramaStore.getState().clearFailedMedia(busyKey);
            return;
        }
        // 参考数组：分镜图保持第一位作首帧，只追加**本镜出场角色**的立绘参考保障人物一致性（纯空镜不追加，避免被人物带偏）；本地算力流水线只会消费第一张（见 video.ts）
        const references = [
            toReferenceImage(shotImage, "分镜图"),
            ...collectCharacterReferences(resolveShotCharacters(shot, findProject(projectId)?.characters || [])),
        ];
        // ComfyUI 渠道非对白镜固定多图参考工作流（默认视频模型下拉已不含对口型工作流，双保险防误配）
        const videoConfig = isComfyUIWorkflowConfig(config, config.model) ? { ...config, model: COMFYUI_WORKFLOW_MULTI_REF_VIDEO } : config;
        const result = await requestVideoGeneration(videoConfig, prompt, references, (progress) => onProgress?.(progress));
        const latest = findProject(projectId);
        useDramaStore.getState().updateProject(projectId, {
            shotVideos: {
                ...(latest?.shotVideos || {}),
                [shotId]: { url: result.url, storageKey: result.task.storageKey, width: result.width, height: result.height, durationMs: result.durationMs, mimeType: result.mimeType || "video/mp4" },
            },
        });
        // 成功写入 store 后异步归档到 D 盘项目文件夹（不阻塞主流程、失败静默）
        archiveShotMediaToDisk(projectId, result.task.storageKey, `分镜视频-${shotNumber(projectId, shotId)}.${mediaExtension(result.mimeType || "video/mp4", "mp4")}`);
        useDramaStore.getState().clearFailedMedia(busyKey);
    } catch (error) {
        // 失败登记供画布同步优先展示失败原因；重新抛出保持原有报错行为（B9）
        useDramaStore.getState().setFailedMedia(busyKey, error instanceof Error ? error.message : "分镜视频生成失败");
        throw error;
    } finally {
        useDramaStore.getState().clearBusyMedia(busyKey, startedAt);
    }
}

// 配音：对白键 = shot.id，旁白键 = `${shot.id}:narration`，文本实时读取最新分镜
export async function generateVoiceAudio(projectId: string, audioKey: string, effectiveConfig: AiConfig): Promise<void> {
    // 忙碌登记：供画布实时同步渲染「生成中」占位节点，手动步骤与导演台两条路径共用；键含 :narration 后缀
    const busyKey = `${projectId}:audio:${audioKey}`;
    const startedAt = Date.now();
    useDramaStore.getState().setBusyMedia(busyKey, { kind: "audio", startedAt });
    try {
        const isNarration = audioKey.endsWith(":narration");
        const shotId = isNarration ? audioKey.slice(0, -":narration".length) : audioKey;
        const shot = findProject(projectId)?.shots.find((item) => item.id === shotId);
        // 主体不存在时静默返回（手工步骤中分镜可能已被删除）；director 侧另行标记跳过
        if (!shot) return;
        const text = (isNarration ? shot.narration || "" : shot.dialogue).trim();
        if (!text) throw new Error("该分镜没有可配音的对白或旁白");
        const config = dramaAudioConfig(effectiveConfig);
        if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的音频模型渠道");
        const blob = await requestAudioGeneration(config, text, resolveVoiceReference(findProject(projectId), shot, isNarration));
        // ComfyUI 渠道（indextts2）产物需回喂对口型工作流，优先存服务端拿公网地址；其余渠道保持本地存储
        const stored = isComfyUIWorkflowConfig(config, config.model) ? await storeDramaAudioPreferServer(blob) : await storeGeneratedAudio(blob);
        const current = findProject(projectId);
        useDramaStore.getState().updateProject(projectId, {
            shotAudios: { ...(current?.shotAudios || {}), [audioKey]: { url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, mimeType: stored.mimeType, durationMs: stored.durationMs } },
        });
        // 成功写入 store 后异步归档到 D 盘项目文件夹（不阻塞主流程、失败静默）
        archiveShotMediaToDisk(projectId, stored.storageKey, `${isNarration ? "分镜旁白" : "分镜配音"}-${shotNumber(projectId, shotId)}.${mediaExtension(stored.mimeType || "audio/mpeg", "mp3")}`);
        useDramaStore.getState().clearFailedMedia(busyKey);
    } catch (error) {
        // 失败登记供画布同步优先展示失败原因；重新抛出保持原有报错行为（B9）
        useDramaStore.getState().setFailedMedia(busyKey, error instanceof Error ? error.message : "配音生成失败");
        throw error;
    } finally {
        useDramaStore.getState().clearBusyMedia(busyKey, startedAt);
    }
}

// 配音音色参考：旁白用项目级默认；对白优先描述中命中的角色自己的音色参考，其次首个有声色参考的角色，再回退旁白音色；都没有返回 undefined（非 comfyui TTS 不受影响）
function resolveVoiceReference(project: ReturnType<typeof findProject>, shot: { dialogue: string }, isNarration: boolean): ReferenceAudio | undefined {
    if (!project) return undefined;
    if (isNarration) return project.narratorVoiceRef ? toReferenceAudio(project.narratorVoiceRef, "旁白音色") : undefined;
    const matched = project.characters.find((character) => character.name.trim() && shot.dialogue.includes(character.name.trim()) && character.voiceRef);
    const media = matched?.voiceRef || project.characters.find((character) => character.voiceRef)?.voiceRef || project.narratorVoiceRef;
    return media ? toReferenceAudio(media, "音色参考") : undefined;
}

function toReferenceAudio(media: DramaMedia, name: string): ReferenceAudio {
    return { id: nanoid(), name, type: media.mimeType || "audio/wav", url: media.url, storageKey: media.storageKey, durationMs: media.durationMs };
}

// 服务端存储可用时存服务端（对口型工作流的音频入参需公网地址），不可用或失败回退本地存储不阻塞主流程
async function storeDramaAudioPreferServer(blob: Blob): Promise<UploadedFile> {
    try {
        const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/wav" });
        return await uploadAssetMediaFile(new File([audio], `drama-voice-${nanoid()}.wav`, { type: audio.type }), "drama-audio");
    } catch {
        return storeGeneratedAudio(blob);
    }
}

// 按 storageKey 前缀读本地 blob（归档用）
async function readLocalBlob(storageKey: string) {
    try {
        return storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    } catch {
        return null;
    }
}

// 归档文件名的扩展名：按 mimeType 映射，其余回退传入值
function mediaExtension(mimeType: string, fallback: string) {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "audio/wav") return "wav";
    return fallback;
}

// 归档文件名的镜头序号 = 分镜在全部分镜列表中的位置（1 起）
function shotNumber(projectId: string, shotId: string) {
    return (findProject(projectId)?.shots.findIndex((shot) => shot.id === shotId) ?? -1) + 1;
}

// 单产物归档到 D 盘项目文件夹（fire-and-forget）：已登录且本地能取到 blob 才上传，失败静默不影响主流程
function archiveShotMediaToDisk(projectId: string, storageKey: string | undefined, filename: string) {
    const token = useUserStore.getState().token;
    const project = findProject(projectId);
    if (!token || !project || !storageKey) return;
    void (async () => {
        try {
            const blob = await readLocalBlob(storageKey);
            if (!blob) return;
            await stageLocalRenderMedia(token, blob, project.title, filename);
        } catch {
            // 归档失败静默，不影响生成主流程
        }
    })();
}

// 一键成片服务（voice-step 薄壳与 Qoder 通道共用）：登录校验 → 按 shotsWithVideo 过滤 →
// blob: 本地媒体经暂存上传换成 file: 源 → 组装 RenderTimelineSpec → createRenderTask
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
    const staging: Array<() => Promise<void>> = [];
    // blob: 本地媒体：按 storageKey 取 blob 暂存到 D 盘项目文件夹，用返回的 file: 源替换；取不到 blob 才报错
    const stageLocalBlob = (storageKey: string | undefined, filename: string, apply: (source: string) => void) => {
        staging.push(async () => {
            const blob = storageKey ? await readLocalBlob(storageKey) : null;
            if (!blob) throw new Error("本地媒体缓存已失效，请重新生成");
            apply(await stageLocalRenderMedia(token, blob, project.title, filename));
        });
    };
    for (const shot of shotsWithVideo) {
        const video = project.shotVideos[shot.id];
        const videoUrl = await resolveMediaUrl(video.storageKey, video.url);
        // 服务端对象存储媒体直接传 storageKey，成片引擎经 DownloadStorageObject 读取，避免外链鉴权/跨域问题
        const videoSource = typeof video.storageKey === "string" && video.storageKey.startsWith("server:") ? video.storageKey : videoUrl;
        const shotNo = project.shots.findIndex((item) => item.id === shot.id) + 1;
        const videoItem = { kind: "video" as const, source: videoSource };
        items.push(videoItem);
        if (videoItem.source.startsWith("blob:")) stageLocalBlob(video.storageKey, `分镜视频-${shotNo}.${mediaExtension(video.mimeType || "video/mp4", "mp4")}`, (source) => { videoItem.source = source; });
        if (video.width && video.height) ({ width, height } = { width: video.width, height: video.height });
        for (const key of [shot.id, `${shot.id}:narration`]) {
            const audio = project.shotAudios[key];
            if (!audio) continue;
            const audioUrl = await resolveMediaUrl(audio.storageKey, audio.url);
            const audioSource = typeof audio.storageKey === "string" && audio.storageKey.startsWith("server:") ? audio.storageKey : audioUrl;
            const audioItem = { kind: "audio" as const, source: audioSource, durationMs: audio.durationMs || Math.max(1000, Math.round((shot.seconds || 5) * 1000)) };
            items.push(audioItem);
            if (audioItem.source.startsWith("blob:")) stageLocalBlob(audio.storageKey, `${key.endsWith(":narration") ? "分镜旁白" : "分镜配音"}-${shotNo}.${mediaExtension(audio.mimeType || "audio/mpeg", "mp3")}`, (source) => { audioItem.source = source; });
        }
    }
    // 本地媒体暂存上传并发限 2，全部换成 file: 源后再提交成片任务
    for (let index = 0; index < staging.length; index += 2) {
        await Promise.all(staging.slice(index, index + 2).map((job) => job()));
    }
    return createRenderTask(token, { fps: 30, width, height, folder: project.title, items });
}
