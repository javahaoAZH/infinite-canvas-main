"use client";

// 模型渠道分区：渠道模式 + 本地渠道行卡（编辑进抽屉）+ 拉取模型 + 四类默认模型 + 画布生图张数 + 账号同步
// 旧弹窗的本地渠道增删改、模型拉取与默认模型选择逻辑原样迁入，行级即时保存
import { useMemo, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { Cloud, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { COMFYUI_WORKFLOW_PROTOCOL } from "@/lib/model-channel";
import { filterChannelModelsByCapability, normalizeLocalChannels, useConfigStore, useEffectiveConfig, type AiConfig, type LocalModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { syncUserModelConfig } from "@/services/api/user-config";
import { SettingsRow, SettingsSection } from "./rows";
import { ChannelDrawer } from "./channel-drawer";

const modelGroups: { capability: "image" | "video" | "text" | "audio"; modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel"; channelKey: "imageChannelId" | "videoChannelId" | "textChannelId" | "audioChannelId"; label: string }[] = [
    { capability: "image", modelKey: "imageModel", channelKey: "imageChannelId", label: "默认生图模型" },
    { capability: "video", modelKey: "videoModel", channelKey: "videoChannelId", label: "默认视频模型" },
    { capability: "text", modelKey: "textModel", channelKey: "textChannelId", label: "默认文本模型" },
    { capability: "audio", modelKey: "audioModel", channelKey: "audioChannelId", label: "默认音频模型" },
];

function channelIdForLocalModel(channels: LocalModelChannel[], model: string, currentId: string) {
    if (!channels.length) return "";
    if (channels.some((channel) => channel.id === currentId && (!model || channel.models.includes(model)))) return currentId;
    return channels.find((channel) => model && channel.models.includes(model))?.id || channels[0].id;
}

export function ModelChannelsSection({ search }: { search: string }) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const effectiveConfig = useEffectiveConfig();
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const modelChannel = publicSettings?.modelChannel;
    const canUseRemoteChannel = Boolean(token && user && (user.role === "admin" || modelChannel?.allowUserRemoteChannel === true));
    const allowCustomChannel = Boolean(token && user) && modelChannel?.allowCustomChannel === true;
    const effectiveMode = canUseRemoteChannel ? (allowCustomChannel ? config.channelMode : "remote") : "local";
    const localChannels = useMemo(() => normalizeLocalChannels(config), [config]);
    const modelConfig: AiConfig = effectiveMode === "remote" ? effectiveConfig : effectiveMode === "local" && config.channelMode !== "local" ? { ...config, channelMode: "local" } : config;
    const [loadingModels, setLoadingModels] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [editingChannelId, setEditingChannelId] = useState("");
    const editingChannel = localChannels.find((channel) => channel.id === editingChannelId) || null;

    const updateLocalChannels = (channels: LocalModelChannel[]) => {
        const normalized = channels.length ? channels : normalizeLocalChannels({ baseUrl: config.baseUrl, apiKey: config.apiKey, models: config.models });
        const unique = (models: string[]) => Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
        const models = unique(normalized.flatMap((channel) => channel.models));
        const nextImageModels = filterChannelModelsByCapability(normalized, "image");
        const nextVideoModels = filterChannelModelsByCapability(normalized, "video");
        const nextTextModels = filterChannelModelsByCapability(normalized, "text");
        const nextAudioModels = filterChannelModelsByCapability(normalized, "audio");
        updateConfig("localChannels", normalized);
        updateConfig("models", models);
        updateConfig("imageModels", nextImageModels);
        updateConfig("videoModels", nextVideoModels);
        updateConfig("textModels", nextTextModels);
        updateConfig("audioModels", nextAudioModels);
        updateConfig("imageModel", nextImageModels.includes(config.imageModel) ? config.imageModel : nextImageModels[0] || "");
        updateConfig("videoModel", nextVideoModels.includes(config.videoModel) ? config.videoModel : nextVideoModels[0] || "");
        updateConfig("textModel", nextTextModels.includes(config.textModel) ? config.textModel : nextTextModels[0] || "");
        updateConfig("audioModel", nextAudioModels.includes(config.audioModel) ? config.audioModel : nextAudioModels[0] || "");
        updateConfig("imageChannelId", channelIdForLocalModel(normalized, nextImageModels.includes(config.imageModel) ? config.imageModel : nextImageModels[0] || "", config.imageChannelId));
        updateConfig("videoChannelId", channelIdForLocalModel(normalized, nextVideoModels.includes(config.videoModel) ? config.videoModel : nextVideoModels[0] || "", config.videoChannelId));
        updateConfig("textChannelId", channelIdForLocalModel(normalized, nextTextModels.includes(config.textModel) ? config.textModel : nextTextModels[0] || "", config.textChannelId));
        updateConfig("audioChannelId", channelIdForLocalModel(normalized, nextAudioModels.includes(config.audioModel) ? config.audioModel : nextAudioModels[0] || "", config.audioChannelId));
        updateConfig("baseUrl", normalized[0]?.baseUrl || config.baseUrl);
        updateConfig("apiKey", normalized[0]?.apiKey || config.apiKey);
    };

    const patchLocalChannel = (id: string, patch: Partial<LocalModelChannel>) => {
        updateLocalChannels(normalizeLocalChannels(config).map((channel) => (channel.id === id ? { ...channel, ...patch } : channel)));
    };

    const addLocalChannel = () => {
        updateLocalChannels([...normalizeLocalChannels(config), { id: "local-" + Date.now(), protocol: "openai", name: "新渠道", baseUrl: "https://api.openai.com", apiKey: "", models: [] }]);
    };

    const refreshModels = async () => {
        const channels = normalizeLocalChannels(config);
        if (channels.some((channel) => !channel.baseUrl.trim() || !channel.apiKey.trim())) {
            message.error("请先在编辑抽屉中补全所有渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingModels(true);
        try {
            const { fetchImageModels } = await import("@/services/api/image");
            const results = await Promise.allSettled(channels.map(async (channel) => fetchImageModels({ ...config, channelMode: "local", baseUrl: channel.baseUrl, apiKey: channel.apiKey, localChannels: [{ ...channel }], imageChannelId: channel.id, videoChannelId: channel.id, textChannelId: channel.id, audioChannelId: channel.id, model: channel.models[0] || config.model })));
            updateLocalChannels(channels.map((channel, index) => (results[index].status === "fulfilled" ? { ...channel, models: Array.from(new Set(results[index].value.map((model) => model.trim()).filter(Boolean))) } : channel)));
            const failedCount = results.filter((result) => result.status === "rejected").length;
            if (failedCount) message.warning(`${failedCount} 个渠道拉取失败，已保留原有模型，可在编辑抽屉中手动选择模型`);
            else message.success("模型列表已更新");
        } finally {
            setLoadingModels(false);
        }
    };

    const syncToAccount = async () => {
        if (!token) return message.warning("请先登录后再同步配置");
        setSyncing(true);
        try {
            await syncUserModelConfig(token, config);
            message.success("配置已同步到账号");
        } catch (error) {
            message.error(error instanceof Error ? `同步失败：${error.message}` : "同步失败");
        } finally {
            setSyncing(false);
        }
    };

    return (
        <SettingsSection id="models" title="模型渠道" search={search}>
            <SettingsRow
                search={search}
                title="渠道模式"
                desc={canUseRemoteChannel ? "本地直连使用自建渠道列表；云端渠道使用账号下发配置" : "登录并具备权限后可切换云端渠道"}
                control={
                    <Select
                        size="small"
                        value={effectiveMode}
                        disabled={!canUseRemoteChannel || !allowCustomChannel}
                        options={[
                            { label: "本地直连", value: "local" },
                            { label: "云端渠道", value: "remote" },
                        ]}
                        className="w-28"
                        onChange={(value) => updateConfig("channelMode", value)}
                    />
                }
            />
            {effectiveMode === "local" ? (
                <>
                    {localChannels.filter((channel) => !search || `${channel.name}${channel.protocol}`.toLowerCase().includes(search)).map((channel, index) => (
                        <div key={channel.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{channel.name || "未命名渠道"}</div>
                                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                    {channel.protocol} · {channel.models.length} 个模型 · {channel.baseUrl.trim() && channel.apiKey.trim() ? "已配置" : "待补全地址与密钥"}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                    编辑
                                </Button>
                                {index === 0 && localChannels.length === 1 ? null : <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => updateLocalChannels(normalizeLocalChannels(config).filter((item) => item.id !== channel.id))} />}
                            </div>
                        </div>
                    ))}
                    <SettingsRow
                        search={search}
                        title="新增与拉取"
                        desc={`当前已保存 ${config.models.length} 个模型；拉取会更新全部渠道的模型列表`}
                        control={
                            <span className="flex items-center gap-2">
                                <Button size="small" icon={<Plus className="size-3.5" />} onClick={addLocalChannel}>
                                    新增渠道
                                </Button>
                                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={loadingModels} onClick={() => void refreshModels()}>
                                    拉取全部渠道
                                </Button>
                            </span>
                        }
                    />
                </>
            ) : (
                <SettingsRow search={search} title="云端渠道" desc={`由系统后台渠道转发请求，当前可用 ${modelChannel?.availableModels.length || 0} 个模型`} control={<Cloud className="size-4 text-muted-foreground" />} />
            )}
            {modelGroups.map((group) => (
                <SettingsRow key={group.modelKey} search={search} title={group.label} desc={modelConfig[group.modelKey] || "未配置"} control={<ModelPicker config={modelConfig} value={modelConfig[group.modelKey]} channelId={modelConfig[group.channelKey]} onChange={(model, channelId) => { updateConfig(group.modelKey, model); if (channelId) updateConfig(group.channelKey, channelId); }} capability={group.capability} onMissingConfig={() => message.warning("请先在上方添加并配置渠道")} />} />
            ))}
            <SettingsRow
                search={search}
                title="画布默认生图张数"
                desc="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖"
                control={
                    <Input
                        size="small"
                        type="number"
                        min={1}
                        max={15}
                        className="w-20"
                        value={config.canvasImageCount}
                        onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                        onBlur={(event) => updateConfig("canvasImageCount", String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(event.target.value)) || 3)))))}
                    />
                }
            />
            {localChannels.some((channel) => channel.protocol === COMFYUI_WORKFLOW_PROTOCOL) ? <SettingsRow search={search} title="ComfyUI 视频说明" desc="对白镜自动走 H3 对口型视频工作流，无需手动切换；默认视频模型仅影响非对白镜与手动生视频" control={null} /> : null}
            <SettingsRow search={search} title="账号同步" desc={token ? "把当前模型渠道配置上传到账号，换设备登录即可恢复" : "登录后可把配置同步到账号"} control={<Button size="small" loading={syncing} disabled={!token} onClick={() => void syncToAccount()}>立即同步</Button>} />
            <ChannelDrawer channel={editingChannel} config={config} onClose={() => setEditingChannelId("")} onChange={patchLocalChannel} onDelete={(id) => updateLocalChannels(normalizeLocalChannels(config).filter((channel) => channel.id !== id))} />
        </SettingsSection>
    );
}
