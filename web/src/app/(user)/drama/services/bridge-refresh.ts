// 桥接数据变更刷新注册表：drama_api_request 等非 GET 操作成功后经此通知页面刷新——
// 派发 window 级 CustomEvent "app-data-changed"（detail {path}）并逐个调用已注册的刷新函数（try/catch 隔离，单个失败不影响其余）。
export type DataChangedEvent = CustomEvent<{ path: string }>;

export const APP_DATA_CHANGED_EVENT = "app-data-changed";

const refreshers = new Set<() => void>();

// 注册数据变更后的刷新回调，返回注销函数
export function registerRefresh(fn: () => void): () => void {
    refreshers.add(fn);
    return () => {
        refreshers.delete(fn);
    };
}

export function notifyDataChanged(path: string) {
    if (typeof window === "undefined") return;
    try {
        window.dispatchEvent(new CustomEvent(APP_DATA_CHANGED_EVENT, { detail: { path } }));
    } catch {
        // 事件派发失败不影响刷新回调执行
    }
    refreshers.forEach((fn) => {
        try {
            fn();
        } catch {
            // 隔离单个刷新回调异常
        }
    });
}
