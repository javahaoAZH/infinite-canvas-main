"use client";

// Codex 桌面版同构左侧栏：品牌行 + 导航行 + 项目区（固定/搜索/归档/行菜单）+ 最近生成 + 底部用户行；发丝分隔、alpha hover、圆角行
import { Archive, ArchiveRestore, ChevronDown, CircleHelp, Compass, Drama, Folder, MoreHorizontal, Pencil, Pin, PinOff, Plug, Search, SquarePen, Trash2 } from "lucide-react";
import { Dropdown, Input, Modal, type MenuProps } from "antd";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useDramaStore } from "@/stores/use-drama-store";
import { SidebarNotifications, SidebarRecentGenerations, SidebarSearchOverlay } from "./sidebar-overlays";

function NavRow({ href, active, icon, label, menu }: { href: string; active: boolean; icon: React.ReactNode; label: string; menu?: React.ReactNode }) {
    return (
        <div className="group/row relative">
            <Link
                href={href}
                className={cn(
                    "flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                    active ? "bg-foreground/10 font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
                )}
            >
                <span className="[&>svg]:size-4">{icon}</span>
                <span className="truncate">{label}</span>
            </Link>
            {menu ? <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 group-hover/row:block">{menu}</div> : null}
        </div>
    );
}

export function AppSidebar() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const canvasProjects = useCanvasStore((state) => state.projects);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const setProjectArchived = useCanvasStore((state) => state.setProjectArchived);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const dramaProjects = useDramaStore((state) => state.projects);
    const pinnedIds = useCanvasStore((state) => state.pinnedIds);
    const toggleProjectPinned = useCanvasStore((state) => state.toggleProjectPinned);
    const activeCanvasId = searchParams.get("id");
    const [searchOpen, setSearchOpen] = useState(false);

    // 标题栏搜索按钮通过该事件打开统一搜索 overlay（搜索/铃铛已上移标题栏）
    useEffect(() => {
        const open = () => setSearchOpen(true);
        window.addEventListener("sidebar-search-open", open);
        return () => window.removeEventListener("sidebar-search-open", open);
    }, []);
    const [renamingId, setRenamingId] = useState("");
    const [renameDraft, setRenameDraft] = useState("");

    const ghostIcon = "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground [&>svg]:size-4";
    const activeProjects = canvasProjects.filter((project) => !project.archived);
    const pinnedProjects = activeProjects.filter((project) => pinnedIds.includes(project.id));
    const unpinnedProjects = activeProjects.filter((project) => !pinnedIds.includes(project.id));
    const archivedProjects = canvasProjects.filter((project) => project.archived);

    const projectMenu = (projectId: string, title: string, archived: boolean): MenuProps["items"] => [
        {
            key: "pin",
            icon: pinnedIds.includes(projectId) ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />,
            label: pinnedIds.includes(projectId) ? "取消固定" : "固定",
            onClick: () => toggleProjectPinned(projectId),
        },
        {
            key: "rename",
            icon: <Pencil className="size-3.5" />,
            label: "重命名",
            onClick: () => {
                setRenamingId(projectId);
                setRenameDraft(title);
            },
        },
        {
            key: "archive",
            icon: archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />,
            label: archived ? "取消归档" : "归档",
            onClick: () => setProjectArchived(projectId, !archived),
        },
        { type: "divider" },
        {
            key: "delete",
            icon: <Trash2 className="size-3.5" />,
            label: "删除",
            onClick: () =>
                Modal.confirm({
                    title: `删除画布「${title}」？`,
                    content: "删除后不可恢复，节点与连线一并清除。",
                    okText: "删除",
                    okButtonProps: { danger: true },
                    cancelText: "取消",
                    onOk: () => deleteProjects([projectId]),
                }),
        },
    ];

    const renderProjectRow = (project: (typeof canvasProjects)[number]) =>
        renamingId === project.id ? (
            <div key={project.id} className="px-2 py-1">
                <Input
                    size="small"
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onPressEnter={() => {
                        renameProject(project.id, renameDraft);
                        setRenamingId("");
                    }}
                    onBlur={() => {
                        renameProject(project.id, renameDraft);
                        setRenamingId("");
                    }}
                />
            </div>
        ) : (
            <NavRow
                key={project.id}
                href={`/canvas/view?id=${project.id}`}
                active={pathname.startsWith("/canvas/view") && activeCanvasId === project.id}
                icon={<Folder />}
                label={project.title}
                menu={
                    <Dropdown menu={{ items: projectMenu(project.id, project.title, false) }} trigger={["click"]}>
                        <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground">
                            <MoreHorizontal className="size-3.5" />
                        </button>
                    </Dropdown>
                }
            />
        );

    return (
        <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
            {/* 品牌下拉行（对标 ChatGPT 桌面版侧栏顶部：品牌∨ + 搜索 + 铃铛） */}
            <div className="flex h-12 shrink-0 items-center gap-0.5 px-2.5">
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "version", label: "版本 v0.5.8", disabled: true },
                            { type: "divider" },
                            { key: "explore", label: "探索", onClick: () => router.push("/explore") },
                            { key: "settings", label: "设置", onClick: () => router.push("/settings") },
                            { key: "github", label: "GitHub 仓库", onClick: () => window.open("https://github.com/javahaoAZH/infinite-canvas-main", "_blank") },
                        ],
                    }}
                >
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:bg-foreground/8" title="无限画布菜单">
                        <span className="truncate">无限画布</span>
                        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                    </button>
                </Dropdown>
                <div className="ml-auto flex items-center gap-0.5">
                    <button
                        type="button"
                        className={cn(ghostIcon, searchOpen && "bg-foreground/10 text-foreground")}
                        title="统一搜索（画布、漫剧、分镜、素材、提示词）"
                        aria-label="搜索"
                        onClick={() => setSearchOpen(true)}
                    >
                        <Search />
                    </button>
                    <SidebarNotifications />
                </div>
            </div>

            {/* 搜索 overlay 由本组件挂载；标题栏搜索按钮亦通过事件打开 */}
            <SidebarSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

            <nav className="flex shrink-0 flex-col gap-0.5 px-2 pt-1">
                <NavRow href="/" active={pathname === "/"} icon={<SquarePen />} label="新对话" />
                {navigationTools.map((tool) => (
                    <NavRow key={tool.slug} href={`/${tool.slug}`} active={pathname === `/${tool.slug}` || pathname.startsWith(`/${tool.slug}/`)} icon={<tool.icon />} label={tool.label} />
                ))}
                <NavRow href="/explore" active={pathname === "/explore"} icon={<Compass />} label="探索" />
                <NavRow href="/plugins" active={pathname === "/plugins"} icon={<Plug />} label="插件与渠道" />
            </nav>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {pinnedProjects.length ? (
                    <>
                        <div className="px-3 pb-1 text-xs text-muted-foreground">已固定</div>
                        <div className="flex flex-col gap-0.5">{pinnedProjects.slice(0, 5).map(renderProjectRow)}</div>
                    </>
                ) : null}
                <div className={cn("flex items-center justify-between px-3 pb-1", pinnedProjects.length && "mt-4")}>
                    <span className="text-xs text-muted-foreground">项目</span>
                </div>
                <div className="flex flex-col gap-0.5">{unpinnedProjects.slice(0, 10).map(renderProjectRow)}
                    {dramaProjects.slice(0, 10).map((project) => (
                        <NavRow key={project.id} href="/drama" active={pathname.startsWith("/drama")} icon={<Drama />} label={project.title} />
                    ))}
                    {!activeProjects.length && !dramaProjects.length ? <div className="px-3 py-1 text-xs text-muted-foreground">暂无项目</div> : null}
                </div>

                <SidebarRecentGenerations />

                {archivedProjects.length ? (
                    <>
                        <div className="mt-4 px-3 pb-1 text-xs text-muted-foreground">已归档</div>
                        <div className="flex flex-col gap-0.5">
                            {archivedProjects.map((project) => (
                                <NavRow
                                    key={project.id}
                                    href={`/canvas/view?id=${project.id}`}
                                    active={pathname.startsWith("/canvas/view") && activeCanvasId === project.id}
                                    icon={<Archive className="size-4" />}
                                    label={project.title}
                                    menu={
                                        <Dropdown menu={{ items: projectMenu(project.id, project.title, true) }} trigger={["click"]}>
                                            <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground">
                                                <MoreHorizontal className="size-3.5" />
                                            </button>
                                        </Dropdown>
                                    }
                                />
                            ))}
                        </div>
                    </>
                ) : null}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
                <UserStatusActions showConfig={false} compact />
                <Link href="/settings" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground" title="设置" aria-label="设置">
                    <CircleHelp className="size-4" />
                </Link>
            </div>
        </aside>
    );
}
