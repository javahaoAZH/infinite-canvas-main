import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { APP_VERSION } from "@/constant/env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";

// 二开仓库自检：版本与更新日志均取我们自己的 GitHub 仓库（默认分支 master），不再读上游 tigerowo/infinite-canvas
const latestVersionUrl = "https://raw.githubusercontent.com/javahaoAZH/infinite-canvas-main/master/VERSION";
const latestChangelogUrl = "https://raw.githubusercontent.com/javahaoAZH/infinite-canvas-main/master/CHANGELOG.md";

function readLocalReleases(): ReleaseInfo[] {
    try {
        return JSON.parse(process.env.NEXT_PUBLIC_APP_RELEASES || "[]");
    } catch {
        return [];
    }
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)\.?(\d+)?/);
    return match ? match.slice(1).filter(Boolean).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

// 构建内置版本信息（next.config 注入我们仓库的 CHANGELOG/VERSION）中的最新已发布版本，私有仓库/离线时作为事实源
function localLatestVersion(releases: ReleaseInfo[], fallback: string) {
    const first = releases.find((release) => release.version !== "Unreleased" && /^v?\d/.test(release.version));
    return first?.version || fallback;
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(() => localLatestVersion(localReleases, currentVersion));
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const checkLatestVersion = useCallback(async () => {
        try {
            const response = await fetch(latestVersionUrl);
            if (!response.ok) throw new Error("版本读取失败");
            const version = await response.text();
            setLatestVersion(version.trim() || currentVersion);
            return true;
        } catch {
            // 私有仓库/离线：回退构建内置版本信息，不报错
            setLatestVersion(localLatestVersion(localReleases, currentVersion));
            return false;
        }
    }, [currentVersion, localReleases]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [versionResponse, changelogResponse] = await Promise.all([fetch(latestVersionUrl), fetch(latestChangelogUrl)]);
                if (!versionResponse.ok) throw new Error("版本读取失败");
                if (!changelogResponse.ok) throw new Error("更新日志读取失败");
                const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
                setLatestVersion(version.trim() || currentVersion);
                if (changelog.trim()) setReleases(parseChangelog(changelog));
                if (showMessage) message.success("已获取最新版本信息");
                return true;
            } catch {
                setLatestVersion(localLatestVersion(localReleases, currentVersion));
                setReleases(localReleases);
                if (showMessage) {
                    if (localReleases.length) message.info("仓库私有或离线：已展示本构建内置的我们仓库版本信息");
                    else message.error("获取最新版本信息失败");
                }
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
    };
}
