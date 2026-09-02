// 临时取证脚本：分析 /v1/queue 各任务的 workflow/requested_model/request_json（任务 #13，用完删除）
const payload = JSON.parse(await Bun.file("d:/infinite-canvas-main/tmp-task13/queue_raw.json").text());
const items: any[] = payload.items || [];
console.log("counts:", JSON.stringify(payload.counts));
for (const item of items) {
    let req: any = {};
    try { req = typeof item.request_json === "string" ? JSON.parse(item.request_json) : item.request_json || {}; } catch {}
    const hasImage = Boolean(req?.image || req?.extra_body?.image || (Array.isArray(req?.image) && req.image.length));
    console.log([item.created_at, item.status, item.kind, "wf=" + item.workflow, "reqModel=" + item.requested_model, "hasImage=" + hasImage, "job=" + item.job_id].join(" | "));
    if (item.error) console.log("   ERROR:", String(item.error).slice(0, 300));
}
// 导出最近一轮生产任务的完整 request_json（created_at >= 1788220000 的图片任务）
const round = items.filter((item) => item.created_at >= 1788220000 && (item.kind === "txt2img" || item.kind === "img2img"));
await Bun.write("d:/infinite-canvas-main/tmp-task13/round_requests.json", JSON.stringify(round.map((item) => ({ job_id: item.job_id, created_at: item.created_at, status: item.status, kind: item.kind, workflow: item.workflow, requested_model: item.requested_model, error: item.error, request_json: item.request_json, outputs: item.outputs })), null, 2));
console.log("round tasks dumped:", round.length);
