"use client";

import { useEffect, useRef, useState, Suspense, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppRightRail } from "@/components/layout/app-right-rail";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTitleBar } from "@/components/layout/app-titlebar";
import { fetchUserConfig } from "@/services/api/user-config";
import { useUserStore } from "@/stores/use-user-store";

const protectedPrefixes = ["/asset-library", "/cost", "/drama"];

export default function UserLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const wasLoggedOutRef = useRef(false);
    const isProtectedPage = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    const isBarePage = pathname === "/login";
    const [railOpen, setRailOpen] = useState(false);
    // 标题栏收缩按钮控制侧栏显隐（对标 ChatGPT 桌面版）
    const [sidebarOpen, setSidebarOpen] = useState(true);

    useEffect(() => {
        if (!isReady || !isProtectedPage || user) return;
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }, [isProtectedPage, isReady, pathname, router, user]);

    useEffect(() => {
        if (!isReady) return;
        if (!user) {
            wasLoggedOutRef.current = true;
            return;
        }
        const syncCanvasAfterLogin = wasLoggedOutRef.current;
        const token = useUserStore.getState().token;
        if (!token) return;
        wasLoggedOutRef.current = false;
        fetchUserConfig(token).then(async (config) => {
            const syncEnabled = config.syncCapabilities?.userData === true;
            const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
            const canvasStore = useCanvasStore.getState();
            canvasStore.setSyncEnabled(syncEnabled);
            if (
                syncCanvasAfterLogin &&
                syncEnabled &&
                canvasStore.hydrated
            ) {
                void canvasStore.syncWithRemote(token, true);
            }
            const { useAssetStore } = await import("@/stores/use-asset-store");
            void useAssetStore.getState().hydrateAccountAssets(token, syncEnabled);
        }).catch(() => { });
    }, [isReady, user]);

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            {isBarePage ? null : <AppTitleBar railOpen={railOpen} onRailToggle={() => setRailOpen((value) => !value)} onSidebarToggle={() => setSidebarOpen((value) => !value)} />}
            <div className="flex min-h-0 flex-1">
                {isBarePage || !sidebarOpen ? null : (
                    <Suspense fallback={null}>
                        <AppSidebar />
                    </Suspense>
                )}
                <div className="min-w-0 flex-1 overflow-hidden">{isProtectedPage && (!isReady || !user) ? null : children}</div>
                {!isBarePage && railOpen ? <AppRightRail /> : null}
            </div>
        </div>
    );
}
