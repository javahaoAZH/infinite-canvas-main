// /drama 提示词方法论内置：参考开源项目 zenstory-ai/drama-skills
// （https://github.com/zenstory-ai/drama-skills ，MIT License，基线 commit 3ab6b8550bbccef71001d2187e2b2ac9a74ab917）
// 的 AI 漫剧创作方法论，已按本项目 JSON 数据结构与浏览器直连生成场景用自己的话改写，并裁剪 CLI 工程流程相关内容。

// 剧本结构化系统提示词：输出 JSON schema 保持不变，仅新增内容质量规则
// （对白即行动、每场必有变化、一镜一职责、角色身份锚点）
export const SCRIPT_STRUCTURE_SYSTEM_PROMPT =
    "你是漫剧分镜编剧助手。用户会给你一段剧本文本，你需要把它结构化为漫剧分镜数据。内容质量规则：" +
    "一、对白即行动：每句对白都要有戏剧目的（争取、回避、试探、逼迫或重新定义关系），禁止让角色把剧情资料读给观众听。" +
    "二、每场必须至少改变一项：信息、权力、关系、情绪、物理状态或风险；没有变化的场次并入相邻场；每场结尾留下悬念或未决事项，把压力传给下一场。" +
    "三、分镜规则：一镜只承担一个职责，每次切镜必须带来信息、权力、情绪、空间或节奏之一的变化；开场镜比工作景别宽一档，第二镜落到人物工作景别；地理信息通过人物动作在画面内部交代，不用空镜全景开场；每镜描述只写镜头起点时刻可见的人物、道具与状态。" +
    "四、角色规则：为每个角色写身份锚点，即可见、可生成、可比较的具体事实（发型、发色、服饰件数与材质、标志物），不使用“气质出众”这类空泛词。" +
    "严格按以下 JSON 格式输出，不要输出任何其他文字、注释或代码块标记：" +
    "{\"title\":\"作品标题\",\"characters\":[{\"name\":\"角色名\",\"description\":\"角色外貌与服装描述，用于生成立绘\"}],\"shots\":[{\"description\":\"画面描述（场景、人物动作、构图），用于生成分镜图\",\"dialogue\":\"该分镜的对白，没有则为空字符串\",\"seconds\":5}]}";

export type DramaArtStyle = { id: string; label: string; promptBase: string };

// 九种画面风格：默认不追加风格段；其余八种的 promptBase 是可直接拼进提示词的可观察写法，
// 只描述线条、上色、光影、质感特征，不使用“高质量/精美”类空泛词
export const ART_STYLES: DramaArtStyle[] = [
    { id: "default", label: "默认", promptBase: "" },
    { id: "cel", label: "赛璐璐", promptBase: "清晰封闭描边，大色块平涂上色，明暗两档分层，高光边缘锐利，动画胶片质感" },
    { id: "impasto", label: "厚涂", promptBase: "厚重笔刷堆叠上色，边缘柔和过渡，多层光影渐变，油彩肌理可见，体积感强" },
    { id: "flat", label: "平涂", promptBase: "色块均匀填充，细线勾边，无渐变，阴影压成单色剪影，画面干净利落" },
    { id: "guofeng", label: "国风条漫", promptBase: "工笔细线勾形，水墨晕染背景，淡彩罩染上色，构图大量留白，服饰带古典纹样" },
    { id: "anime", label: "日系二次元", promptBase: "线条细腻流畅，柔和渐变上色，人物大眼比例，脸颊红晕，光感明亮通透" },
    { id: "hk-retro", label: "复古港漫", promptBase: "粗黑外轮廓线，硬朗方折衣纹，网点排线阴影，浓烈撞色，笔触粗犷" },
    { id: "watercolor", label: "水彩", promptBase: "水彩湿画晕染，颜色边缘自然渗化，浅色多层叠涂，保留纸纹颗粒" },
    { id: "minimal", label: "极简", promptBase: "几何简化造型，粗细一致的单一勾勒线，三到五色限定配色，大面积留白" },
];

// 画风 id → 画风对象；未知 id 回落默认（等价不追加风格段）
export function resolveArtStyle(artStyleId: string): DramaArtStyle {
    return ART_STYLES.find((style) => style.id === artStyleId) || ART_STYLES[0];
}

// 角色立绘提示词：身份锚点（角色描述）在前 → 立绘构图与纯白背景 → 风格基底 → 四视图一致性
export function buildCharacterImagePrompt(description: string, artStylePromptBase: string): string {
    const style = artStylePromptBase.trim();
    return [
        `${description.trim()}，角色立绘，全身像，纯白背景`,
        ...(style ? [style] : []),
        "同一角色各视图保持同一时刻、同一造型与同一配色，发型服饰特征完全一致",
    ].join("，");
}

// 分镜图提示词：主体与身份锚点 → 构图视角 → 光色与材质 → 背景边界 → 风格基底 → 普适禁止项
export function buildShotImagePrompt(shotDescription: string, artStylePromptBase: string): string {
    const style = artStylePromptBase.trim();
    return [
        `${shotDescription.trim()}，高质量分镜画面`,
        "画面主体突出，身份特征清晰可辨",
        "构图与视角贴合本镜情绪",
        "光源方向明确，材质区分清晰",
        "画框内只呈现描述中出现的人和物，背景边界清楚",
        ...(style ? [style] : []),
        "画面无文字，无水印",
    ].join("，");
}

// 图生视频提示词：图生视频默认继承首帧外观，只写变化与动作；动作按因果顺序连接、不并列罗列，
// 一条提示词只表达一个主导戏剧变化，结尾给可验证的终点状态；不写“保持外观/保持不变”类无效指令
export function buildShotVideoPrompt(shotDescription: string, artStylePromptBase: string): string {
    const style = artStylePromptBase.trim();
    return [
        `以当前画面为起点，${shotDescription.trim()}`,
        "本镜只呈现一个主导戏剧变化，动作按因果先后衔接，如听见声音后先转头、再看向声源",
        "镜头自然运动，结尾停在明确可确认的画面状态",
        ...(style ? [style] : []),
    ].join("，");
}

// 配音说明：TTS 请求只接受对白文本（requestAudioGeneration 无逐条指令参数，instructions 为全局设置），
// 拼接音色方向文字会被多数 TTS 渠道朗读出来，因此不提供配音方向提示构建函数。
