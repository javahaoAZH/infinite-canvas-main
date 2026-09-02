// 任务 #3 收尾：补交 seconds=4 的 wan22-i2v-14b 边界测试
const BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443";
const TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006";

const body = new FormData();
body.append("model", "wan22-i2v-14b");
body.append("prompt", "画面中的人物缓缓转身，发丝随风飘动，镜头保持平稳，自然光变化");
body.append("seconds", "4");
body.append("size", "1280x720");
const file = Bun.file("d:/infinite-canvas-main/_tmp_small.png");
body.append("input_reference", new Blob([await file.arrayBuffer()], { type: "image/png" }), "ref.png");

const response = await fetch(`${BASE}/v1/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body,
});
const text = await response.text();
console.log("wan22-i2v-14b seconds=4 status:", response.status, "body:", text.slice(0, 500));
