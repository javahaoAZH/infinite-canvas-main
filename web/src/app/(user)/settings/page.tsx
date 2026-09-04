"use client";

// Codex 同构设置页：左导航（返回应用 + 搜索 + 分组）+ 右侧分区行卡片；旧配置弹窗的 13 块内容已全部迁入本页（渠道编辑进抽屉、行级即时保存）
import { Archive, ArchiveRestore, CircleUser, Clapperboard, Coins, Cpu, FolderOpen, Keyboard, Mic, Plug, Settings2, Sun, Workflow } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Drawer, Input, Modal, Select, Switch, Tag } from "antd";
import Link from "next/link";

import { VOICE_DIRECTION_GUIDE } from "@/app/(user)/drama/prompts";
import {
    fetchChatGPTChannelStatus,
    fetchQoderChannelStatus,
    loadBridgeConfig,
    regenerateBridgeToken,
    regenerateChatGPTBridgeToken,
    setBridgeEnabled,
    setChatGPTBridgeEnabled,
    type ChatGPTChannelStatus,
    type QoderChannelStatus,
} from "@/app/(user)/drama/services/drama-bridge";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { GrokTtsVoiceSelect } from "@/components/grok-tts-voice-select";
import { ModelPicker } from "@/components/model-picker";
import { useCopyText } from "@/hooks/use-copy-text";
import { getRenderFFmpegStatus, saveRenderFFmpegPath, type RenderFFmpegStatus } from "@/services/api/render";
import { audioFormatOptions, audioVoiceOptions, glmTtsFormatOptions, glmTtsVoiceOptions, isGlmTtsModel, normalizeAudioSpeedValue, normalizeGlmTtsFormat, normalizeGlmTtsSpeed, normalizeGlmTtsVoice } from "@/lib/audio-generation";
import { grokTtsFormatOptions, grokTtsLanguageOptions, isGrok2APITtsConfig, normalizeGrokTtsFormat, normalizeGrokTtsLanguage, normalizeGrokTtsSpeed } from "@/lib/grok-tts";
import { isGeminiConfig, isGeminiTtsModel } from "@/lib/gemini";
import { geminiTtsVoiceOptions, normalizeGeminiTtsVoice } from "@/lib/gemini-tts";
import { isMimoPresetTtsModel, isMimoTtsModel, isMimoVoiceCloneModel, isMimoVoiceDesignModel, mimoTtsFormatOptions, mimoTtsVoiceOptions } from "@/lib/mimo-tts";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { SettingsRow, SettingsSection } from "./components/rows";
import { ModelChannelsSection } from "./components/model-channels-section";
import { StorageSection } from "./components/storage-section";

type SectionKey = "general" | "appearance" | "voice" | "shortcuts" | "usage" | "account" | "models" | "advanced" | "storage" | "mcp" | "comfyui" | "approval" | "ffmpeg" | "paths" | "archived";

const NAV: { group: string; items: { key: SectionKey; label: string; icon: ReactNode }[] }[] = [
    {
        group: "个人",
        items: [
            { key: "general", label: "常规", icon: <Settings2 className="size-4" /> },
            { key: "appearance", label: "外观", icon: <Sun className="size-4" /> },
            { key: "voice", label: "语音", icon: <Mic className="size-4" /> },
            { key: "shortcuts", label: "键盘快捷键", icon: <Keyboard className="size-4" /> },
            { key: "usage", label: "使用情况和计费", icon: <Coins className="size-4" /> },
            { key: "account", label: "账户", icon: <CircleUser className="size-4" /> },
        ],
    },
    {
        group: "集成",
        items: [
            { key: "models", label: "模型渠道", icon: <Cpu className="size-4" /> },
            { key: "advanced", label: "高级", icon: <Settings2 className="size-4" /> },
            { key: "storage", label: "存储", icon: <FolderOpen className="size-4" /> },
            { key: "mcp", label: "MCP 渠道", icon: <Plug className="size-4" /> },
            { key: "comfyui", label: "ComfyUI", icon: <Workflow className="size-4" /> },
        ],
    },
    {
        group: "生产",
        items: [
            { key: "approval", label: "审批与速度", icon: <Clapperboard className="size-4" /> },
            { key: "ffmpeg", label: "FFmpeg 与合成", icon: <Clapperboard className="size-4" /> },
            { key: "paths", label: "项目目录", icon: <FolderOpen className="size-4" /> },
        ],
    },
    {
        group: "已归档",
        items: [{ key: "archived", label: "已归档的画布", icon: <Archive className="size-4" /> }],
    },
];

