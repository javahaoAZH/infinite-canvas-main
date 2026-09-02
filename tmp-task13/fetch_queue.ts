// 临时取证脚本：拉取 /v1/queue 任务列表，分析立绘/分镜任务走向（任务 #13，用完删除）
const BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443";
const TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006";

const response = await fetch(`${BASE}/v1/queue?limit=200`, { headers: { Authorization: `Bearer ${TOKEN}` } });
console.log("status:", response.status);
const text = await response.text();
await Bun.write("d:/infinite-canvas-main/tmp-task13/queue_raw.json", text);
let payload: any;
try { payload = JSON.parse(text); } catch { console.log(text.slice(0, 2000)); process.exit(0); }
const items: any[] = payload.data || payload.items || payload.queue || (Array.isArray(payload) ? payload : []);
console.log("task count:", items.length);
for (const item of items) {
    const req = typeof item.request_json === "string" ? safeParse(item.request_json) : item.request_json || item.requestJson || {};
    const hasImage = Boolean(req?.image || req?.extra_body?.image || req?.images?.length);
    console.log(JSON.stringify({
        id: item.id,
        status: item.status,
        model: item.model || req?.model,
        kind: item.kind || item.task_kind,
        createdAt: item.created_at || item.createdAt,
        hasImage,
        error: (item.error || item.error_message || "").slice(0, 160),
        promptHead: String(req?.prompt || "").slice(0, 40),
    }));
}

function safeParse(value: string) {
    try { return JSON.parse(value); } catch { return {}; }
}
