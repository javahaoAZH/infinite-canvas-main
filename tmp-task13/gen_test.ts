// 临时测试脚本：经 /v1/images/generations 出测试图并保存（任务 #13，用完删除）
const BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443";
const TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006";
const PROMPT = "二十五岁左右的青年男子，黑色短发微乱，眼下带青黑眼袋，面色苍白疲惫，穿灰色连帽卫衣，赛璐璐画风，清晰封闭描边，大色块平涂";

const model = process.argv[2] || "noobai-xl-vpred";
const tag = process.argv[3] || "a";
const body: Record<string, unknown> = { model, prompt: PROMPT, n: 1, size: "1024x1536", response_format: "b64_json" };
console.log("requesting:", model, tag, "size=1024x1536");
const startedAt = Date.now();
const response = await fetch(`${BASE}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
});
console.log("status:", response.status, "elapsed:", Math.round((Date.now() - startedAt) / 1000) + "s");
const text = await response.text();
if (!response.ok) {
    console.log("error body:", text.slice(0, 800));
    process.exit(1);
}
const payload = JSON.parse(text);
const images: any[] = payload.data || [];
console.log("images:", images.length);
let index = 0;
for (const image of images) {
    const out = `d:/infinite-canvas-main/tmp-task13/test_${model}_${tag}_${index}.png`;
    if (image.b64_json) {
        await Bun.write(out, Buffer.from(image.b64_json, "base64"));
    } else if (image.url) {
        const r = await fetch(image.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
        await Bun.write(out, await r.arrayBuffer());
    }
    console.log("saved:", out, image.url ? "(url=" + image.url.slice(0, 100) + ")" : "");
    index += 1;
}
