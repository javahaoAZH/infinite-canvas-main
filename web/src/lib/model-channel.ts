export type ModelChannelProtocol = "openai" | "gemini" | "grok2api" | "metaso" | "apimart" | "kie" | "mimo" | "dashscope" | "comfyui";

export const modelChannelDefaultBaseUrls: Record<ModelChannelProtocol, string> = {
    openai: "https://api.openai.com",
    gemini: "https://generativelanguage.googleapis.com",
    grok2api: "",
    metaso: "https://metaso.cn/api/minimax",
    apimart: "https://api.apimart.ai/v1",
    kie: "https://api.kie.ai/api/v1",
    mimo: "https://api.xiaomimimo.com",
    dashscope: "https://dashscope.aliyuncs.com",
    comfyui: "https://www.autodl.art/api/v1/comfyui",
};

export const modelChannelApiKeyUrls: Partial<Record<ModelChannelProtocol, string>> = {
    metaso: "https://metaso.cn/minimax-h3/?s=tt",
    apimart: "https://apimart.ai/register?aff=fWMrEv",
    mimo: "https://platform.xiaomimimo.com/?ref=JFZQR2",
    dashscope: "https://bailian.console.aliyun.com/",
    comfyui: "https://www.autodl.art/large-model/tokens",
};

// autodl ComfyUI 工作流渠道：模型名即 workflow_id
export const COMFYUI_WORKFLOW_PROTOCOL = "comfyui";
// H3 多图参考生视频：首帧 + 最多 9 张参考图 + 提示词（非对白镜头）
export const COMFYUI_WORKFLOW_MULTI_REF_VIDEO = "minimax_h3_lightx2v_v5";
// H3 图生视频-音频同步：分镜图 + 配音音频 → 自动对口型（对白镜头，无提示词字段）
export const COMFYUI_WORKFLOW_LIP_SYNC_VIDEO = "minimax_h3_image_audio_to_video";
// IndexTTS2 配音：台词 + 音色参考音频（音色克隆）
export const COMFYUI_WORKFLOW_INDEX_TTS = "indextts2-v1";

// 标准工作流模型集：协议为 ComfyUI 工作流时按此预设登记模型与展示中文名称
export const COMFYUI_WORKFLOW_PRESETS = [
    { value: COMFYUI_WORKFLOW_MULTI_REF_VIDEO, label: "H3 多图参考生视频（非对白镜头）" },
    { value: COMFYUI_WORKFLOW_LIP_SYNC_VIDEO, label: "H3 对口型视频（对白镜头）" },
    { value: COMFYUI_WORKFLOW_INDEX_TTS, label: "IndexTTS2 配音（音色克隆）" },
];
export const COMFYUI_WORKFLOW_PRESET_IDS = COMFYUI_WORKFLOW_PRESETS.map((item) => item.value);

// 工作流标准入参要求（请求构造已内置），设置页作为配置说明展示
export const COMFYUI_WORKFLOW_REQUIREMENT_NOTE = "分辨率默认 768p 档、对口型无方屏档自动降横屏；生视频秒数自动钳制 1-10 秒、对口型 1-15 秒；配音内置 emo_control_method（与音色参考音频相同）且音色参考需真实人声，对口型音频需公网 URL。";