const SHORTCUTS: { keys: string; action: string }[] = [
    { keys: "Ctrl + Z", action: "撤销画布操作" },
    { keys: "Ctrl + Y", action: "重做画布操作" },
    { keys: "Ctrl + A", action: "全选节点" },
    { keys: "Ctrl + C / V", action: "复制 / 粘贴节点" },
    { keys: "Ctrl + G", action: "节点编组" },
    { keys: "Delete / Backspace", action: "删除选中节点" },
    { keys: "Esc", action: "关闭预览 / 取消选择" },
    { keys: "← / →", action: "预览图组内切换" },
];

export default function SettingsPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const effectiveConfig = useEffectiveConfig();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const token = useUserStore((state) => state.token);
    const logout = useUserStore((state) => state.clearSession);
    const canvasProjects = useCanvasStore((state) => state.projects);
    // 选择器必须返回稳定引用：派生数组用 useMemo，否则 useSyncExternalStore 无限重渲染（React #185）
    const archivedProjects = useMemo(() => canvasProjects.filter((item) => item.archived), [canvasProjects]);
    const setProjectArchived = useCanvasStore((state) => state.setProjectArchived);
    const [search, setSearch] = useState("");
    const [active, setActive] = useState<SectionKey>("general");
    const [bridgeConfig, setBridgeConfig] = useState(() => loadBridgeConfig());
    const [qoderStatus, setQoderStatus] = useState<QoderChannelStatus | null>(null);
    const [chatGPTStatus, setChatGPTStatus] = useState<ChatGPTChannelStatus | null>(null);
    const [ffmpegStatus, setFfmpegStatus] = useState<RenderFFmpegStatus | null>(null);
    const [ffmpegPath, setFfmpegPath] = useState("");
    const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
    const [licenseOpen, setLicenseOpen] = useState(false);
    const dramaProjects = useDramaStore((state) => state.projects);
    const activeDramaProject = dramaProjects.find((project) => project.id === useDramaStore.getState().activeId) || dramaProjects[0] || null;
    const query = search.trim().toLowerCase();

    // 音频/TTS 形态判定（与旧配置弹窗一致，跟随当前音频模型的协议形态切换行）
    const glmTts = isGlmTtsModel(config.audioModel);
    const grokTts = isGrok2APITtsConfig(effectiveConfig, config.audioModel);
    const geminiTts = isGeminiTtsModel(config.audioModel) && isGeminiConfig(effectiveConfig, config.audioModel);

    useEffect(() => {
        void Promise.all([fetchQoderChannelStatus().catch(() => null), fetchChatGPTChannelStatus().catch(() => null)]).then(([qoder, chatgpt]) => {
            if (qoder) setQoderStatus(qoder);
            if (chatgpt) setChatGPTStatus(chatgpt);
        });
        setBridgeConfig(loadBridgeConfig());
    }, []);
    useEffect(() => {
        if (!token) return;
        void getRenderFFmpegStatus(token)
            .then((status) => {
                setFfmpegStatus(status);
                setFfmpegPath(status.path || "");
            })
            .catch(() => undefined);
    }, [token]);

    const navItems = useMemo(() => NAV.flatMap((group) => group.items), []);
    const visibleNav = navItems.filter((item) => !query || item.label.toLowerCase().includes(query));

    const jump = (key: SectionKey) => {
        setActive(key);
        document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
        <div className="flex h-full min-h-0">
            <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3">
                <Link href="/" className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground">
                    ← 返回应用
                </Link>
                <Input size="small" allowClear placeholder="搜索设置…" value={search} onChange={(event) => setSearch(event.target.value)} className="mb-2" />
                {NAV.map((group) => {
                    const items = group.items.filter((item) => visibleNav.includes(item));
                    if (!items.length) return null;
                    return (
                        <div key={group.group} className="mb-1">
                            <div className="px-3 pb-1 pt-2 text-xs text-muted-foreground">{group.group}</div>
                            {items.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => jump(item.key)}
                                    className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
                                        active === item.key ? "bg-foreground/10 font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                                    }`}
                                >
                                    {item.icon}
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    );
                })}
            </aside>

            <main className="min-w-0 flex-1 overflow-y-auto p-8">
                <div className="mx-auto flex max-w-3xl flex-col gap-8">
                    <SettingsSection id="general" title="常规" search={query}>
                        <SettingsRow
                            search={query}
                            title="语言"
                            desc="应用界面语言"
                            control={<Select size="small" value="zh-CN" options={[{ label: "简体中文", value: "zh-CN" }]} className="w-32" />}
                        />
                        <SettingsRow
                            search={query}
                            title="系统提示词"
                            desc="画布助手的默认系统提示词，留空使用内置版本"
                            control={<Button size="small" onClick={() => setPromptDrawerOpen(true)}>配置</Button>}
                        />
                        <SettingsRow
                            search={query}
                            title="提示词建议"
                            desc="首页 composer 下方显示可点击的创作建议"
                            control={<Switch size="small" checked={config.showSuggestions !== ""} onChange={(checked) => updateConfig("showSuggestions", checked ? "1" : "")} />}
                        />
                    </SettingsSection>

                    <SettingsSection id="appearance" title="外观" search={query}>
                        <SettingsRow
                            search={query}
                            title="主题"
                            desc="深色为默认，对标 Codex 桌面版观感"
                            control={
                                <Select
                                    size="small"
                                    value={theme}
                                    options={[
                                        { label: "深色", value: "dark" },
                                        { label: "浅色", value: "light" },
                                    ]}
                                    className="w-32"
                                    onChange={(value) => setTheme(value)}
                                />
                            }
                        />
                    </SettingsSection>

                    <SettingsSection id="voice" title="语音" search={query}>
                        <SettingsRow search={query} title="配音模型" desc={config.audioModel || "未配置"} control={<ModelPicker config={effectiveConfig} value={config.audioModel} capability="audio" channelId={config.audioChannelId} onChange={(model, channelId) => { updateConfig("audioModel", model); if (channelId) updateConfig("audioChannelId", channelId); }} onMissingConfig={() => message.warning("请先到模型渠道添加并配置渠道")} />} />
                        {geminiTts ? (
                            <SettingsRow search={query} title="默认 Gemini 音色" control={<Select size="small" showSearch optionFilterProp="label" value={normalizeGeminiTtsVoice(config.geminiTtsVoice)} options={geminiTtsVoiceOptions} onChange={(value) => updateConfig("geminiTtsVoice", value)} />} />
                        ) : isMimoPresetTtsModel(config.audioModel) ? (
                            <SettingsRow search={query} title="默认 MiMo 音色" control={<Select size="small" value={config.mimoTtsVoice} options={[...mimoTtsVoiceOptions]} onChange={(value) => updateConfig("mimoTtsVoice", value)} />} />
                        ) : isMimoVoiceDesignModel(config.audioModel) ? (
                            <SettingsRow search={query} title="默认音色描述" desc="用自然语言描述目标音色" control={<Input size="small" className="w-64" value={config.mimoVoiceDesignPrompt} placeholder="例如：年轻女性，声音清亮自然，有亲和力。" onChange={(event) => updateConfig("mimoVoiceDesignPrompt", event.target.value)} />} />
                        ) : isMimoTtsModel(config.audioModel) ? null : (
                            <SettingsRow
                                search={query}
                                title="默认音色"
                                control={
                                    grokTts ? (
                                        <GrokTtsVoiceSelect config={effectiveConfig} model={config.audioModel} value={config.grokTtsVoice} enabled onChange={(value) => updateConfig("grokTtsVoice", value)} />
                                    ) : (
                                        <Select size="small" value={glmTts ? normalizeGlmTtsVoice(config.glmTtsVoice) : config.audioVoice} options={glmTts ? glmTtsVoiceOptions : audioVoiceOptions} onChange={(value) => updateConfig(glmTts ? "glmTtsVoice" : "audioVoice", value)} />
                                    )
                                }
                            />
                        )}
                        {grokTts ? <SettingsRow search={query} title="默认音频语言" control={<Select size="small" value={normalizeGrokTtsLanguage(config.grokTtsLanguage)} options={grokTtsLanguageOptions} showSearch optionFilterProp="label" onChange={(value) => updateConfig("grokTtsLanguage", value)} />} /> : null}
                        {!geminiTts ? (
                            <SettingsRow
                                search={query}
                                title="默认音频格式"
                                control={
                                    <Select
                                        size="small"
                                        className="w-24"
                                        value={isMimoTtsModel(config.audioModel) ? config.mimoTtsFormat : glmTts ? normalizeGlmTtsFormat(config.glmTtsFormat) : grokTts ? normalizeGrokTtsFormat(config.grokTtsFormat) : config.audioFormat}
                                        options={isMimoTtsModel(config.audioModel) ? [...mimoTtsFormatOptions] : glmTts ? glmTtsFormatOptions : grokTts ? grokTtsFormatOptions : audioFormatOptions}
                                        onChange={(value) => (isMimoTtsModel(config.audioModel) ? updateConfig("mimoTtsFormat", value) : updateConfig(glmTts ? "glmTtsFormat" : grokTts ? "grokTtsFormat" : "audioFormat", value))}
                                    />
                                }
                            />
                        ) : null}
                        {!geminiTts && !isMimoTtsModel(config.audioModel) ? (
                            <SettingsRow
                                search={query}
                                title="默认音频语速"
                                control={
                                    <Input
                                        size="small"
                                        type="number"
                                        className="w-24"
                                        min={glmTts ? 0.5 : grokTts ? 0.7 : 0.25}
                                        max={glmTts ? 2 : grokTts ? 1.5 : 4}
                                        step={0.05}
                                        value={glmTts ? config.glmTtsSpeed : grokTts ? config.grokTtsSpeed : config.audioSpeed}
                                        onChange={(event) => updateConfig(glmTts ? "glmTtsSpeed" : grokTts ? "grokTtsSpeed" : "audioSpeed", event.target.value)}
                                        onBlur={(event) => updateConfig(glmTts ? "glmTtsSpeed" : grokTts ? "grokTtsSpeed" : "audioSpeed", glmTts ? normalizeGlmTtsSpeed(event.target.value) : grokTts ? normalizeGrokTtsSpeed(event.target.value) : normalizeAudioSpeedValue(event.target.value))}
                                    />
                                }
                            />
                        ) : null}
                        {(!isMimoTtsModel(config.audioModel) || isMimoPresetTtsModel(config.audioModel) || isMimoVoiceCloneModel(config.audioModel)) && !glmTts && !grokTts ? (
                            <SettingsRow search={query} title="默认音频指令" desc="随请求下发的声音表演指令" control={<Input size="small" className="w-64" value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />} />
                        ) : null}
                        <SettingsRow
                            search={query}
                            title="配音指引"
                            desc="声音身份与表演分离、判据可听带反例、易混角色区分、专名发音唯一化"
                            control={
                                <Button
                                    size="small"
                                    onClick={() =>
                                        Modal.info({ title: "全局配音指引", width: 560, content: <p className="whitespace-pre-wrap text-sm leading-6">{VOICE_DIRECTION_GUIDE}</p> })
                                    }
                                >
                                    查看
                                </Button>
                            }
                        />
                        <SettingsRow search={query} title="漫剧配音" desc="角色音色参考与逐条配音在 AI 漫剧流程内维护" control={<Button size="small" href="/drama">进入漫剧</Button>} />
                    </SettingsSection>

                    <SettingsSection id="shortcuts" title="键盘快捷键" search={query}>
                        {SHORTCUTS.map((item) => (
                            <SettingsRow key={item.keys} search={query} title={item.action} control={<Tag className="m-0 font-mono">{item.keys}</Tag>} />
                        ))}
                        <SettingsRow
                            search={query}
                            title="快捷键速查弹窗"
                            desc="任意页面按 Ctrl+/ 或点击此处查看三态速查面板"
                            control={
                                <Button
                                    size="small"
                                    onClick={() =>
                                        Modal.info({
                                            title: "键盘快捷键",
                                            width: 480,
                                            content: (
                                                <div className="space-y-1.5">
                                                    {SHORTCUTS.map((item) => (
                                                        <div key={item.keys} className="flex items-center justify-between gap-3 text-xs">
                                                            <span>{item.action}</span>
                                                            <Tag className="m-0 font-mono">{item.keys}</Tag>
                                                        </div>
                                                    ))}
                                                </div>
                                            ),
                                        })
                                    }
                                >
                                    打开面板
                                </Button>
                            }
                        />
                    </SettingsSection>

                    <SettingsSection id="usage" title="使用情况和计费" search={query}>
                        <SettingsRow
                            search={query}
                            title="剩余用量"
                            desc="算力点余额，生成图片与视频按渠道计费扣除"
                            control={
                                <span className="flex items-center gap-2 text-sm font-medium tabular-nums text-foreground">
                                    {(user?.credits ?? 0).toLocaleString()}
                                    <Button size="small" href="/cost">
                                        明细
                                    </Button>
                                </span>
                            }
                        />
                    </SettingsSection>

                    <SettingsSection id="account" title="账户" search={query}>
                        <SettingsRow
                            search={query}
                            title={user ? `${user.displayName || user.username}（${user.role === "admin" ? "管理员" : "标准版"}）` : "未登录"}
                            desc={user ? "登录态用于资产与画布云端同步" : "登录后资产与画布可同步到账号"}
                            control={
                                user ? (
                                    <Button size="small" danger onClick={logout}>
                                        退出登录
                                    </Button>
                                ) : (
                                    <Button size="small" type="primary" href="/login">
                                        登录
                                    </Button>
                                )
                            }
                        />
                        {user?.role === "admin" ? <SettingsRow search={query} title="管理后台" desc="渠道、用户与全局 FFmpeg 等管理入口" control={<Button size="small" href="/admin">进入</Button>} /> : null}
                        <SettingsRow
                            search={query}
                            title="版本与开源"
                            desc="v0.5.8 · 第三方依赖声明见仓库"
                            control={
                                <span className="flex items-center gap-2">
                                    <Button size="small" onClick={() => setLicenseOpen(true)}>
                                        第三方声明
                                    </Button>
                                    <Button size="small" href="https://github.com/tigerowo/infinite-canvas" target="_blank">
                                        GitHub
                                    </Button>
                                </span>
                            }
                        />
                    </SettingsSection>

                    <ModelChannelsSection search={query} />

                    <SettingsSection id="advanced" title="高级" search={query}>
                        <SettingsRow
                            search={query}
                            title="流式传输"
                            desc="开启后请求中追加 stream，支持读取中间图片事件并避免长时间无数据"
                            control={<Switch size="small" checked={Boolean(config.streamImages)} onChange={(checked) => updateConfig("streamImages", checked ? "1" : "")} />}
                        />
                        <SettingsRow
                            search={query}
                            title="返回 Base64 图片数据"
                            desc="开启后 Image API 请求会追加 response_format: b64_json"
                            control={<Switch size="small" checked={Boolean(config.responseFormatB64Json)} onChange={(checked) => updateConfig("responseFormatB64Json", checked ? "1" : "")} />}
                        />
                        <SettingsRow
                            search={query}
                            title="Codex CLI 兼容模式"
                            desc="开启后减少不兼容参数，并追加防提示词改写前缀"
                            control={<Switch size="small" checked={Boolean(config.codexCli)} onChange={(checked) => updateConfig("codexCli", checked ? "1" : "")} />}
                        />
                    </SettingsSection>

                    <StorageSection search={query} />

                    <SettingsSection id="mcp" title="MCP 渠道" search={query}>
                        <SettingsRow
                            search={query}
                            title="MCP 总闸"
                            desc="总开关：关闭后立即停用下方全部通道并禁用其开关"
                            control={
                                <Switch
                                    size="small"
                                    checked={config.mcpMaster !== false}
                                    onChange={(checked) => {
                                        updateConfig("mcpMaster", checked);
                                        if (!checked) {
                                            setBridgeEnabled(false);
                                            setChatGPTBridgeEnabled(false);
                                            setBridgeConfig(loadBridgeConfig());
                                            message.info("已停用全部 MCP 通道");
                                        }
                                    }}
                                />
                            }
                        />
                        <SettingsRow
                            search={query}
                            title="Qoder 通道"
                            desc={qoderStatus ? `注册：${qoderStatus.registered ? "已写入" : "未写入"} · 模式：${qoderStatus.mode}` : "桌面 MCP 客户端接入 Qoder"}
                            control={
                                <span className="flex items-center gap-2">
                                    <Button
                                        size="small"
                                        disabled={config.mcpMaster === false}
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
                                        disabled={config.mcpMaster === false}
                                        checked={bridgeConfig.enabled}
                                        onChange={(checked) => {
                                            setBridgeEnabled(checked);
                                            setBridgeConfig(loadBridgeConfig());
                                        }}
                                    />
                                </span>
                            }
                        />
                        <SettingsRow
                            search={query}
                            title="ChatGPT 通道"
                            desc={chatGPTStatus ? `注册：${chatGPTStatus.registered ? "已写入" : "未写入"} · 端口 ${chatGPTStatus.port}` : "桌面 MCP 客户端接入 ChatGPT / Codex"}
                            control={
                                <span className="flex items-center gap-2">
                                    <Button
                                        size="small"
                                        disabled={config.mcpMaster === false}
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
                                        disabled={config.mcpMaster === false}
                                        checked={bridgeConfig.chatGPTEnabled}
                                        onChange={(checked) => {
                                            setChatGPTBridgeEnabled(checked);
                                            setBridgeConfig(loadBridgeConfig());
                                        }}
                                    />
                                </span>
                            }
                        />
                    </SettingsSection>

                    <SettingsSection id="comfyui" title="ComfyUI" search={query}>
                        <SettingsRow search={query} title="工作流管理" desc="ComfyUI 工作流渠道的节点契约与预设 ID 在漫剧页维护" control={<Button size="small" href="/drama">进入漫剧</Button>} />
                    </SettingsSection>

                    <SettingsSection id="approval" title="审批与速度" search={query}>
                        <SettingsRow
                            search={query}
                            title="默认权限"
                            desc="逐镜确认：代表帧生成后需手动确认；门禁通过后自动：代表帧生成成功即自动确认（导演台/自动生产仍按门禁规则执行）"
                            control={
                                <Select
                                    size="small"
                                    className="w-40"
                                    value={config.productionApprovalMode || "manual"}
                                    options={[
                                        { label: "逐镜确认", value: "manual" },
                                        { label: "门禁通过后自动", value: "auto" },
                                    ]}
                                    onChange={(value) => updateConfig("productionApprovalMode", value)}
                                />
                            }
                        />
                        <SettingsRow
                            search={query}
                            title="速度档"
                            desc="标准：文本 1/立绘 1/分镜图 2/视频 2/配音 3；加速：各项并发加倍（影响导演台自动生产派发）"
                            control={
                                <Select
                                    size="small"
                                    className="w-28"
                                    value={config.renderSpeed || "std"}
                                    options={[
                                        { label: "标准", value: "std" },
                                        { label: "加速", value: "fast" },
                                    ]}
                                    onChange={(value) => updateConfig("renderSpeed", value)}
                                />
                            }
                        />
                    </SettingsSection>

                    <SettingsSection id="ffmpeg" title="FFmpeg 与合成" search={query}>
                        <SettingsRow
                            search={query}
                            title="FFmpeg 状态"
                            desc={ffmpegStatus ? (ffmpegStatus.available ? `可用 · ${ffmpegStatus.version || "未知版本"} · 来源 ${ffmpegStatus.source}` : `不可用：${ffmpegStatus.reason}`) : "加载中…"}
                            control={ffmpegStatus?.available ? <Tag color="success" className="m-0">可用</Tag> : <Tag color="warning" className="m-0">不可用</Tag>}
                        />
                        <SettingsRow
                            search={query}
                            title="FFmpeg 路径"
                            desc={user?.role === "admin" ? "留空表示自动探测" : "全局 FFmpeg 路径由管理员维护"}
                            control={
                                <span className="flex items-center gap-2">
                                    <Input size="small" className="w-64 font-mono" value={ffmpegPath} disabled={user?.role !== "admin"} onChange={(event) => setFfmpegPath(event.target.value)} />
                                    <Button
                                        size="small"
                                        disabled={user?.role !== "admin" || !token}
                                        onClick={() => {
                                            if (!token) return;
                                            void saveRenderFFmpegPath(token, ffmpegPath.trim())
                                                .then(() => getRenderFFmpegStatus(token))
                                                .then((status) => {
                                                    setFfmpegStatus(status);
                                                    message.success("已保存");
                                                })
                                                .catch((error) => message.error(error instanceof Error ? error.message : "保存失败"));
                                        }}
                                    >
                                        保存
                                    </Button>
                                </span>
                            }
                        />
                    </SettingsSection>

                    <SettingsSection id="paths" title="项目目录" search={query}>
                        <SettingsRow
                            search={query}
                            title="资产项目目录"
                            desc={activeDramaProject ? `当前项目「${activeDramaProject.title}」绑定：${activeDramaProject.assetProject || activeDramaProject.title}（D:/InfiniteCanvas 下）` : "D:/InfiniteCanvas 下的项目文件夹；在漫剧项目内绑定"}
                            control={
                                <span className="flex items-center gap-2">
                                    <Button size="small" href="/assets">
                                        管理
                                    </Button>
                                    <Button size="small" href="/drama">
                                        更改
                                    </Button>
                                </span>
                            }
                        />
                        <SettingsRow search={query} title="桌面数据目录" desc="data/（数据库、日志与渲染任务）" control={<Tag className="m-0 font-mono">data/</Tag>} />
                    </SettingsSection>

                    <SettingsSection id="archived" title="已归档的画布" search={query}>
                        {archivedProjects.length ? (
                            archivedProjects.map((project) => (
                                <SettingsRow
                                    key={project.id}
                                    search={query}
                                    title={project.title}
                                    desc={`归档于侧栏项目菜单 · 更新于 ${new Date(project.updatedAt).toLocaleDateString()}`}
                                    control={
                                        <Button size="small" icon={<ArchiveRestore className="size-3.5" />} onClick={() => setProjectArchived(project.id, false)}>
                                            取消归档
                                        </Button>
                                    }
                                />
                            ))
                        ) : (
                            <SettingsRow search={query} title="暂无归档画布" desc="在侧栏项目行的 ⋯ 菜单中可归档画布" control={null} />
                        )}
                    </SettingsSection>
                </div>
            </main>

            <Drawer title="系统提示词" size={480} open={promptDrawerOpen} onClose={() => setPromptDrawerOpen(false)}>
                <p className="mb-3 text-xs leading-5 text-muted-foreground">画布助手的默认系统提示词，留空使用内置版本；保存即时生效。</p>
                <Input.TextArea
                    rows={8}
                    value={config.systemPrompt}
                    placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。"
                    onChange={(event) => updateConfig("systemPrompt", event.target.value)}
                />
            </Drawer>

            <Modal title="第三方开源声明" open={licenseOpen} width={560} footer={<Button type="primary" onClick={() => setLicenseOpen(false)}>知道了</Button>} onCancel={() => setLicenseOpen(false)}>
                <div className="space-y-2 text-xs leading-5 text-muted-foreground">
                    <p>本软件基于 MIT 协议开源，并依赖以下主要第三方开源项目（含其依赖树）：</p>
                    <p>前端：Next.js · React · TypeScript · Ant Design · Tailwind CSS · Zustand · TanStack Query · localforage · lucide-react · nanoid · file-saver · Codemirror · photo-sphere-viewer</p>
                    <p>后端：Go · Gin · GORM · glebarez/sqlite（modernc.org/sqlite）· mcp-go</p>
                    <p>桌面与工具：go-webview2 · Bun · Docker</p>
                    <p>各项目版权归其原作者所有，遵循各自的开源协议（MIT / Apache-2.0 / BSD 等）。完整依赖清单见仓库 package.json / go.mod。</p>
                </div>
            </Modal>
        </div>
    );
}
