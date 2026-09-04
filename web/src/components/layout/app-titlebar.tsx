"use client";

// Codex 同构标题栏：左侧菜单（文件/编辑/视图/帮助）+ 当前项目标签 + 拖动区 + 右栏开关 + 窗口控制（品牌/搜索/铃铛在侧栏顶部）
import { ArrowLeft, ArrowRight, Clapperboard, FileText, Folder, Images, ListChecks, Menu as MenuIcon, Minus, MoreHorizontal, PanelLeft, PanelRight, Sparkles, Square, X } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";
import saveAs from "file-saver";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";

import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { useThemeStore } from "@/stores/use-theme-store";

declare global {
    interface Window {
        winMinimize?: () => void;
        winMaximize?: () => void;
        winClose?: () => void;
        winExit?: () => void;
        winDrag?: () => void;
    }
}

const menuItemClass = "rounded-md px-2.5 py-1 text-[13px] transition-colors hover:bg-foreground/8 hover:text-foreground";
const controlClass = "inline-flex h-10 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

export function AppTitleBar({ railOpen, onRailToggle, onSidebarToggle }: { railOpen: boolean; onRailToggle: () => void; onSidebarToggle: () => void }) {
    const router = useRouter();
    const pathname = usePathname();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const canvasProjects = useCanvasStore((state) => state.projects);
    const dramaProjects = useDramaStore((state) => state.projects);

    const menus: { key: string; label: string; items: MenuProps["items"] }[] = [
        {
            key: "file",
            label: "文件",
            items: [
                { key: "new-canvas", label: "新建画布", onClick: () => router.push("/canvas") },
                { key: "new-drama", label: "新建漫剧项目", onClick: () => router.push("/drama") },
                { type: "divider" },
                { key: "exit", label: "退出", onClick: () => (window.winExit ? window.winExit() : window.close()) },
            ],
        },
        {
            key: "edit",
            label: "编辑",
            items: [
                { key: "config", label: "设置", onClick: () => router.push("/settings") },
                { key: "theme", label: theme === "dark" ? "切换浅色主题" : "切换深色主题", onClick: () => setTheme(theme === "dark" ? "light" : "dark") },
            ],
        },
        {
            key: "view",
            label: "视图",
            items: [
                { key: "rail", label: railOpen ? "隐藏输出栏" : "显示输出栏", onClick: onRailToggle },
                {
                    key: "full",
                    label: "全屏切换",
                    onClick: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
                },
            ],
        },
        {
            key: "help",
            label: "帮助",
            items: [
                { key: "prompts", label: "提示词文档", onClick: () => window.open("https://prompts.tdeh.top/", "_blank") },
                { key: "github", label: "GitHub 仓库", onClick: () => window.open("https://github.com/tigerowo/infinite-canvas", "_blank") },
            ],
        },
    ];

    // 当前项目标签：按路径推断上下文（对标 ChatGPT 桌面版标题栏中部的会话标签）
    const context = useMemo(() => {
        if (pathname.startsWith("/drama")) {
            const project = dramaProjects[0];
            return { kind: "drama" as const, project, label: project ? project.title : "AI 漫剧", href: "/drama", icon: <Clapperboard className="size-3.5 shrink-0" /> };
        }
        if (pathname.startsWith("/canvas/view")) {
            const project = canvasProjects.find((item) => !item.archived);
            return { kind: "canvas" as const, project, label: project ? project.title : "画布项目", href: "/canvas", icon: <Folder className="size-3.5 shrink-0" /> };
        }
        if (pathname.startsWith("/image")) return { kind: "page" as const, project: null, label: "生图工作台", href: "/image", icon: <Images className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/video")) return { kind: "page" as const, project: null, label: "视频创作台", href: "/video", icon: <Clapperboard className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/prompts")) return { kind: "page" as const, project: null, label: "提示词库", href: "/prompts", icon: <FileText className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/assets")) return { kind: "page" as const, project: null, label: "我的素材", href: "/assets", icon: <Images className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/queue")) return { kind: "page" as const, project: null, label: "已安排", href: "/queue", icon: <ListChecks className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/skills")) return { kind: "page" as const, project: null, label: "技能库", href: "/skills", icon: <Sparkles className="size-3.5 shrink-0" /> };
        return { kind: "page" as const, project: null, label: "新对话", href: "/", icon: <MenuIcon className="size-3.5 shrink-0" /> };
    }, [canvasProjects, dramaProjects, pathname]);

    // ⋯ 菜单对接真实项目功能：漫剧可导出分镜稿/跳资产清单，画布可直接打开
    const contextMenu: MenuProps["items"] = useMemo(() => {
        const common: MenuProps["items"] = [
            { type: "divider" },
            { key: "home", label: "新对话", onClick: () => router.push("/") },
            { key: "settings", label: "设置", onClick: () => router.push("/settings") },
        ];
        if (context.kind === "drama" && context.project) {
            const project = context.project;
            return [
                { key: "open", label: "打开项目", onClick: () => router.push("/drama") },
                {
                    key: "export-storyboard",
                    label: "导出分镜稿（Markdown）",
                    onClick: () => {
                        const lines = [`# ${project.title} 分镜稿`, ""];
                        project.shots.forEach((shot, index) => {
                            lines.push(`## 镜 ${index + 1}`, `- 画面：${shot.description || "（未填写）"}`);
                            if (shot.dialogue.trim()) lines.push(`- 对白：${shot.dialogue.trim()}`);
                            if ((shot.narration || "").trim()) lines.push(`- 旁白：${shot.narration!.trim()}`);
                            if (shot.imagePrompt?.trim()) lines.push(`- 出图提示词：${shot.imagePrompt.trim()}`);
                            if (shot.videoPrompt?.trim()) lines.push(`- 视频提示词：${shot.videoPrompt.trim()}`);
                            lines.push("");
                        });
                        saveAs(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }), `${project.title}-分镜稿.md`);
                    },
                },
                { key: "assets", label: "资产清单", onClick: () => router.push(`/assets?tab=project&project=${encodeURIComponent(project.title)}`) },
                ...common,
            ];
        }
        if (context.kind === "canvas" && context.project) {
            return [{ key: "open", label: "打开画布", onClick: () => router.push(`/canvas/view?id=${context.project!.id}`) }, ...common];
        }
        return [{ key: "plugins", label: "插件与渠道", onClick: () => router.push("/plugins") }, ...common];
    }, [context, router]);

    return (
        <div
            className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border bg-sidebar px-1.5 text-muted-foreground"
            onMouseDown={(event) => {
                if (event.button !== 0) return;
                if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
                window.winDrag?.();
            }}
            onDoubleClick={() => window.winMaximize?.()}
        >
            {/* 侧栏收缩 + 前进/后退（对标 ChatGPT 桌面版标题栏左上） */}
            <button type="button" data-no-drag title={"收缩/展开侧栏"} aria-label="收缩侧栏" className={menuItemClass} onClick={onSidebarToggle}>
                <PanelLeft className="size-3.5" />
            </button>
            <button type="button" data-no-drag title="后退" aria-label="后退" className={menuItemClass} onClick={() => router.back()}>
                <ArrowLeft className="size-3.5" />
            </button>
            <button type="button" data-no-drag title="前进" aria-label="前进" className={menuItemClass} onClick={() => router.forward()}>
                <ArrowRight className="size-3.5" />
            </button>
            {menus.map((menu) => (
                <Dropdown key={menu.key} menu={{ items: menu.items }} trigger={["click"]}>
                    <button type="button" data-no-drag className={menuItemClass}>
                        {menu.label}
                    </button>
                </Dropdown>
            ))}
            {/* 当前项目标签 */}
            <div className="ml-2 flex min-w-0 items-center" data-no-drag>
                <span className="flex h-7 min-w-0 max-w-[300px] items-center gap-1.5 rounded-md bg-foreground/8 px-2 text-xs text-foreground">
                    {context.icon}
                    <Link href={context.href} className="min-w-0 truncate hover:underline">
                        {context.label}
                    </Link>
                    <Dropdown menu={{ items: contextMenu }} trigger={["click"]}>
                        <MoreHorizontal className="size-3.5 shrink-0 cursor-pointer opacity-60 transition-opacity hover:opacity-100" aria-label="标签操作" />
                    </Dropdown>
                </span>
            </div>
            <div className="min-w-0 flex-1" />
            <button type="button" data-no-drag title={railOpen ? "隐藏输出栏" : "显示输出栏"} className={controlClass} onClick={onRailToggle}>
                <PanelRight className="size-4" />
            </button>
            <button type="button" data-no-drag title="最小化" className={controlClass} onClick={() => window.winMinimize?.()}>
                <Minus className="size-4" />
            </button>
            <button type="button" data-no-drag title="最大化" className={controlClass} onClick={() => window.winMaximize?.()}>
                <Square className="size-3" />
            </button>
            <button type="button" data-no-drag title="关闭" className={`${controlClass} hover:bg-red-600 hover:text-white`} onClick={() => window.winClose?.()}>
                <X className="size-4" />
            </button>
        </div>
    );
}
