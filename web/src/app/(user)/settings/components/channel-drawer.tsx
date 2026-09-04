"use client";

// 单个本地模型渠道的抽屉编辑器：协议/地址/密钥/模型选择，行级即时保存（旧弹窗的「选择」+「删除」迁入）
import { useState } from "react";
import { App, Button, Drawer, Input, Select } from "antd";

import { ChannelModelSelectorModal } from "@/components/channel-model-selector-modal";
import { COMFYUI_WORKFLOW_PRESETS, COMFYUI_WORKFLOW_PRESET_IDS, COMFYUI_WORKFLOW_PROTOCOL, COMFYUI_WORKFLOW_REQUIREMENT_NOTE, modelChannelApiKeyUrls, modelChannelDefaultBaseUrls } from "@/lib/model-channel";
import { fetchImageModels } from "@/services/api/image";
import type { AiConfig, LocalModelChannel } from "@/stores/use-config-store";

const PROTOCOL_OPTIONS = [
    { label: "OpenAI", value: "openai" },
    { label: "Gemini", value: "gemini" },
    { label: "Grok2API", value: "grok2api" },
    { label: "MiniMax & METASO", value: "metaso" },
    { label: "APIMart", value: "apimart" },
    { label: "KIE", value: "kie" },
    { label: "MiMo", value: "mimo" },
    { label: "阿里云百炼", value: "dashscope" },
    { label: "ComfyUI 工作流", value: "comfyui" },
];

type ChannelDrawerProps = {
    channel: LocalModelChannel | null;
    config: AiConfig;
    onClose: () => void;
    onChange: (id: string, patch: Partial<LocalModelChannel>) => void;
    onDelete: (id: string) => void;
};

export function ChannelDrawer({ channel, config, onClose, onChange, onDelete }: ChannelDrawerProps) {
    const { message } = App.useApp();
    const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
    const [fetchingModels, setFetchingModels] = useState(false);

    const fetchModels = async () => {
        if (!channel) return;
        // autodl 无 /models 接口：ComfyUI 协议直接返回标准工作流预设
        if (channel.protocol === COMFYUI_WORKFLOW_PROTOCOL) {
            onChange(channel.id, { models: [...COMFYUI_WORKFLOW_PRESET_IDS] });
            return;
        }
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        setFetchingModels(true);
        try {
            const models = await fetchImageModels({
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
            });
            const unique = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
            onChange(channel.id, { models: unique });
            message.success(`已拉取 ${unique.length} 个模型`);
        } catch (error) {
            message.error(error instanceof Error ? `拉取模型失败：${error.message}` : "拉取模型失败");
        } finally {
            setFetchingModels(false);
        }
    };

    return (
        <>
            <Drawer title={channel ? `编辑渠道 · ${channel.name || "未命名"}` : "编辑渠道"} size={480} open={Boolean(channel)} onClose={onClose} destroyOnClose>
                {channel ? (
                    <div className="space-y-4">
                        <label className="grid gap-1 text-xs text-muted-foreground">
                            渠道名称
                            <Input value={channel.name} placeholder="渠道名称" onChange={(event) => onChange(channel.id, { name: event.target.value })} />
                        </label>
                        <label className="grid gap-1 text-xs text-muted-foreground">
                            协议
                            <Select
                                value={channel.protocol}
                                options={PROTOCOL_OPTIONS}
                                onChange={(protocol: LocalModelChannel["protocol"]) =>
                                    onChange(channel.id, { protocol, baseUrl: modelChannelDefaultBaseUrls[protocol], ...(protocol === COMFYUI_WORKFLOW_PROTOCOL && !channel.models.length ? { models: [...COMFYUI_WORKFLOW_PRESET_IDS] } : {}) })
                                }
                            />
                        </label>
                        <label className="grid gap-1 text-xs text-muted-foreground">
                            Base URL
                            <Input value={channel.baseUrl} placeholder="Base URL" onChange={(event) => onChange(channel.id, { baseUrl: event.target.value })} />
                        </label>
                        <label className="grid gap-1 text-xs text-muted-foreground">
                            API Key
                            <Input.Password value={channel.apiKey} placeholder="API Key" onChange={(event) => onChange(channel.id, { apiKey: event.target.value })} />
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="small" loading={fetchingModels} onClick={() => void fetchModels()}>
                                拉取模型列表
                            </Button>
                            <Button size="small" onClick={() => setModelSelectorOpen(true)}>
                                选择模型（已存 {channel.models.length}）
                            </Button>
                            {modelChannelApiKeyUrls[channel.protocol] ? (
                                <Button size="small" type="primary" href={modelChannelApiKeyUrls[channel.protocol]} target="_blank">
                                    获取 API Key
                                </Button>
                            ) : null}
                        </div>
                        {channel.protocol === COMFYUI_WORKFLOW_PROTOCOL ? <div className="text-xs leading-5 text-muted-foreground">模型名为 autodl 工作流 ID，标准要求：{COMFYUI_WORKFLOW_REQUIREMENT_NOTE}</div> : null}
                        <Button danger block disabled={channel.id === "local-default"} onClick={() => { onDelete(channel.id); onClose(); }}>
                            删除该渠道
                        </Button>
                    </div>
                ) : null}
            </Drawer>
            {channel && modelSelectorOpen ? (
                <ChannelModelSelectorModal
                    models={channel.models}
                    presets={channel.protocol === COMFYUI_WORKFLOW_PROTOCOL ? COMFYUI_WORKFLOW_PRESETS : undefined}
                    onCancel={() => setModelSelectorOpen(false)}
                    onConfirm={(models) => {
                        onChange(channel.id, { models });
                        setModelSelectorOpen(false);
                    }}
                    onFetchModels={async () => {
                        if (channel.protocol === COMFYUI_WORKFLOW_PROTOCOL) return [...COMFYUI_WORKFLOW_PRESET_IDS];
                        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
                            message.error("请先填写该渠道的 Base URL 和 API Key");
                            return undefined;
                        }
                        return Array.from(new Set((await fetchImageModels({
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
                        })).map((model) => model.trim()).filter(Boolean)));
                    }}
                />
            ) : null}
        </>
    );
}
