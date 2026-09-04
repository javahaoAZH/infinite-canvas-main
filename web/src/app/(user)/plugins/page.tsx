"use client";

// 插件与渠道独立页（台账批次 A #6）：模型渠道、MCP 双通道（Qoder/ChatGPT）与 ComfyUI 入口从旧配置弹窗迁出为卡片
import { useEffect, useState } from "react";
import { Button, Switch } from "antd";
import Link from "next/link";
import { ArrowRight, Cpu, Plug, Workflow } from "lucide-react";

import { fetchChatGPTChannelStatus, fetchQoderChannelStatus, getChatGPTBridgeSnapshot, getBridgeSnapshot, loadBridgeConfig, onBridgeStatusChange, onChatGPTBridgeStatusChange, regenerateBridgeToken, regenerateChatGPTBridgeToken, setBridgeEnabled, setChatGPTBridgeEnabled, type ChatGPTChannelStatus, type QoderChannelStatus } from "@/app/(user)/drama/services/drama-bridge";
import { useCopyText } from "@/hooks/use-copy-text";
import { normalizeLocalChannels, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
function statusDot(status: "connected" | "connecting" | "disconnected") {
    return status === "connected" ? "bg-emerald-500" : status === "connecting" ? "animate-pulse bg-amber-500" : "bg-orange-500";
}

export default function PluginsPage() {
    const copyText = useCopyText();
    const config = useConfigStore((state) => state.config);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const token = useUserStore((state) => state.token);
    const mcpDisabled = config.mcpMaster === false;
    const channels = normalizeLocalChannels(config);
    const [bridgeConfig, setBridgeConfig] = useState(() => loadBridgeConfig());
    const [bridgeSnapshot, setBridgeSnapshot] = useState(() => getBridgeSnapshot());
    const [chatGPTSnapshot, setChatGPTSnapshot] = useState(() => getChatGPTBridgeSnapshot());
    const [qoderStatus, setQoderStatus] = useState<QoderChannelStatus | null>(null);
    const [chatGPTStatus, setChatGPTStatus] = useState<ChatGPTChannelStatus | null>(null);

    useEffect(() => onBridgeStatusChange(setBridgeSnapshot), []);
    useEffect(() => onChatGPTBridgeStatusChange(setChatGPTSnapshot), []);
    useEffect(() => {
        void Promise.all([fetchQoderChannelStatus().catch(() => null), fetchChatGPTChannelStatus().catch(() => null)]).then(([qoder, chatgpt]) => {
            if (qoder) setQoderStatus(qoder);
            if (chatgpt) setChatGPTStatus(chatgpt);
        });
    }, []);

    const cardClass = "rounded-xl border border-border bg-card/40 p-5";
    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-6 py-10">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">插件与渠道</h1>
                    <p className="mt-1 text-sm text-muted-foreground">模型渠道、桌面 MCP 双通道与 ComfyUI 工作流入口</p>
                </div>

                <section className={cardClass}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <Cpu className="size-4 text-muted-foreground" />
                            <div>
                                <div className="text-sm font-medium text-foreground">模型渠道</div>
                                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                    {config.channelMode === "remote"
                                        ? `云端渠道 · 可用 ${publicSettings?.modelChannel?.availableModels.length || 0} 个模型`
                                        : `${channels.length} 个本地渠道 · ${channels.map((channel) => channel.name || "未命名").join("、")}`}
                                </div>
                            </div>
                        </div>
                        <Button size="small" href="/settings">
                            前往设置 <ArrowRight className="size-3.5" />
                        </Button>
                    </div>
                </section>

                <section className={cardClass}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <span className={`size-2 shrink-0 rounded-full ${bridgeConfig.enabled ? statusDot(bridgeSnapshot.status) : "bg-stone-300 dark:bg-stone-600"}`} />
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-foreground">Qoder 通道</div>
                                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                    {qoderStatus ? `注册：${qoderStatus.registered ? "已写入" : "未写入"} · 模式：${qoderStatus.mode}` : "Qoder 当大脑写剧本与分镜，本软件负责生成媒体与成片"}
                                </div>
                            </div>
                        </div>
                        <span className="flex shrink-0 items-center gap-2">
                            <Button
                                size="small"
                                disabled={mcpDisabled}
                                onClick={() => {
                                    const tokenText = regenerateBridgeToken();
                                    setBridgeConfig(loadBridgeConfig());
                                    copyText(tokenText, "令牌已重置并复制");
                                }}
                            >
                                重置令牌
                            </Button>
                            <Switch
                                size="small"
                                disabled={mcpDisabled}
                                checked={bridgeConfig.enabled}
                                onChange={(checked) => {
                                    setBridgeEnabled(checked);
                                    setBridgeConfig(loadBridgeConfig());
                                }}
                            />
                        </span>
                    </div>
                </section>

                <section className={cardClass}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <span className={`size-2 shrink-0 rounded-full ${bridgeConfig.chatGPTEnabled ? statusDot(chatGPTSnapshot.status) : "bg-stone-300 dark:bg-stone-600"}`} />
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-foreground">ChatGPT 桌面通道</div>
                                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                    {chatGPTStatus ? `注册：${chatGPTStatus.registered ? "已写入" : "未写入"} · 端口 ${chatGPTStatus.port}` : "自动写入 ChatGPT 与 Codex 共用的本机 MCP 配置"}
                                </div>
                            </div>
                        </div>
                        <span className="flex shrink-0 items-center gap-2">
                            <Button
                                size="small"
                                disabled={mcpDisabled}
                                onClick={() => {
                                    const tokenText = regenerateChatGPTBridgeToken();
                                    setBridgeConfig(loadBridgeConfig());
                                    copyText(tokenText, "令牌已重置并复制");
                                }}
                            >
                                重置令牌
                            </Button>
                            <Switch
                                size="small"
                                disabled={mcpDisabled}
                                checked={bridgeConfig.chatGPTEnabled}
                                onChange={(checked) => {
                                    setChatGPTBridgeEnabled(checked);
                                    setBridgeConfig(loadBridgeConfig());
                                }}
                            />
                        </span>
                    </div>
                </section>

                <section className={cardClass}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <Workflow className="size-4 text-muted-foreground" />
                            <div>
                                <div className="text-sm font-medium text-foreground">ComfyUI 工作流</div>
                                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">ComfyUI 协议渠道的节点契约与工作流预设</div>
                            </div>
                        </div>
                        <Button size="small" href="/drama">
                            进入漫剧 <ArrowRight className="size-3.5" />
                        </Button>
                    </div>
                </section>

                {!token ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                        提示：登录后可使用云端渠道与账号配置同步，
                        <Link href="/login" className="underline underline-offset-2">
                            去登录
                        </Link>
                    </p>
                ) : null}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Plug className="size-3.5" />
                    MCP 通道仅本机回环通信（Qoder 9801 / ChatGPT 9802），可同时在线。{mcpDisabled ? "当前已被设置页 MCP 总闸停用。" : ""}
                </p>
            </div>
        </main>
    );
}
