// 临时测试脚本：提交 seconds=5 的 5B/14B 视频任务（任务 #13，用完删除）
const BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443";
const TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006";

async function submit(model: string, prompt: string, size: string, withImage: boolean) {
    const body = new FormData();
    body.append("model", model);
    body.append("prompt", prompt);
    body.append("seconds", "5");
    body.append("size", size);
    if (withImage) {
        const file = Bun.file("d:/infinite-canvas-main/_tmp_small.png");
        body.append("input_reference", new Blob([await file.arrayBuffer()], { type: "image/png" }), "ref.png");
    }
    const response = await fetch(`${BASE}/v1/videos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body,
    });
    const text = await response.text();
    console.log(model, "status:", response.status, "body:", text.slice(0, 400));
    return response.status;
}

await submit("wan22-ti2v-5b", "镜头缓慢推进，湖面雾气流动，光线柔和变化，画面自然生动", "960x544", false);
await submit("wan22-i2v-14b", "画面中的人物缓缓转身，发丝随风飘动，镜头保持平稳，自然光变化", "1280x720", true);
