import { Coins, Drama, FileText, ImagePlus, Images, ListChecks, Maximize2, Sparkles, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "drama",
        label: "AI 漫剧",
        icon: Drama,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
    {
        slug: "cost",
        label: "成本统计",
        icon: Coins,
    },
    {
        slug: "queue",
        label: "已安排",
        icon: ListChecks,
    },
    {
        slug: "skills",
        label: "技能库",
        icon: Sparkles,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
