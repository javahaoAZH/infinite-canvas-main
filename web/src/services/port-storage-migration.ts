import localforage from "localforage";

const LEGACY_ORIGIN = "http://127.0.0.1:8080";
const CURRENT_PORT = "18080";
const MESSAGE_TYPE = "infinite-canvas:port-storage-migration";
const MIGRATION_MARKER_KEY = "infinite-canvas:port-migration:8080-to-18080:v3";

type MigrationMessage = {
    type?: string;
    action?: "ready" | "item" | "done" | "error";
    token?: string;
    sequence?: number;
    area?: "localStorage" | "indexedDB";
    storeName?: string;
    key?: string;
    value?: unknown;
    error?: string;
    stores?: string[];
};

const COLLECTION_FIELDS: Record<string, string> = {
    "infinite-canvas:drama_store": "projects",
    "infinite-canvas:canvas_store": "projects",
    "infinite-canvas:asset_store": "assets",
    "infinite-canvas:director_store": "plans",
};

function collectionLength(value: unknown, key: string): number | null {
    const field = COLLECTION_FIELDS[key];
    if (!field) return null;
    try {
        const parsed = typeof value === "string" ? JSON.parse(value) as { state?: Record<string, unknown> } : value as { state?: Record<string, unknown> };
        const state = parsed?.state;
        const collection = state?.[field];
        return Array.isArray(collection) ? collection.length : 0;
    } catch {
        return null;
    }
}

async function importIndexedDBItem(storeName: string, key: string, value: unknown): Promise<boolean> {
    const store = localforage.createInstance({ name: "infinite-canvas", storeName });
    const current = await store.getItem(key);
    const sourceLength = collectionLength(value, key);
    const currentLength = collectionLength(current, key);
    if (current !== null && !(sourceLength !== null && sourceLength > 0 && currentLength === 0)) return false;
    const normalized = key in COLLECTION_FIELDS && typeof value !== "string" ? JSON.stringify(value) : value;
    await store.setItem(key, normalized);
    return true;
}

function importLocalStorageItem(key: string, value: unknown): boolean {
    if (typeof value !== "string") return false;
    const current = window.localStorage.getItem(key);
    if (key !== "infinite-canvas:drama_bridge") {
        if (current !== null) return false;
        window.localStorage.setItem(key, value);
        return true;
    }
    try {
        const sourceConfig = JSON.parse(value) as Record<string, unknown>;
        const currentConfig = current ? JSON.parse(current) as Record<string, unknown> : {};
        const merged = {
            ...sourceConfig,
            ...currentConfig,
            enabled: currentConfig.enabled === true || sourceConfig.enabled === true,
            chatGPTEnabled: currentConfig.chatGPTEnabled === true || sourceConfig.chatGPTEnabled === true,
            token: currentConfig.token || sourceConfig.token || "",
            chatGPTToken: currentConfig.chatGPTToken || sourceConfig.chatGPTToken || "",
            adapterPath: currentConfig.adapterPath || sourceConfig.adapterPath || "",
        };
        const next = JSON.stringify(merged);
        if (next === current) return false;
        window.localStorage.setItem(key, next);
        return true;
    } catch {
        if (current !== null) return false;
        window.localStorage.setItem(key, value);
        return true;
    }
}

export type PortStorageMigrationResult = { changed: boolean; sourceItems: number; importedItems: number; collections: Record<string, number | null> };

export async function migrateLegacyPortStorage(force = false, stores?: string[]): Promise<PortStorageMigrationResult> {
    const empty = { changed: false, sourceItems: 0, importedItems: 0, collections: {} };
    if (typeof window === "undefined" || window.location.hostname !== "127.0.0.1" || window.location.port !== CURRENT_PORT) return empty;
    if (!force && window.localStorage.getItem(MIGRATION_MARKER_KEY)) return empty;

    const token = crypto.randomUUID();
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none";
    iframe.src = `${LEGACY_ORIGIN}/storage-port-bridge/`;

    return new Promise<PortStorageMigrationResult>((resolve) => {
        let changed = false;
        let sourceItems = 0;
        let importedItems = 0;
        const collections: Record<string, number | null> = {};
        const cleanup = () => {
            window.clearTimeout(timeout);
            window.removeEventListener("message", receive);
            iframe.remove();
        };
        const finish = () => {
            cleanup();
            resolve({ changed, sourceItems, importedItems, collections });
        };
        const receive = (event: MessageEvent<MigrationMessage>) => {
            if (event.origin !== LEGACY_ORIGIN || event.source !== iframe.contentWindow || event.data?.type !== MESSAGE_TYPE) return;
            const message = event.data;
            if (message.action === "ready") {
                iframe.contentWindow?.postMessage({ type: MESSAGE_TYPE, action: "start", token, stores }, LEGACY_ORIGIN);
                return;
            }
            if (message.token !== token) return;
            if (message.action === "done") {
                if (sourceItems > 0) window.localStorage.setItem(MIGRATION_MARKER_KEY, new Date().toISOString());
                finish();
                return;
            }
            if (message.action === "error") {
                console.error("旧端口本地数据迁移失败", message.error);
                finish();
                return;
            }
            if (message.action !== "item" || typeof message.sequence !== "number" || !message.key) return;
            sourceItems += 1;
            if (message.area === "indexedDB" && message.storeName === "app_state") collections[message.key] = collectionLength(message.value, message.key);
            void (async () => {
                try {
                    let imported = false;
                    if (message.area === "localStorage") imported = importLocalStorageItem(message.key!, message.value);
                    if (message.area === "indexedDB" && message.storeName) imported = await importIndexedDBItem(message.storeName, message.key!, message.value);
                    if (imported) importedItems += 1;
                    changed = imported || changed;
                    iframe.contentWindow?.postMessage({ type: MESSAGE_TYPE, action: "ack", token, sequence: message.sequence }, LEGACY_ORIGIN);
                } catch (error) {
                    iframe.contentWindow?.postMessage({ type: MESSAGE_TYPE, action: "abort", token, error: error instanceof Error ? error.message : String(error) }, LEGACY_ORIGIN);
                    finish();
                }
            })();
        };
        const timeout = window.setTimeout(finish, 180_000);
        window.addEventListener("message", receive);
        document.body.appendChild(iframe);
    });
}
