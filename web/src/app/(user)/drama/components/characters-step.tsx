"use client";

import { ArrowUpRight, Boxes, Library, Mic, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { App, Button, Empty, Image, Input, Select, Tag } from "antd";
import { nanoid } from "nanoid";

import { ART_STYLES, CUSTOM_ART_STYLE_ID, SCENE_PRESETS } from "@/app/(user)/drama/prompts";
import { generateCharacterCandidates } from "@/app/(user)/drama/services/drama-generation";
import { uploadAssetMediaFile } from "@/services/file-storage";
import {
    addCharacterAsset,
    CHARACTER_VIEW_LABELS,
    CHARACTER_VIEW_ORDER,
    type CharacterViewKind,
    type CharacterViewMap,
} from "@/stores/use-asset-store";
import { dramaImageConfig, useDramaStore, type DramaCharacter, type DramaMedia, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";

const CANDIDATE_COUNT = 4;

export function CharactersStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateProject = useDramaStore((state) => state.updateProject);
    const artStyle = useDramaStore((state) => state.artStyle);
    const setArtStyle = useDramaStore((state) => state.setArtStyle);
    const customArtStyle = useDramaStore((state) => state.customArtStyle);
    const setCustomArtStyle = useDramaStore((state) => state.setCustomArtStyle);
    const scene = useDramaStore((state) => state.scene);
    const setScene = useDramaStore((state) => state.setScene);
    const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
    const [voiceBusyIds, setVoiceBusyIds] = useState<Record<string, boolean>>({});

    const patchCharacter = (id: string, patch: Partial<DramaCharacter>, invalidateKeyframes = true) => {
        updateProject(project.id, {
            characters: project.characters.map((character) => (character.id === id ? { ...character, ...patch } : character)),
            ...(invalidateKeyframes ? { keyframeApprovals: [] } : {}),
        });
    };

    const generateCandidates = async (character: DramaCharacter) => {
        const description = character.description.trim();
        if (!description) return message.warning(`请先填写「${character.name || "角色"}」的角色描述`);
        const config = dramaImageConfig(effectiveConfig);
        if (!isAiConfigReady(config, config.model)) return message.warning("请先在设置中配置可用的图片模型渠道");
        setBusyIds((current) => ({ ...current, [character.id]: true }));
        try {
            const candidates = await generateCharacterCandidates(project.id, character.id, effectiveConfig, CANDIDATE_COUNT);
            message.success(`「${character.name}」生成了 ${candidates.length} 张立绘，点击按钮分配到视图`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "立绘生成失败，可重试");
        } finally {
            setBusyIds((current) => ({ ...current, [character.id]: false }));
        }
    };

    const assignView = (character: DramaCharacter, media: DramaMedia, viewKey: CharacterViewKind) => {
        const views = { ...character.views };
        if (views[viewKey]?.url === media.url) delete views[viewKey];
        else views[viewKey] = media;
        patchCharacter(character.id, { views });
    };

    // 音色参考音频上传：走服务端存储拿公网地址（indextts2 克隆入参要求），成功后写入角色/项目（A2）
    const uploadVoiceRef = async (target: string, file: File, apply: (media: DramaMedia) => void) => {
        if (!file.type.startsWith("audio/")) return message.warning("请上传音频文件（mp3 / wav / m4a）");
        setVoiceBusyIds((current) => ({ ...current, [target]: true }));
        try {
            const uploaded = await uploadAssetMediaFile(file, "drama-voice-ref");
            apply({ url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, durationMs: uploaded.durationMs });
            message.success("音色参考已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "音色参考上传失败");
        } finally {
            setVoiceBusyIds((current) => ({ ...current, [target]: false }));
        }
    };

    const saveToLibrary = (character: DramaCharacter) => {
        const views: CharacterViewMap = {};
        CHARACTER_VIEW_ORDER.forEach((viewKey) => {
            const view = character.views[viewKey];
            if (view?.url) views[viewKey] = view.storageKey ? { url: view.url, storageKey: view.storageKey } : { url: view.url };
        });
        if (!Object.keys(views).length) return message.warning("请先为角色分配至少一张视图");
        const assetId = addCharacterAsset({
            name: character.name || "未命名角色",
            description: character.description,
            views,
            source: "drama",
            tags: ["漫剧"],
        });
        updateProject(project.id, { characters: project.characters.map((item) => (item.id === character.id ? { ...item, assetId } : item)) });
        message.success(`「${character.name}」已保存到角色库`);
    };

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4">
            <section className="border border-border bg-card/55 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Boxes className="size-4" />本集资产生产单</div>
                        <p className="mt-1 text-xs text-muted-foreground">角色四视图只锁身份；状态、动作、场景、道具、特效和组合关系都必须按独立资产交付。</p>
                    </div>
                    <Button href={`/assets?tab=project&project=${encodeURIComponent(project.assetProject || project.title)}`} icon={<ArrowUpRight className="size-4" />}>进入资产清单确认版本</Button>
                </div>
                <div className="mt-3 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                    {(project.plannedAssets || []).map((asset) => (
                        <div key={asset.key} className="bg-card p-3">
                            <div className="flex items-center gap-1.5"><span className="truncate text-xs font-medium text-foreground">{asset.name}</span><Tag className="m-0 ml-auto">{asset.priority}</Tag></div>
                            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{asset.key}</div>
                            <div className="mt-2 flex flex-wrap gap-1"><Tag className="m-0">{asset.category}</Tag><Tag className="m-0">{asset.layer}</Tag><Tag className="m-0">{asset.factLevel}</Tag></div>
                            <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{asset.deliverables.join("、")}</div>
                        </div>
                    ))}
                    {!project.plannedAssets?.length ? <div className="bg-card p-4 text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">资产圣经为空，请返回生产规划补齐。</div> : null}
                </div>
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                    下方只管理角色身份母版。先确认脸型、发型、身材与基础服装，再到资产清单完成其余派生资产；任何未确认文件都会阻断分镜生图。
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-stone-500 dark:text-stone-400">场景</span>
                    <Select
                        className="min-w-36"
                        value={scene}
                        options={[{ value: "", label: "不指定" }, ...SCENE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))]}
                        onChange={(value) => { setScene(value); updateProject(project.id, { keyframeApprovals: [] }); }}
                    />
                    <span className="text-sm text-stone-500 dark:text-stone-400">画面风格</span>
                    <Select
                        className="min-w-52"
                        value={artStyle}
                        options={[...ART_STYLES.map((style) => ({ value: style.id, label: style.label })), { value: CUSTOM_ART_STYLE_ID, label: "自定义" }]}
                        onChange={(value) => { setArtStyle(value); updateProject(project.id, { keyframeApprovals: [] }); }}
                    />
                    <Button
                        icon={<Mic className="size-4" />}
                        loading={voiceBusyIds.narrator}
                        onClick={() => document.getElementById(`voice-ref-narrator-${project.id}`)?.click()}
                    >
                        {project.narratorVoiceRef ? "更换旁白音色" : "旁白音色参考"}
                    </Button>
                    <input
                        id={`voice-ref-narrator-${project.id}`}
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void uploadVoiceRef("narrator", file, (media) => updateProject(project.id, { narratorVoiceRef: media }));
                        }}
                    />
                    <Button icon={<Plus className="size-4" />} onClick={() => updateProject(project.id, { characters: [...project.characters, { id: nanoid(), name: `角色 ${project.characters.length + 1}`, description: "", candidates: [], views: {} }], keyframeApprovals: [] })}>
                        添加角色
                    </Button>
                </div>
            </div>

            {artStyle === CUSTOM_ART_STYLE_ID ? (
                <div className="space-y-1.5 border border-stone-200 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                    <Input.TextArea
                        rows={2}
                        value={customArtStyle}
                        placeholder="自定义画风描述（可观察写法），例如：粗细不均的手绘铅笔线稿，淡彩薄涂上色，大面积纸面留白，阴影用交叉排线表现"
                        onChange={(event) => { setCustomArtStyle(event.target.value); updateProject(project.id, { keyframeApprovals: [] }); }}
                    />
                    <p className="text-xs text-stone-400 dark:text-stone-500">
                        建议写线条、上色、光影、质感等可观察特征；留空时等价默认画风。
                        {/高质量|精美|杰作|精美绝伦|顶级|电影级/.test(customArtStyle) ? "提示：“高质量/精美”类空泛词对生成效果几乎没有帮助，建议换成具体特征。" : ""}
                    </p>
                </div>
            ) : null}

            {artStyle === "oriental-eerie-3d" ? (
                <div className="border-l-2 border-amber-700/70 bg-amber-950/[0.03] px-3 py-2 text-xs leading-5 text-stone-500 dark:bg-amber-200/[0.03] dark:text-stone-400">
                    红果头部取向：写实比例东方3D国漫，以青黛黑、铜锈绿、暗金和少量朱砂红建立识别；角色立绘与分镜首帧统一生效，视频继承首帧风格。
                </div>
            ) : null}

            {project.characters.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无角色，可回到剧本步骤用 AI 结构化，或点击右上角添加" className="py-16" />
            ) : (
                <div className="space-y-4">
                    {project.characters.map((character) => (
                        <div key={character.id} className="border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    className="w-40"
                                    value={character.name}
                                    placeholder="角色名"
                                    onChange={(event) => patchCharacter(character.id, { name: event.target.value })}
                                />
                                <Input
                                    className="min-w-60 flex-1"
                                    value={character.description}
                                    placeholder="角色描述：外貌、发型、服装等，作为立绘生成提示词"
                                    onChange={(event) => patchCharacter(character.id, { description: event.target.value })}
                                />
                                <Button
                                    type="primary"
                                    icon={<Sparkles className="size-4" />}
                                    loading={busyIds[character.id]}
                                    onClick={() => void generateCandidates(character)}
                                >
                                    生成立绘
                                </Button>
                                <Button
                                    icon={<Mic className="size-4" />}
                                    loading={voiceBusyIds[character.id]}
                                    onClick={() => document.getElementById(`voice-ref-${character.id}`)?.click()}
                                >
                                    {character.voiceRef ? "更换音色" : "音色参考"}
                                </Button>
                                <input
                                    id={`voice-ref-${character.id}`}
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        event.target.value = "";
                                    if (file) void uploadVoiceRef(character.id, file, (media) => patchCharacter(character.id, { voiceRef: media }, false));
                                    }}
                                />
                                <Button
                                    icon={<Library className="size-4" />}
                                    disabled={!Object.keys(character.views).length}
                                    onClick={() => saveToLibrary(character)}
                                >
                                    {character.assetId ? "已保存角色库" : "保存到角色库"}
                                </Button>
                                <Button
                                    type="text"
                                    danger
                                    icon={<Trash2 className="size-4" />}
                                    onClick={() => updateProject(project.id, { characters: project.characters.filter((item) => item.id !== character.id), keyframeApprovals: [] })}
                                />
                            </div>

                            {character.candidates.length > 0 ? (
                                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    {character.candidates.map((media) => (
                                        <div key={media.url} className="overflow-hidden border border-stone-200 dark:border-stone-700">
                                            <Image src={media.url} alt={`${character.name} 立绘`} width="100%" className="aspect-[3/4] w-full cursor-zoom-in object-cover" />
                                            <div className="flex items-center justify-center gap-1 p-1.5">
                                                {CHARACTER_VIEW_ORDER.map((viewKey) => (
                                                    <button
                                                        key={viewKey}
                                                        type="button"
                                                        onClick={() => assignView(character, media, viewKey)}
                                                        className={`cursor-pointer border px-1.5 py-0.5 text-[11px] transition ${
                                                            character.views[viewKey]?.url === media.url
                                                                ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
                                                                : "border-stone-300 text-stone-500 hover:border-stone-500 dark:border-stone-600 dark:text-stone-400"
                                                        }`}
                                                    >
                                                        {CHARACTER_VIEW_LABELS[viewKey]}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-4 text-xs text-stone-400 dark:text-stone-500">暂无立绘候选，点击「生成立绘」生成 {CANDIDATE_COUNT} 张候选图</div>
                            )}

                            {Object.keys(character.views).length > 0 ? (
                                <div className="mt-4 flex flex-wrap gap-3">
                                    {CHARACTER_VIEW_ORDER.filter((viewKey) => character.views[viewKey]).map((viewKey) => (
                                        <div key={viewKey} className="relative">
                                            <Image src={character.views[viewKey]!.url} alt={`${character.name} ${CHARACTER_VIEW_LABELS[viewKey]}`} className="h-24 w-[4.5rem] cursor-zoom-in object-cover" />
                                            <Tag className="absolute left-1 top-1 m-0 bg-black/55 text-[10px] text-white">{CHARACTER_VIEW_LABELS[viewKey]}</Tag>
                                            <button
                                                type="button"
                                                className="absolute -right-1.5 -top-1.5 flex size-4 cursor-pointer items-center justify-center rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                                                onClick={() => assignView(character, character.views[viewKey]!, viewKey)}
                                            >
                                                <X className="size-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
