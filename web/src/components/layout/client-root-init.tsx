"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { App } from "antd";

import { fetchUserConfig } from "@/services/api/user-config";
import { defaultUserStorageProvider, defaultUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider } from "@/services/image-storage";
import { migrateLegacyPortStorage } from "@/services/port-storage-migration";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

let portMigrationStarted = false;

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const pathname = usePathname();
    const router = useRouter();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";
    const adminRemoteTokenRef = useRef("");

    useEffect(() => {
        if (portMigrationStarted) return;
        portMigrationStarted = true;
        const start = () => void migrateLegacyPortStorage(false, ["app_state"]).then(async ({ changed }) => {
            if (!changed) return;
            const [{ useDramaStore }, { useCanvasStore }, { useAssetStore }, { useDirectorStore }] = await Promise.all([
                import("@/stores/use-drama-store"),
                import("@/app/(user)/canvas/stores/use-canvas-store"),
                import("@/stores/use-asset-store"),
                import("@/stores/use-director-store"),
            ]);
            await Promise.all([
                useDramaStore.persist.rehydrate(),
                useCanvasStore.persist.rehydrate(),
                useAssetStore.persist.rehydrate(),
                useDirectorStore.persist.rehydrate(),
            ]);
            window.location.reload();
        });
        if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 1_500 });
        else window.setTimeout(start, 0);
    }, []);

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        if (!isLoginPage) void hydrateUser();
    }, [hydrateUser, isLoginPage]);

    useEffect(() => {
        if (!token || user?.role !== "admin" || adminRemoteTokenRef.current === token) return;
        adminRemoteTokenRef.current = token;
        if (channelMode !== "remote") updateConfig("channelMode", "remote");
    }, [channelMode, token, updateConfig, user?.role]);

    useEffect(() => {
        if (!token || !user?.id) return;
        void fetchUserConfig(token)
            .then((payload) => {
                const syncS3 = payload.modelConfig?.syncStorageConfig === true;
                const syncWebDAV = payload.modelConfig?.syncWebDAVStorageConfig === true;
                if (payload.modelConfig) {
                    Object.entries(payload.modelConfig)
                        .forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
                }
                updateConfig("syncStorageConfig", syncS3);
                updateConfig("syncWebDAVStorageConfig", syncWebDAV);
                if (syncS3 && payload.storageProvider?.s3) {
                    saveUserStorageProvider({
                        ...defaultUserStorageProvider(),
                        ...payload.storageProvider.s3,
                        type: "s3",
                    });
                }
                if (syncWebDAV && payload.storageProvider?.webdav) {
                    saveUserWebDAVStorageProvider({
                        ...defaultUserWebDAVStorageProvider(),
                        ...payload.storageProvider.webdav,
                        type: "webdav",
                    });
                }
            })
            .catch(() => {});
    }, [token, updateConfig, user?.id]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        if (!publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (!publicSettings.modelChannel.allowCustomChannel) {
            router.push("/settings");
            message.error("后台未允许用户自定义渠道，请联系管理员进行配置");
            return;
        }
        updateConfig("channelMode", "local");
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        router.push("/settings");
    }, [message, publicSettings, router, updateConfig]);

    return <>{children}</>;
}
