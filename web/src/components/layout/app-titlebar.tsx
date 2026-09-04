"use client";

// Codex 同构标题栏：左侧菜单（文件/编辑/视图/帮助）+ 品牌与搜索/通知（与侧栏同宽区）+ 当前项目标签 + 拖动区 + 右栏开关 + 窗口控制
import { Clapperboard, FileText, Folder, Images, ListChecks, Menu as MenuIcon, Minus, MoreHorizontal, PanelRight, Search, Sparkles, Square, X } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";

import { SidebarNotifications } from "@/components/layout/sidebar-overlays";
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

export function AppTitleBar({ railOpen, onRailToggle }: { railOpen: boolean; onRailToggle: () => void }) {
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
            const project = useDramaStore.getState().projects[0];
            return { label: project ? project.title : "AI 漫剧", href: "/drama", icon: <Clapperboard className="size-3.5 shrink-0" /> };
        }
        if (pathname.startsWith("/canvas/view")) {
            const project = canvasProjects.find((item) => !item.archived);
            return { label: project ? project.title : "画布项目", href: "/canvas", icon: <Folder className="size-3.5 shrink-0" /> };
        }
        if (pathname.startsWith("/image")) return { label: "生图工作台", href: "/image", icon: <Images className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/video")) return { label: "视频创作台", href: "/video", icon: <Clapperboard className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/prompts")) return { label: "提示词库", href: "/prompts", icon: <FileText className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/assets")) return { label: "我的素材", href: "/assets", icon: <Images className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/queue")) return { label: "已安排", href: "/queue", icon: <ListChecks className="size-3.5 shrink-0" /> };
        if (pathname.startsWith("/skills")) return { label: "技能库", href: "/skills", icon: <Sparkles className="size-3.5 shrink-0" /> };
        return { label: "新对话", href: "/", icon: <MenuIcon className="size-3.5 shrink-0" /> };
    }, [canvasProjects, dramaProjects, pathname]);

    const contextMenu: MenuProps["items"] = [
        { key: "home", label: "新对话", onClick: () => router.push("/") },
        { key: "plugins", label: "插件与渠道", onClick: () => router.push("/plugins") },
        { key: "settings", label: "设置", onClick: () => router.push("/settings") },
    ];

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
            {menus.map((menu) => (
                <Dropdown key={menu.key} menu={{ items: menu.items }} trigger={["click"]}>
                    <button type="button" data-no-drag className={menuItemClass}>
                        {menu.label}
                    </button>
                </Dropdown>
            ))}
            {/* 品牌与搜索/通知：与侧栏同宽区（对标 ChatGPT 桌面版标题栏左侧） */}
            <div className="ml-1 flex w-[232px] shrink-0 items-center gap-0.5 border-l border-border pl-1.5" data-no-drag>
                <Link href="/" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-foreground/8" title="返回首页">
                    <span className="size-3.5 shrink-0 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    <span className="truncate">无限画布</span>
                </Link>
                <button
                    type="button"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
                    title="统一搜索"
                    aria-label="统一搜索"
                    onClick={() => window.dispatchEvent(new CustomEvent("sidebar-search-open"))}
                >
                    <Search className="size-4" />
                </button>
                <SidebarNotifications />
            </div>
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
