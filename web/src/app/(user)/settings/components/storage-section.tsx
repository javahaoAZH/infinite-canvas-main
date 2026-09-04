"use client";

// 存储分区：S3/R2 与 WebDAV 两张卡（仅后台允许用户自配存储时显示），行级即时保存 + 显式同步到账号
import { useEffect, useState } from "react";
import { App, Button, Input, Switch } from "antd";

import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { clearStorageConfigCache as clearFileStorageCache } from "@/services/file-storage";
import {
    clearStorageConfigCache as clearImageStorageCache,
    defaultUserStorageProvider,
    defaultUserWebDAVStorageProvider,
    loadStorageConfig,
    loadUserS3StorageProvider,
    loadUserWebDAVStorageProvider,
    saveUserStorageProvider,
    saveUserWebDAVStorageProvider,
    type UserS3StorageProvider,
    type UserStorageProvider,
    type UserWebDAVStorageProvider,
} from "@/services/image-storage";
import { fetchUserConfig, measureUserStorageProvider, syncUserStorageProvider } from "@/services/api/user-config";
import { SettingsRow, SettingsSection } from "./rows";

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function StorageSection({ search }: { search: string }) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const token = useUserStore((state) => state.token);
    const [allowed, setAllowed] = useState(false);
    const [s3, setS3] = useState(() => defaultUserStorageProvider());
    const [webdav, setWebdav] = useState(() => defaultUserWebDAVStorageProvider());
    const [measuring, setMeasuring] = useState<"s3" | "webdav" | null>(null);
    const [s3Usage, setS3Usage] = useState("");
    const [webdavUsage, setWebdavUsage] = useState("");
    const [syncing, setSyncing] = useState(false);
    useEffect(() => {
        setS3(loadUserS3StorageProvider() || defaultUserStorageProvider());
        setWebdav(loadUserWebDAVStorageProvider() || defaultUserWebDAVStorageProvider());
        void loadStorageConfig()
            .then((storage) => setAllowed(storage.allowUserProvider === true))
            .catch(() => setAllowed(false));
    }, []);

    // 登录后拉取账号侧配置与存储（旧弹窗打开时的逻辑迁入）
    useEffect(() => {
        if (!token) return;
        let canceled = false;
        void fetchUserConfig(token)
            .then((payload) => {
                if (canceled) return;
                if (payload.storageProvider?.s3) setS3({ ...defaultUserStorageProvider(), ...payload.storageProvider.s3, type: "s3" as const });
                if (payload.storageProvider?.webdav) setWebdav({ ...defaultUserWebDAVStorageProvider(), ...payload.storageProvider.webdav, type: "webdav" as const });
            })
            .catch(() => undefined);
        return () => {
            canceled = true;
        };
    }, [token]);

    const patchS3 = (patch: Partial<UserS3StorageProvider>) => {
        setS3((value) => {
            const next = { ...value, ...patch };
            saveUserStorageProvider(next);
            return next;
        });
    };

    const patchWebDAV = (patch: Partial<UserWebDAVStorageProvider>) => {
        setWebdav((value) => {
            const next = { ...value, ...patch };
            saveUserWebDAVStorageProvider(next);
            return next;
        });
    };

    const measure = async (provider: UserStorageProvider) => {
        if (!token) return message.warning("请先登录后再统计容量");
        setMeasuring(provider.type);
        try {
            const result = await measureUserStorageProvider(token, provider);
            const usageText = `${formatBytes(result.bytes)} / ${formatBytes(result.limitBytes)}${result.overLimit ? "，已达到上限" : ""}`;
            if (provider.type === "webdav") {
                setWebdavUsage(usageText);
                if (result.overLimit) patchWebDAV({ enabled: false });
            } else {
                setS3Usage(usageText);
                if (result.overLimit) patchS3({ enabled: false });
            }
            message.success("容量统计完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "容量统计失败");
        } finally {
            setMeasuring(null);
        }
    };

    const syncToAccount = async () => {
        if (!token) return message.warning("请先登录后再同步配置");
        if (s3.enabled && webdav.enabled) return message.error("S3/R2 与 WebDAV 不能同时启用");
        setSyncing(true);
        try {
            const providers = {
                ...(config.syncStorageConfig ? { s3: s3 } : {}),
                ...(config.syncWebDAVStorageConfig ? { webdav: webdav } : {}),
            };
            if (Object.keys(providers).length) await syncUserStorageProvider(token, providers);
            clearImageStorageCache();
            clearFileStorageCache();
            message.success("存储配置已同步到账号");
        } catch (error) {
            message.error(error instanceof Error ? `同步失败：${error.message}` : "同步失败");
        } finally {
            setSyncing(false);
        }
    };

    if (!allowed) return null;

    return (
        <SettingsSection id="storage" title="存储" search={search}>
            <SettingsRow
                search={search}
                title="S3/R2 对象存储"
                desc={`开启后新图片与媒体优先保存到你的 S3 兼容存储${s3Usage ? ` · 容量 ${s3Usage}` : ""}`}
                control={
                    <span className="flex items-center gap-2">
                        <Button size="small" loading={measuring === "s3"} onClick={() => void measure(s3)}>
                            统计容量
                        </Button>
                        <Switch size="small" checked={s3.enabled} disabled={webdav.enabled} onChange={(enabled) => patchS3({ enabled })} />
                    </span>
                }
            />
            {s3.enabled ? (
                <div className="grid gap-2 px-4 pb-4 text-sm sm:grid-cols-2">
                    <Input size="small" value={s3.name} placeholder="配置名称" onChange={(event) => patchS3({ name: event.target.value })} />
                    <Input size="small" value={s3.endpoint} placeholder="Endpoint，例如 https://<account>.r2.cloudflarestorage.com" onChange={(event) => patchS3({ endpoint: event.target.value })} />
                    <Input size="small" value={s3.region} placeholder="Region，R2 通常为 auto" onChange={(event) => patchS3({ region: event.target.value })} />
                    <Input size="small" value={s3.bucket} placeholder="Bucket 名称" onChange={(event) => patchS3({ bucket: event.target.value })} />
                    <Input size="small" value={s3.accessKeyId} placeholder="Access Key ID" onChange={(event) => patchS3({ accessKeyId: event.target.value })} />
                    <Input.Password size="small" value={s3.secretAccessKey} placeholder="Secret Access Key" onChange={(event) => patchS3({ secretAccessKey: event.target.value })} />
                    <Input size="small" value={s3.publicBaseUrl} placeholder="公开访问地址，例如 https://pub-xxx.r2.dev" onChange={(event) => patchS3({ publicBaseUrl: event.target.value })} />
                    <Input size="small" value={s3.pathPrefix} placeholder="保存路径前缀，例如 images" onChange={(event) => patchS3({ pathPrefix: event.target.value })} />
                </div>
            ) : null}
            <SettingsRow
                search={search}
                title="WebDAV 存储"
                desc={`开启后新图片与媒体优先保存到你的 WebDAV${webdavUsage ? ` · 容量 ${webdavUsage}` : ""}`}
                control={
                    <span className="flex items-center gap-2">
                        <Button size="small" loading={measuring === "webdav"} onClick={() => void measure(webdav)}>
                            统计容量
                        </Button>
                        <Switch size="small" checked={webdav.enabled} disabled={s3.enabled} onChange={(enabled) => patchWebDAV({ enabled })} />
                    </span>
                }
            />
            {webdav.enabled ? (
                <div className="grid gap-2 px-4 pb-4 text-sm sm:grid-cols-2">
                    <Input size="small" value={webdav.name} placeholder="配置名称" onChange={(event) => patchWebDAV({ name: event.target.value })} />
                    <Input size="small" value={webdav.endpoint} placeholder="WebDAV 地址" onChange={(event) => patchWebDAV({ endpoint: event.target.value })} />
                    <Input size="small" value={webdav.pathPrefix} placeholder="远程目录" onChange={(event) => patchWebDAV({ pathPrefix: event.target.value })} />
                    <Input size="small" value={webdav.username} placeholder="用户名" onChange={(event) => patchWebDAV({ username: event.target.value })} />
                    <Input.Password size="small" value={webdav.password} placeholder="密码 / 应用密码" onChange={(event) => patchWebDAV({ password: event.target.value })} />
                </div>
            ) : null}
            <SettingsRow
                search={search}
                title="自动同步与上传"
                desc="开启自动同步后，存储配置会跟随账号同步；「立即同步」把当前存储配置上传到账号"
                control={
                    <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            S3
                            <Switch size="small" checked={config.syncStorageConfig} onChange={(checked) => updateConfig("syncStorageConfig", checked)} />
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            WebDAV
                            <Switch size="small" checked={config.syncWebDAVStorageConfig} onChange={(checked) => updateConfig("syncWebDAVStorageConfig", checked)} />
                        </span>
                        <Button size="small" loading={syncing} disabled={!token} onClick={() => void syncToAccount()}>
                            立即同步
                        </Button>
                    </span>
                }
            />
        </SettingsSection>
    );
}
