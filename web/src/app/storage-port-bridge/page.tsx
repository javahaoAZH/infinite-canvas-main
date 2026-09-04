"use client";

import localforage from "localforage";
import { useEffect } from "react";

const MESSAGE_TYPE = "infinite-canvas:port-storage-migration";
const STORE_NAMES = [
    "app_state",
    "image_files",
    "media_files",
    "image_generation_logs",
    "image_generation_categories",
    "video_generation_logs",
    "creative_workflows",
];
const STATE_KEYS = [
    "infinite-canvas:drama_store",
    "infinite-canvas:canvas_store",
    "infinite-canvas:asset_store",
    "infinite-canvas:director_store",
];
const STATE_HANDOFF_MARKER_KEY = "infinite-canvas:port-state-handoff:8080-to-18080:v1";

type MigrationRequest = { type?: string; action?: "start" | "ack" | "abort"; token?: string; sequence?: number; error?: string; stores?: string[] };

function allowedTarget(origin: string): boolean {
    try {
        const url = new URL(origin);
        return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === "18080";
    } catch {
        return false;
    }
}

export default function StoragePortBridgePage() {
    useEffect(() => {
        const mode = new URLSearchParams(window.location.search).get("handoff");
        if (mode === "export-state" && window.location.port === "8080") {
            void (async () => {
                const store = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });
                const items = await Promise.all(STATE_KEYS.map(async (key) => [key, await store.getItem(key)] as const));
                window.name = JSON.stringify({ type: MESSAGE_TYPE, items: items.filter(([, value]) => value !== null) });
                window.location.replace("http://127.0.0.1:18080/storage-port-bridge/?handoff=import-state");
            })();
            return;
        }
        if (mode === "import-state" && window.location.port === "18080") {
            void (async () => {
                const payload = JSON.parse(window.name || "{}") as { type?: string; items?: Array<[string, unknown]> };
                if (payload.type !== MESSAGE_TYPE || !Array.isArray(payload.items)) throw new Error("旧端口项目状态交接数据无效");
                const store = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });
                for (const [key, value] of payload.items) {
                    if (!STATE_KEYS.includes(key)) continue;
                    await store.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
                }
                window.name = "";
                window.localStorage.setItem(STATE_HANDOFF_MARKER_KEY, new Date().toISOString());
                window.location.replace("/drama");
            })();
            return;
        }
        if (window.location.hostname !== "127.0.0.1" || window.location.port !== "8080" || window.parent === window) return;
        const receive = (event: MessageEvent<MigrationRequest>) => {
            if (!allowedTarget(event.origin) || event.source !== window.parent || event.data?.type !== MESSAGE_TYPE || event.data.action !== "start" || !event.data.token) return;
            const token = event.data.token;
            const sendItem = (payload: Record<string, unknown>, sequence: number) => new Promise<void>((resolve, reject) => {
                const acknowledge = (ackEvent: MessageEvent<MigrationRequest>) => {
                    if (ackEvent.origin !== event.origin || ackEvent.source !== window.parent || ackEvent.data?.type !== MESSAGE_TYPE || ackEvent.data.token !== token) return;
                    if (ackEvent.data.action === "abort") {
                        window.removeEventListener("message", acknowledge);
                        reject(new Error(ackEvent.data.error || "目标端口终止迁移"));
                    }
                    if (ackEvent.data.action === "ack" && ackEvent.data.sequence === sequence) {
                        window.removeEventListener("message", acknowledge);
                        resolve();
                    }
                };
                window.addEventListener("message", acknowledge);
                window.parent.postMessage({ type: MESSAGE_TYPE, action: "item", token, sequence, ...payload }, event.origin);
            });
            void (async () => {
                let sequence = 0;
                try {
                    const localItems: Array<[string, string]> = [];
                    for (let index = 0; index < window.localStorage.length; index += 1) {
                        const key = window.localStorage.key(index);
                        if (!key?.startsWith("infinite-canvas")) continue;
                        const value = window.localStorage.getItem(key);
                        if (value !== null) localItems.push([key, value]);
                    }
                    for (const [key, value] of localItems) {
                        sequence += 1;
                        await sendItem({ area: "localStorage", key, value }, sequence);
                    }
                    const requestedStores = event.data.stores?.length ? STORE_NAMES.filter((storeName) => event.data.stores?.includes(storeName)) : STORE_NAMES;
                    for (const storeName of requestedStores) {
                        const store = localforage.createInstance({ name: "infinite-canvas", storeName });
                        const keys = await store.keys();
                        for (const key of keys) {
                            const value = await store.getItem(key);
                            sequence += 1;
                            await sendItem({ area: "indexedDB", storeName, key, value }, sequence);
                        }
                    }
                    window.parent.postMessage({ type: MESSAGE_TYPE, action: "done", token, sequence }, event.origin);
                } catch (error) {
                    window.parent.postMessage({ type: MESSAGE_TYPE, action: "error", token, error: error instanceof Error ? error.message : String(error) }, event.origin);
                }
            })();
        };
        window.addEventListener("message", receive);
        window.parent.postMessage({ type: MESSAGE_TYPE, action: "ready" }, "http://127.0.0.1:18080");
        return () => window.removeEventListener("message", receive);
    }, []);

    return null;
}
