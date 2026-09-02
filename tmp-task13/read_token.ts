// 临时取证脚本：只读提取 user_configs 中渠道 apiKey（任务 #13，用完删除）
import { Database } from "bun:sqlite";

const db = new Database("d:/infinite-canvas-main/data/infinite-canvas.db", { readonly: true });
const rows = db.query("select user_id, model_config from user_configs").all() as Array<{ user_id: string; model_config: string }>;
for (const row of rows) {
    let cfg: any = {};
    try { cfg = JSON.parse(row.model_config || "{}"); } catch { continue; }
    console.log("=== user:", row.user_id, "channelMode:", cfg.channelMode, "imageModel:", cfg.imageModel);
    const channels = cfg.localChannels || [];
    for (const ch of channels) {
        console.log(JSON.stringify({ id: ch.id, name: ch.name, protocol: ch.protocol, baseUrl: ch.baseUrl, apiKey: ch.apiKey, models: ch.models }));
    }
}
