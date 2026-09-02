"use client";

import { App, Button, Form, Input, Modal, Popconfirm, Segmented, Select, Switch, Typography } from "antd";
import { useEffect, useState } from "react";

import { ChannelModelSelectorModal } from "@/components/channel-model-selector-modal";
import { GrokTtsVoiceSelect } from "@/components/grok-tts-voice-select";
import { ModelPicker } from "@/components/model-picker";
import { VOICE_DIRECTION_GUIDE } from "@/app/(user)/drama/prompts";
import { APP_DATA_CHANGED_EVENT } from "@/app/(user)/drama/services/bridge-refresh";
import { fetchQoderChannelStatus, getBridgeSnapshot, loadBridgeConfig, onBridgeStatusChange, regenerateBridgeToken, setBridgeAdapterPath, setBridgeEnabled, type QoderChannelStatus } from "@/app/(user)/drama/services/drama-bridge";
import { useCopyText } from "@/hooks/use-copy-text";
import { fetchImageModels } from "@/services/api/image";
import { getRenderFFmpegStatus, saveRenderFFmpegPath, type RenderFFmpegStatus } from "@/services/api/render";
import { fetchUserConfig, measureUserStorageProvider, syncUserModelConfig, syncUserStorageProvider } from "@/services/api/user-config";
import { clearStorageConfigCache as clearFileStorageCache } from "@/services/file-storage";
import { clearStorageConfigCache as clearImageStorageCache, defaultUserStorageProvider, defaultUserWebDAVStorageProvider, loadStorageConfig, loadUserS3StorageProvider, loadUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider, type UserStorageProvider } from "@/services/image-storage";
import { audioFormatOptions, audioVoiceOptions, glmTtsFormatOptions, glmTtsVoiceOptions, isGlmTtsModel, normalizeAudioSpeedValue, normalizeGlmTtsFormat, normalizeGlmTtsSpeed, normalizeGlmTtsVoice } from "@/lib/audio-generation";
import { grokTtsFormatOptions, grokTtsLanguageOptions, isGrok2APITtsConfig, normalizeGrokTtsFormat, normalizeGrokTtsLanguage, normalizeGrokTtsSpeed } from "@/lib/grok-tts";
import { isGeminiConfig, isGeminiTtsModel } from "@/lib/gemini";
import { geminiTtsVoiceOptions, normalizeGeminiTtsVoice } from "@/lib/gemini-tts";
import { isMimoPresetTtsModel, isMimoTtsModel, isMimoVoiceCloneModel, isMimoVoiceDesignModel, mimoTtsFormatOptions, mimoTtsVoiceOptions } from "@/lib/mimo-tts";
import { COMFYUI_WORKFLOW_PRESETS, COMFYUI_WORKFLOW_PRESET_IDS, COMFYUI_WORKFLOW_PROTOCOL, COMFYUI_WORKFLOW_REQUIREMENT_NOTE, modelChannelApiKeyUrls, modelChannelDefaultBaseUrls } from "@/lib/model-channel";
import { filterChannelModelsByCapability, normalizeLocalChannels, useConfigStore, useEffectiveConfig, type AiConfig, type LocalModelChannel, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    channelKey: "imageChannelId" | "videoChannelId" | "textChannelId" | "audioChannelId";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", channelKey: "imageChannelId", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", channelKey: "videoChannelId", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", channelKey: "textChannelId", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", channelKey: "audioChannelId", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

export function AppConfigModal() {
    const { message } = App.useApp();
    const [loadingModels, setLoadingModels] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [modelSelectChannelId, setModelSelectChannelId] = useState("");
    const [remoteStorageSyncEnabled, setRemoteStorageSyncEnabled] = useState(false);
    const [remoteWebDAVStorageSyncEnabled, setRemoteWebDAVStorageSyncEnabled] = useState(false);
    const [allowUserStorageProvider, setAllowUserStorageProvider] = useState(false);
    const [userStorage, setUserStorage] = useState(() => defaultUserStorageProvider());
    const [userWebDAVStorage, setUserWebDAVStorage] = useState(() => defaultUserWebDAVStorageProvider());
    const [measuringStorageType, setMeasuringStorageType] = useState<"s3" | "webdav" | null>(null);
    const [storageUsageText, setStorageUsageText] = useState("");
    const [webDAVStorageUsageText, setWebDAVStorageUsageText] = useState("");
    const [ffmpegPathInput, setFfmpegPathInput] = useState("");
    const [ffmpegStatus, setFfmpegStatus] = useState<RenderFFmpegStatus | null>(null);
    const [loadingFFmpegStatus, setLoadingFFmpegStatus] = useState(false);
    const [savingFFmpegPath, setSavingFFmpegPath] = useState(false);
    const copyText = useCopyText();
    const [bridgeConfig, setBridgeConfig] = useState(() => loadBridgeConfig());
    const [bridgeSnapshot, setBridgeSnapshot] = useState(() => getBridgeSnapshot());
    const [qoderChannelStatus, setQoderChannelStatus] = useState<QoderChannelStatus | null>(null);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const effectiveConfig = useEffectiveConfig();
    const modelChannel = publicSettings?.modelChannel;
    const isLoggedIn = Boolean(token && user);
    const isAdmin = user?.role === "admin";
    const canUseRemoteChannel = isLoggedIn && (user?.role === "admin" || modelChannel?.allowUserRemoteChannel === true);
    const allowCustomChannel = isLoggedIn && modelChannel?.allowCustomChannel === true;
    const effectiveMode = canUseRemoteChannel ? (allowCustomChannel ? config.channelMode : "remote") : "local";
    const localModelConfig: AiConfig = effectiveMode === "local" && config.channelMode !== "local" ? { ...config, channelMode: "local" } : config;
    const modelConfig = effectiveMode === "remote" ? effectiveConfig : localModelConfig;
    const canUseUserStorageProvider = allowUserStorageProvider;
    const glmTts = isGlmTtsModel(config.audioModel);
    const grokTts = isGrok2APITtsConfig({ ...modelConfig, model: config.audioModel, audioModel: config.audioModel }, config.audioModel);
    const geminiTts = isGeminiTtsModel(config.audioModel) && isGeminiConfig({ ...modelConfig, model: config.audioModel, audioModel: config.audioModel }, config.audioModel);
    const modelSelectChannel = normalizeLocalChannels(config).find((channel) => channel.id === modelSelectChannelId);
    // 存在 ComfyUI 渠道时，视频模型项展示对白/非对白角色分工说明
    const hasComfyuiChannel = normalizeLocalChannels(config).some((channel) => channel.protocol === COMFYUI_WORKFLOW_PROTOCOL) || (publicSettings?.modelChannel?.channels || []).some((channel) => channel.protocol === COMFYUI_WORKFLOW_PROTOCOL);

    useEffect(() => {
        setUserStorage(loadUserS3StorageProvider() || defaultUserStorageProvider());
        setUserWebDAVStorage(loadUserWebDAVStorageProvider() || defaultUserWebDAVStorageProvider());
        if (!isConfigOpen || !token) return;
        let canceled = false;
        void fetchUserConfig(token)
            .then((payload) => {
                if (canceled) return;
                const remoteConfig = payload.modelConfig;
                const syncS3 = remoteConfig?.syncStorageConfig === true;
                const syncWebDAV = remoteConfig?.syncWebDAVStorageConfig === true;
                setRemoteStorageSyncEnabled(syncS3);
                setRemoteWebDAVStorageSyncEnabled(syncWebDAV);
                if (remoteConfig) {
                    Object.entries(remoteConfig)
                        .forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
                }
                updateConfig("syncStorageConfig", syncS3);
                updateConfig("syncWebDAVStorageConfig", syncWebDAV);
                if (syncS3 && payload.storageProvider?.s3) {
                    const next = { ...defaultUserStorageProvider(), ...payload.storageProvider.s3, type: "s3" as const };
                    setUserStorage(next);
                    saveUserStorageProvider(next);
                }
                if (syncWebDAV && payload.storageProvider?.webdav) {
                    const next = { ...defaultUserWebDAVStorageProvider(), ...payload.storageProvider.webdav, type: "webdav" as const };
                    setUserWebDAVStorage(next);
                    saveUserWebDAVStorageProvider(next);
                }
            })
            .catch(() => { });
        return () => {
            canceled = true;
        };
    }, [isConfigOpen, token, updateConfig]);

    useEffect(() => {
        if (!isConfigOpen) return;
        let canceled = false;
        void loadStorageConfig()
            .then((storage) => {
                if (!canceled) setAllowUserStorageProvider(storage.allowUserProvider === true);
            })
            .catch(() => {
                if (!canceled) setAllowUserStorageProvider(false);
            });
        return () => {
            canceled = true;
        };
    }, [isConfigOpen]);

    useEffect(() => {
        if (!isConfigOpen || !token) return;
        let canceled = false;
        setLoadingFFmpegStatus(true);
        void getRenderFFmpegStatus(token)
            .then((status) => {
                if (canceled) return;
                setFfmpegStatus(status);
                if (status.source === "settings") setFfmpegPathInput(status.path);
            })
            .catch(() => {
                if (!canceled) setFfmpegStatus(null);
            })
            .finally(() => {
                if (!canceled) setLoadingFFmpegStatus(false);
            });
        return () => {
            canceled = true;
        };
    }, [isConfigOpen, token]);

    // Qoder 通道状态订阅 + 弹窗打开时刷新本地配置（令牌/路径可能在他处变化）与后端自动注册状态
    useEffect(() => onBridgeStatusChange(setBridgeSnapshot), []);

    useEffect(() => {
        if (!isConfigOpen) return;
        setBridgeConfig(loadBridgeConfig());
        let canceled = false;
        void fetchQoderChannelStatus()
            .then((status) => {
                if (!canceled) setQoderChannelStatus(status);
            })
            .catch(() => { });
        return () => {
            canceled = true;
        };
    }, [isConfigOpen]);

    // 桥接工具变更后端数据（app-data-changed）时，弹窗打开期间重读自动注册状态
    useEffect(() => {
        if (!isConfigOpen) return;
        const reload = () => {
            void fetchQoderChannelStatus()
                .then(setQoderChannelStatus)
                .catch(() => { });
        };
        window.addEventListener(APP_DATA_CHANGED_EVENT, reload);
        return () => window.removeEventListener(APP_DATA_CHANGED_EVENT, reload);
    }, [isConfigOpen]);

    const handleBridgeEnabled = (enabled: boolean) => {
        setBridgeEnabled(enabled);
        setBridgeConfig(loadBridgeConfig());
    };

    const handleRegenerateBridgeToken = () => {
        regenerateBridgeToken();
        setBridgeConfig(loadBridgeConfig());
        message.success("通道令牌已重新生成，请同步更新 Qoder 中的注册配置");
    };

    const bridgeRegistrationJson = JSON.stringify(
        { command: "node", args: [bridgeConfig.adapterPath.trim() || "<mcp-adapter/drama-mcp.mjs 绝对路径>", "--token", bridgeConfig.token] },
        null,
        2,
    );

    // exe 模式已自动注册时弱化手动注册区块（折叠 + 降透明度，仍保留作为降级路径）
    const bridgeAutoRegistered = qoderChannelStatus?.mode === "exe" && qoderChannelStatus.registered === true;

    // 手动注册降级区块：适配器路径输入 + 注册配置 JSON（自动注册生效时折叠弱化）
    const bridgeManualRegistrationBlock = (
        <>
            <Input
                value={bridgeConfig.adapterPath}
                placeholder="适配器脚本绝对路径，例如 D:/infinite-canvas-main/mcp-adapter/drama-mcp.mjs"
                onChange={(event) => {
                    setBridgeAdapterPath(event.target.value);
                    setBridgeConfig((value) => ({ ...value, adapterPath: event.target.value }));
                }}
            />
            <div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-stone-500">Qoder MCP 注册配置（粘贴到 Qoder 的 MCP 设置）</span>
                    <Button size="small" onClick={() => copyText(bridgeRegistrationJson, "注册配置已复制")}>
                        复制注册配置
                    </Button>
                </div>
                <pre className="mt-1 overflow-x-auto rounded-md border border-stone-200 bg-white p-2 text-xs leading-5 text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">{bridgeRegistrationJson}</pre>
            </div>
        </>
    );

    const saveFFmpegConfig = async () => {
        if (!token) {
            message.warning("请先登录后再保存 FFmpeg 配置");
            return;
        }
        if (!isAdmin) {
            message.warning("FFmpeg 全局路径仅管理员可配置，请联系管理员处理");
            return;
        }
        setSavingFFmpegPath(true);
        try {
            await saveRenderFFmpegPath(token, ffmpegPathInput.trim());
            const status = await getRenderFFmpegStatus(token);
            setFfmpegStatus(status);
            message.success("FFmpeg 配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? "保存 FFmpeg 配置失败：" + error.message : "保存 FFmpeg 配置失败");
        } finally {
            setSavingFFmpegPath(false);
        }
    };

    const finishConfig = async () => {
        const localIncomplete = effectiveMode === "local" && normalizeLocalChannels(config).some((channel) => !channel.baseUrl.trim() || !channel.apiKey.trim());
        const modelIncomplete = !modelConfig.imageModel.trim() || !modelConfig.videoModel.trim() || !modelConfig.textModel.trim();
        if (userStorage.enabled && userWebDAVStorage.enabled) {
            message.error("S3/R2 与 WebDAV 不能同时启用");
            return;
        }
        if (!canUseRemoteChannel && config.channelMode !== "local") updateConfig("channelMode", "local");
        else if (canUseRemoteChannel && !allowCustomChannel && config.channelMode !== "remote") updateConfig("channelMode", "remote");
        if (canUseUserStorageProvider) {
            saveUserStorageProvider(userStorage);
            saveUserWebDAVStorageProvider(userWebDAVStorage);
        }
        setSavingConfig(true);
        try {
            if (token) {
                const configToSave = effectiveMode === "local" && config.channelMode !== "local" ? { ...config, channelMode: "local" as const } : config;
                await syncUserModelConfig(token, configToSave);
            }
            const providers = {
                ...(config.syncStorageConfig || remoteStorageSyncEnabled ? { s3: config.syncStorageConfig ? userStorage : { ...userStorage, enabled: false, endpoint: "", bucket: "", accessKeyId: "", secretAccessKey: "" } } : {}),
                ...(config.syncWebDAVStorageConfig || remoteWebDAVStorageSyncEnabled ? { webdav: config.syncWebDAVStorageConfig ? userWebDAVStorage : { ...userWebDAVStorage, enabled: false, endpoint: "", username: "", password: "" } } : {}),
            };
            if (token && canUseUserStorageProvider && Object.keys(providers).length) {
                await syncUserStorageProvider(token, providers);
                setRemoteStorageSyncEnabled(config.syncStorageConfig);
                setRemoteWebDAVStorageSyncEnabled(config.syncWebDAVStorageConfig);
            }
            clearImageStorageCache();
            clearFileStorageCache();
            setConfigDialogOpen(false);
            if ((config.syncStorageConfig || config.syncWebDAVStorageConfig) && !token) message.warning("请登录后再同步配置");
            else if (localIncomplete || modelIncomplete) message.warning("部分模型或本地渠道密钥尚未配置完整，配置已保存");
            else message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
            clearPromptContinue();
        } catch (error) {
            message.error(error instanceof Error ? "同步配置失败：" + error.message : "同步配置失败");
        } finally {
            setSavingConfig(false);
        }
    };

    const refreshModels = async () => {
        if (effectiveMode === "remote") return;
        const channels = normalizeLocalChannels(config);
        if (channels.some((channel) => !channel.baseUrl.trim() || !channel.apiKey.trim())) {
            message.error("请先填写所有本地渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingModels(true);
        try {
            const results = await Promise.allSettled(channels.map(async (channel) => fetchImageModels(configForLocalChannel(config, channel))));
            updateLocalChannels(channels.map((channel, index) => {
                const result = results[index];
                return result.status === "fulfilled" ? { ...channel, models: result.value } : channel;
            }));
            const failedCount = results.filter((result) => result.status === "rejected").length;
            if (failedCount) message.warning(`${failedCount} 个渠道拉取失败，已保留原有模型，可在“选择”中手动增加模型`);
            else message.success("模型列表已更新");
        } finally {
            setLoadingModels(false);
        }
    };

    const updateLocalChannels = (channels: LocalModelChannel[]) => {
        const normalized = channels.length ? channels : normalizeLocalChannels({ baseUrl: config.baseUrl, apiKey: config.apiKey, models: config.models });
        const models = uniqueModels(normalized.flatMap((channel) => channel.models));
        const nextImageModels = filterChannelModelsByCapability(normalized, "image");
        const nextVideoModels = filterChannelModelsByCapability(normalized, "video");
        const nextTextModels = filterChannelModelsByCapability(normalized, "text");
        const nextAudioModels = filterChannelModelsByCapability(normalized, "audio");
        const imageModel = nextImageModels.includes(config.imageModel) ? config.imageModel : nextImageModels[0] || "";
        const videoModel = nextVideoModels.includes(config.videoModel) ? config.videoModel : nextVideoModels[0] || "";
        const textModel = nextTextModels.includes(config.textModel) ? config.textModel : nextTextModels[0] || "";
        const audioModel = nextAudioModels.includes(config.audioModel) ? config.audioModel : nextAudioModels[0] || "";
        updateConfig("localChannels", normalized);
        updateConfig("models", models);
        updateConfig("imageModels", nextImageModels);
        updateConfig("videoModels", nextVideoModels);
        updateConfig("textModels", nextTextModels);
        updateConfig("audioModels", nextAudioModels);
        updateConfig("imageModel", imageModel);
        updateConfig("videoModel", videoModel);
        updateConfig("textModel", textModel);
        updateConfig("audioModel", audioModel);
        updateConfig("imageChannelId", channelIdForLocalModel(normalized, imageModel, config.imageChannelId));
        updateConfig("videoChannelId", channelIdForLocalModel(normalized, videoModel, config.videoChannelId));
        updateConfig("textChannelId", channelIdForLocalModel(normalized, textModel, config.textChannelId));
        updateConfig("audioChannelId", channelIdForLocalModel(normalized, audioModel, config.audioChannelId));
        updateConfig("baseUrl", normalized[0]?.baseUrl || config.baseUrl);
        updateConfig("apiKey", normalized[0]?.apiKey || config.apiKey);
    };

    const patchLocalChannel = (id: string, patch: Partial<LocalModelChannel>) => {
        updateLocalChannels(normalizeLocalChannels(config).map((channel) => (channel.id === id ? { ...channel, ...patch } : channel)));
    };

    const addLocalChannel = () => {
        updateLocalChannels([...normalizeLocalChannels(config), { id: "local-" + Date.now(), protocol: "openai", name: "新渠道", baseUrl: modelChannelDefaultBaseUrls.openai, apiKey: "", models: [] }]);
    };

    const removeLocalChannel = (id: string) => {
        updateLocalChannels(normalizeLocalChannels(config).filter((channel) => channel.id !== id));
    };

    const openLocalModelSelector = (channel: LocalModelChannel) => setModelSelectChannelId(channel.id);

    const closeLocalModelSelector = () => setModelSelectChannelId("");

    const confirmLocalModelSelector = (models: string[]) => {
        if (!modelSelectChannelId) return;
        patchLocalChannel(modelSelectChannelId, { models });
        closeLocalModelSelector();
    };

    const fetchLocalModelList = async () => {
        if (!modelSelectChannel) return;
        // autodl 无 /models 接口：ComfyUI 协议直接返回标准工作流预设
        if (modelSelectChannel.protocol === COMFYUI_WORKFLOW_PROTOCOL) return [...COMFYUI_WORKFLOW_PRESET_IDS];
        if (!modelSelectChannel.baseUrl.trim() || !modelSelectChannel.apiKey.trim()) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        return uniqueModels(await fetchImageModels(configForLocalChannel(config, modelSelectChannel)));
    };


    const measureStorage = async (provider: UserStorageProvider) => {
        if (!token) {
            message.warning("请先登录后再统计容量");
            return;
        }
        setMeasuringStorageType(provider.type);
        try {
            const result = await measureUserStorageProvider(token, provider);
            const usageText = formatBytes(result.bytes) + " / " + formatBytes(result.limitBytes) + (result.overLimit ? "，已达到上限" : "");
            if (provider.type === "webdav") {
                setWebDAVStorageUsageText(usageText);
                if (result.overLimit) {
                    const next = { ...userWebDAVStorage, enabled: false };
                    setUserWebDAVStorage(next);
                    saveUserWebDAVStorageProvider(next);
                }
            } else {
                setStorageUsageText(usageText);
                if (result.overLimit) {
                    const next = { ...userStorage, enabled: false };
                    setUserStorage(next);
                    saveUserStorageProvider(next);
                }
            }
            message.success("容量统计完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "容量统计失败");
        } finally {
            setMeasuringStorageType(null);
        }
    };

    return (
        <>
            <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">模型、渠道和画布默认行为</div>
                </div>
            }
            open={isConfigOpen}
            width={960}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 18 } }}
            footer={
                <Button type="primary" loading={savingConfig} onClick={() => void finishConfig()}>
                    完成
                </Button>
            }
        >
            <div className="pt-1">
                <Form layout="vertical" requiredMark={false}>
                    {allowCustomChannel && canUseRemoteChannel ? (
                        <Form.Item label="渠道模式" className="mb-5">
                            <Segmented
                                block
                                size="middle"
                                value={effectiveMode}
                                onChange={(value) => updateConfig("channelMode", value as AiConfig["channelMode"])}
                                options={[
                                    { label: "本地直连", value: "local" },
                                    { label: "云端渠道", value: "remote" },
                                ]}
                            />
                        </Form.Item>
                    ) : null}
                    {effectiveMode === "local" ? (
                        <>
                            <div className="mb-5 space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">本地模型渠道</div>
                                        <div className="mt-1 text-xs text-stone-500">可为生图、视频、文本、音频分别选择不同渠道的模型。</div>
                                    </div>
                                    <Button size="small" onClick={addLocalChannel}>
                                        新增渠道
                                    </Button>
                                </div>
                                {normalizeLocalChannels(config).map((channel, index) => (
                                    <div key={channel.id} className="space-y-2 rounded-md bg-stone-50 p-2 dark:bg-stone-900">
                                        <div className="grid gap-2 md:grid-cols-[130px_150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                                            <Input value={channel.name} placeholder="渠道名称" onChange={(event) => patchLocalChannel(channel.id, { name: event.target.value })} />
                                            <Select
                                                value={channel.protocol}
                                                options={[
                                                    { label: "OpenAI", value: "openai" },
                                                    { label: "Gemini", value: "gemini" },
                                                    { label: "Grok2API", value: "grok2api" },
                                                    { label: "MiniMax & METASO", value: "metaso" },
                                                    { label: "APIMart", value: "apimart" },
                                                    { label: "KIE", value: "kie" },
                                                    { label: "MiMo", value: "mimo" },
                                                    { label: "阿里云百炼", value: "dashscope" },
                                                    { label: "ComfyUI 工作流", value: "comfyui" },
                                                ]}
                                                onChange={(protocol: LocalModelChannel["protocol"]) => patchLocalChannel(channel.id, { protocol, baseUrl: modelChannelDefaultBaseUrls[protocol], ...(protocol === COMFYUI_WORKFLOW_PROTOCOL && !channel.models.length ? { models: [...COMFYUI_WORKFLOW_PRESET_IDS] } : {}) })}
                                            />
                                            <Input value={channel.baseUrl} placeholder="Base URL" onChange={(event) => patchLocalChannel(channel.id, { baseUrl: event.target.value })} />
                                            <Input.Password value={channel.apiKey} placeholder="API Key" onChange={(event) => patchLocalChannel(channel.id, { apiKey: event.target.value })} />
                                            <div className="relative flex flex-wrap gap-2 md:flex-nowrap">
                                                <Button size="small" onClick={() => openLocalModelSelector(channel)}>
                                                    选择
                                                </Button>
                                                <Button size="small" danger disabled={index === 0 && normalizeLocalChannels(config).length === 1} onClick={() => removeLocalChannel(channel.id)}>
                                                    删除
                                                </Button>
                                                {modelChannelApiKeyUrls[channel.protocol] ? (
                                                    <div className="w-full md:absolute md:left-0 md:top-8">
                                                        <Button block type="primary" size="small" href={modelChannelApiKeyUrls[channel.protocol]} target="_blank">
                                                            获取 API Key
                                                        </Button>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="text-xs text-stone-500">
                                            已保存 {channel.models.length} 个模型
                                            {channel.protocol === COMFYUI_WORKFLOW_PROTOCOL ? `｜模型名为 autodl 工作流 ID，标准要求：${COMFYUI_WORKFLOW_REQUIREMENT_NOTE}` : ""}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium">模型列表</div>
                                    <div className="mt-1 text-xs text-stone-500">当前已保存 {config.models.length} 个模型</div>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                    <Button size="small" loading={loadingModels} onClick={() => void refreshModels()}>
                                        拉取全部渠道
                                    </Button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="mb-5 rounded-lg border border-stone-200 p-3 text-sm text-stone-500 dark:border-stone-800">
                            <div className="font-medium text-stone-900 dark:text-stone-100">云端渠道</div>
                            <div className="mt-1">由系统后台渠道转发请求，当前可用 {modelChannel?.availableModels.length || 0} 个模型。</div>
                        </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {modelGroups.map((group) => (
                            <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-4" extra={group.capability === "video" && hasComfyuiChannel ? "对白镜自动走 H3 对口型视频工作流，无需手动切换；此项仅影响非对白镜与手动生视频默认。" : undefined}>
                                <ModelPicker config={modelConfig} value={modelConfig[group.modelKey]} channelId={modelConfig[group.channelKey]} onChange={(model, channelId) => { updateConfig(group.modelKey, model); if (channelId) updateConfig(group.channelKey, channelId); }} capability={group.capability} fullWidth />
                            </Form.Item>
                        ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                        <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                            <Input
                                type="number"
                                min={1}
                                max={15}
                                value={config.canvasImageCount}
                                onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                            />
                        </Form.Item>
                        {geminiTts ? (
                            <Form.Item label="默认 Gemini 音色" className="mb-4">
                                <Select showSearch optionFilterProp="label" value={normalizeGeminiTtsVoice(config.geminiTtsVoice)} options={geminiTtsVoiceOptions} onChange={(value) => updateConfig("geminiTtsVoice", value)} />
                            </Form.Item>
                        ) : isMimoPresetTtsModel(config.audioModel) ? (
                            <Form.Item label="默认 MiMo 音色" className="mb-4">
                                <Select value={config.mimoTtsVoice} options={[...mimoTtsVoiceOptions]} onChange={(value) => updateConfig("mimoTtsVoice", value)} />
                            </Form.Item>
                        ) : isMimoVoiceDesignModel(config.audioModel) ? (
                            <Form.Item label="默认音色描述" className="mb-4">
                                <Input value={config.mimoVoiceDesignPrompt} placeholder="例如：年轻女性，声音清亮自然，有亲和力。" onChange={(event) => updateConfig("mimoVoiceDesignPrompt", event.target.value)} />
                            </Form.Item>
                        ) : isMimoTtsModel(config.audioModel) ? null : (
                            <Form.Item label="默认音频声音" className="mb-4">
                                {grokTts ? <GrokTtsVoiceSelect config={modelConfig} model={config.audioModel} value={config.grokTtsVoice} enabled={isConfigOpen} onChange={(value) => updateConfig("grokTtsVoice", value)} /> : <Select value={glmTts ? normalizeGlmTtsVoice(config.glmTtsVoice) : config.audioVoice} options={glmTts ? glmTtsVoiceOptions : audioVoiceOptions} onChange={(value) => updateConfig(glmTts ? "glmTtsVoice" : "audioVoice", value)} />}
                            </Form.Item>
                        )}
                        {grokTts ? (
                            <Form.Item label="默认音频语言" className="mb-4">
                                <Select value={normalizeGrokTtsLanguage(config.grokTtsLanguage)} options={grokTtsLanguageOptions} showSearch optionFilterProp="label" onChange={(value) => updateConfig("grokTtsLanguage", value)} />
                            </Form.Item>
                        ) : null}
                        {!geminiTts ? (
                            <Form.Item label="默认音频格式" className="mb-4">
                                <Select value={isMimoTtsModel(config.audioModel) ? config.mimoTtsFormat : glmTts ? normalizeGlmTtsFormat(config.glmTtsFormat) : grokTts ? normalizeGrokTtsFormat(config.grokTtsFormat) : config.audioFormat} options={isMimoTtsModel(config.audioModel) ? [...mimoTtsFormatOptions] : glmTts ? glmTtsFormatOptions : grokTts ? grokTtsFormatOptions : audioFormatOptions} onChange={(value) => isMimoTtsModel(config.audioModel) ? updateConfig("mimoTtsFormat", value) : updateConfig(glmTts ? "glmTtsFormat" : grokTts ? "grokTtsFormat" : "audioFormat", value)} />
                            </Form.Item>
                        ) : null}
                        {!geminiTts && !isMimoTtsModel(config.audioModel) ? (
                            <Form.Item label="默认音频语速" className="mb-4">
                                <Input
                                    type="number"
                                    min={glmTts ? 0.5 : grokTts ? 0.7 : 0.25}
                                    max={glmTts ? 2 : grokTts ? 1.5 : 4}
                                    step={0.05}
                                    value={glmTts ? config.glmTtsSpeed : grokTts ? config.grokTtsSpeed : config.audioSpeed}
                                    onChange={(event) => updateConfig(glmTts ? "glmTtsSpeed" : grokTts ? "grokTtsSpeed" : "audioSpeed", event.target.value)}
                                    onBlur={(event) => updateConfig(glmTts ? "glmTtsSpeed" : grokTts ? "grokTtsSpeed" : "audioSpeed", glmTts ? normalizeGlmTtsSpeed(event.target.value) : grokTts ? normalizeGrokTtsSpeed(event.target.value) : normalizeAudioSpeedValue(event.target.value))}
                                />
                            </Form.Item>
                        ) : null}
                    </div>
                    <div className="mb-4 grid gap-3 md:grid-cols-3">
                        <FeatureSwitch title="流式传输" description="开启后请求中追加 stream，支持读取中间图片事件并避免长时间无数据。" checked={Boolean(config.streamImages)} onChange={(checked) => updateConfig("streamImages", checked ? "1" : "")} />
                        <FeatureSwitch title="返回 Base64 图片数据" description="开启后 Image API 请求会追加 response_format: b64_json。" checked={Boolean(config.responseFormatB64Json)} onChange={(checked) => updateConfig("responseFormatB64Json", checked ? "1" : "")} />
                        <FeatureSwitch title="Codex CLI 兼容模式" description="开启后减少不兼容参数，并追加防提示词改写前缀。" checked={Boolean(config.codexCli)} onChange={(checked) => updateConfig("codexCli", checked ? "1" : "")} />
                    </div>
                    {canUseUserStorageProvider ? (
                        <>
                            <section className="mb-5 mt-4 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">用户 S3/R2 存储</div>
                                        <div className="mt-1 text-xs text-stone-500">
                                            开启后，新生成图片和媒体文件会优先保存到你的 S3 兼容对象存储。
                                            {storageUsageText ? <>当前容量：{storageUsageText}</> : null}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                        <Button size="small" loading={measuringStorageType === "s3"} onClick={() => void measureStorage(userStorage)}>
                                            统计容量
                                        </Button>
                                        <span className="text-xs text-stone-500">自动同步</span>
                                        <Switch size="small" checked={config.syncStorageConfig} onChange={(checked) => updateConfig("syncStorageConfig", checked)} />
                                        <Switch checked={userStorage.enabled} disabled={userWebDAVStorage.enabled} onChange={(enabled) => setUserStorage((value) => ({ ...value, enabled }))} />
                                    </div>
                                </div>
                                {userStorage.enabled ? (
                                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                                        <Input value={userStorage.name} placeholder="配置名称" onChange={(event) => setUserStorage((value) => ({ ...value, name: event.target.value }))} />
                                        <Input value={userStorage.endpoint} placeholder="Endpoint，例如 https://<account>.r2.cloudflarestorage.com" onChange={(event) => setUserStorage((value) => ({ ...value, endpoint: event.target.value }))} />
                                        <Input value={userStorage.region} placeholder="Region，R2 通常为 auto" onChange={(event) => setUserStorage((value) => ({ ...value, region: event.target.value }))} />
                                        <Input value={userStorage.bucket} placeholder="Bucket 名称" onChange={(event) => setUserStorage((value) => ({ ...value, bucket: event.target.value }))} />
                                        <Input value={userStorage.accessKeyId} placeholder="Access Key ID" onChange={(event) => setUserStorage((value) => ({ ...value, accessKeyId: event.target.value }))} />
                                        <Input.Password value={userStorage.secretAccessKey} placeholder="Secret Access Key" onChange={(event) => setUserStorage((value) => ({ ...value, secretAccessKey: event.target.value }))} />
                                        <Input value={userStorage.publicBaseUrl} placeholder="公开访问地址，例如 https://pub-xxx.r2.dev" onChange={(event) => setUserStorage((value) => ({ ...value, publicBaseUrl: event.target.value }))} />
                                        <Input value={userStorage.pathPrefix} placeholder="保存路径前缀，例如 images" onChange={(event) => setUserStorage((value) => ({ ...value, pathPrefix: event.target.value }))} />
                                    </div>
                                ) : null}
                            </section>
                            <section className="mb-5 mt-4 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">WebDAV 存储</div>
                                        <div className="mt-1 text-xs text-stone-500">
                                            开启后，新生成图片和媒体文件会优先保存到你的 WebDAV。
                                            {webDAVStorageUsageText ? <>当前容量：{webDAVStorageUsageText}</> : null}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                        <Button size="small" loading={measuringStorageType === "webdav"} onClick={() => void measureStorage(userWebDAVStorage)}>
                                            统计容量
                                        </Button>
                                        <span className="text-xs text-stone-500">自动同步</span>
                                        <Switch size="small" checked={config.syncWebDAVStorageConfig} onChange={(checked) => updateConfig("syncWebDAVStorageConfig", checked)} />
                                        <Switch checked={userWebDAVStorage.enabled} disabled={userStorage.enabled} onChange={(enabled) => setUserWebDAVStorage((value) => ({ ...value, enabled }))} />
                                    </div>
                                </div>
                                {userWebDAVStorage.enabled ? (
                                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                                        <Input value={userWebDAVStorage.name} placeholder="配置名称" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, name: event.target.value }))} />
                                        <Input value={userWebDAVStorage.endpoint} placeholder="WebDAV 地址" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, endpoint: event.target.value }))} />
                                        <Input value={userWebDAVStorage.pathPrefix} placeholder="远程目录" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, pathPrefix: event.target.value }))} />
                                        <Input value={userWebDAVStorage.username} placeholder="用户名" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, username: event.target.value }))} />
                                        <Input.Password value={userWebDAVStorage.password} placeholder="密码 / 应用密码" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, password: event.target.value }))} />
                                    </div>
                                ) : null}
                            </section>
                        </>
                    ) : null}
                    <section className="mb-5 mt-4 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium">本地合成 (FFmpeg)</div>
                                <div className="mt-1 text-xs text-stone-500">
                                    {isAdmin ? "一键成片依赖本机 FFmpeg，路径留空时自动探测系统 PATH。" : "一键成片依赖服务端 FFmpeg，全局路径仅管理员可配置。"}
                                </div>
                            </div>
                            {isAdmin ? (
                                <Button size="small" loading={savingFFmpegPath} disabled={!token} onClick={() => void saveFFmpegConfig()}>
                                    保存
                                </Button>
                            ) : null}
                        </div>
                        <div className="mt-3">
                            <Input
                                value={ffmpegPathInput}
                                disabled={!isAdmin}
                                placeholder={isAdmin ? "FFmpeg 可执行文件路径，留空自动探测" : "全局 FFmpeg 路径由管理员维护"}
                                onChange={(event) => setFfmpegPathInput(event.target.value)}
                            />
                        </div>
                        <div className="mt-2 text-xs leading-5">
                            {!token ? (
                                <span className="text-stone-500">请先登录后检测和保存 FFmpeg 配置。</span>
                            ) : loadingFFmpegStatus ? (
                                <span className="text-stone-500">正在检测 FFmpeg…</span>
                            ) : ffmpegStatus?.available ? (
                                <span className="text-green-600 dark:text-green-400">
                                    已检测到 FFmpeg：{ffmpegStatus.version}（{ffmpegStatus.path}）
                                </span>
                            ) : (
                                <span className="text-orange-600 dark:text-orange-400">
                                    {ffmpegStatus?.reason || "未检测到 FFmpeg，请安装或指定路径。"}{" "}
                                    {isAdmin ? (
                                        <Typography.Link href={ffmpegStatus?.downloadUrl || "https://www.ffmpeg.org/download.html"} target="_blank">
                                            前往下载
                                        </Typography.Link>
                                    ) : (
                                        "请联系管理员配置。"
                                    )}
                                </span>
                            )}
                        </div>
                    </section>
                    <section className="mb-5 mt-4 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium">Qoder 通道</div>
                                <div className="mt-1 text-xs text-stone-500">开启后本页通过本地适配器接收 Qoder 的 MCP 指令：Qoder 当大脑写剧本与分镜，本软件负责生成媒体与成片。</div>
                            </div>
                            <Switch checked={bridgeConfig.enabled} onChange={handleBridgeEnabled} />
                        </div>
                        {bridgeConfig.enabled ? (
                            <div className="mt-3 space-y-3">
                                <div className="text-xs leading-5">
                                    {bridgeSnapshot.status === "connected" ? (
                                        <span className="text-green-600 dark:text-green-400">已连接：Qoder 通道就绪，可以在 Qoder 中驱动漫剧创作。</span>
                                    ) : bridgeSnapshot.status === "connecting" ? (
                                        <span className="text-orange-600 dark:text-orange-400">连接中：正在连接本地适配器（ws://127.0.0.1:9801）…</span>
                                    ) : bridgeSnapshot.registered === "ok" ? (
                                        <span className="text-green-600 dark:text-green-400">已自动注册到 Qoder，等待热加载后即可使用。</span>
                                    ) : bridgeSnapshot.registered === "failed" ? (
                                        <span className="text-orange-600 dark:text-orange-400">自动注册失败：{bridgeSnapshot.registerError || "未知错误"}，可复制注册配置手动添加。</span>
                                    ) : (
                                        <span className="text-orange-600 dark:text-orange-400">等待 Qoder 拉起适配器…（页面每 3 秒自动重试）</span>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Input className="min-w-0 flex-1" value={bridgeConfig.token} readOnly placeholder="开启通道后自动生成" />
                                    <Button size="small" disabled={!bridgeConfig.token} onClick={() => copyText(bridgeConfig.token, "令牌已复制")}>
                                        复制令牌
                                    </Button>
                                    <Popconfirm title="重新生成令牌？" description="重新生成后旧令牌立即失效，需同步更新 Qoder 中的注册配置。" okText="重新生成" cancelText="取消" onConfirm={handleRegenerateBridgeToken}>
                                        <Button size="small">重新生成</Button>
                                    </Popconfirm>
                                </div>
                                {bridgeAutoRegistered ? (
                                    <details className="opacity-60">
                                        <summary className="cursor-pointer select-none text-xs text-stone-500">自动注册已生效：手动注册配置已折叠（仅作降级路径）</summary>
                                        <div className="mt-2 space-y-3">{bridgeManualRegistrationBlock}</div>
                                    </details>
                                ) : (
                                    bridgeManualRegistrationBlock
                                )}
                                <div className="text-xs leading-5 text-stone-500">
                                    使用步骤：① 保持本页开启；② 复制注册配置粘贴到 Qoder 的 MCP 设置并保存；③ Qoder 拉起适配器后本页自动完成连接；④ 在 Qoder 中创作剧本与分镜并驱动生成。注意：仅本机回环通信（ws://127.0.0.1:9801）；需保持漫剧页面打开；https 部署下浏览器会拦截本地 ws 连接；一键成片需登录账号。
                                </div>
                            </div>
                        ) : null}
                    </section>
                    {(!isMimoTtsModel(config.audioModel) || isMimoPresetTtsModel(config.audioModel) || isMimoVoiceCloneModel(config.audioModel)) && !glmTts && !grokTts ? (
                        <Form.Item label="默认音频指令" className="mb-4">
                            <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                        </Form.Item>
                    ) : null}
                    <div className="mb-4 text-xs leading-5 text-stone-500">{VOICE_DIRECTION_GUIDE}</div>
                    {effectiveMode === "local" ? (
                        <Form.Item label="系统提示词" className="mb-0">
                            <Input.TextArea rows={3} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                        </Form.Item>
                    ) : null}
                </Form>
            </div>
            </Modal>
            {modelSelectChannel ? (
                <ChannelModelSelectorModal
                    models={modelSelectChannel.models}
                    presets={modelSelectChannel.protocol === COMFYUI_WORKFLOW_PROTOCOL ? COMFYUI_WORKFLOW_PRESETS : undefined}
                    onCancel={closeLocalModelSelector}
                    onConfirm={confirmLocalModelSelector}
                    onFetchModels={fetchLocalModelList}
                />
            ) : null}
        </>
    );
}

function FeatureSwitch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{title}</div>
                <Switch checked={checked} onChange={onChange} />
            </div>
            <div className="mt-1 text-xs leading-5 text-stone-500">{description}</div>
        </div>
    );
}

function configForLocalChannel(config: AiConfig, channel: LocalModelChannel): AiConfig {
    return {
        ...config,
        channelMode: "local",
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        localChannels: [{ ...channel }],
        imageChannelId: channel.id,
        videoChannelId: channel.id,
        textChannelId: channel.id,
        audioChannelId: channel.id,
        model: channel.models[0] || config.model,
    };
}

function channelIdForLocalModel(channels: LocalModelChannel[], model: string, currentId: string) {
    if (!channels.length) return "";
    if (channels.some((channel) => channel.id === currentId && (!model || channel.models.includes(model)))) return currentId;
    return channels.find((channel) => model && channel.models.includes(model))?.id || channels[0].id;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}


function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
