"use client";

import { useEffect, useState } from "react";

import { fetchRenderOutputBlob, isAuthedRenderOutputUrl } from "@/services/api/render";

// 本地成片产物路径（/api/…）需登录鉴权：带 token 拉成 blob 转 object URL 供 <video> 播放与下载；外链原样透传
export function useRenderOutputUrl(token: string, url: string) {
    const [blobUrl, setBlobUrl] = useState("");
    useEffect(() => {
        if (!url || !isAuthedRenderOutputUrl(url)) {
            setBlobUrl("");
            return;
        }
        let cancelled = false;
        let objectUrl = "";
        fetchRenderOutputBlob(token, url)
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setBlobUrl(objectUrl);
            })
            .catch(() => {
                if (!cancelled) setBlobUrl("");
            });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [token, url]);
    if (!url) return "";
    return isAuthedRenderOutputUrl(url) ? blobUrl : url;
}
