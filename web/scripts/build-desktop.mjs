import { cpSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 桌面端静态构建：临时禁用 src/app/api 代理路由（export 模式不支持 route handler），
// 以 NEXT_OUTPUT=export 触发 next.config.ts 的静态导出，构建完成或中断后恢复原目录；
// 成功后直接同步 out → ../webui/out 并写 .build-stamp，不再留手工复制步骤
// （手工复制曾把旧产物拷进去、导致一批前端改动静默未生效，且目录 mtime 不是可靠的新鲜度信号）。
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(webDir, "src/app/api");
const disabledDir = resolve(webDir, "src/api.disabled");
const outDir = resolve(webDir, "out");
const targetDir = resolve(webDir, "..", "webui", "out");

// 自愈：上次构建被中断导致未恢复时，先还原再继续。
if (!existsSync(apiDir) && existsSync(disabledDir)) {
    renameSync(disabledDir, apiDir);
}

const restore = () => {
    if (existsSync(disabledDir)) {
        renameSync(disabledDir, apiDir);
    }
};

// 导出前清掉生成的路由类型校验文件（.next/types 与 dev 模式的 .next/dev/types 都被 tsconfig include）：
// 它们按原路径 import src/app/api/.../route.js，而本脚本会把 src/app/api 临时改名，
// 开启类型检查后会报 Cannot find module；Next 会按当前文件集重新生成
for (const stale of [resolve(webDir, ".next", "types"), resolve(webDir, ".next", "dev", "types")]) {
    rmSync(stale, { recursive: true, force: true });
}

if (existsSync(apiDir)) {
    renameSync(apiDir, disabledDir);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        restore();
        process.exit(130);
    });
}

let exitCode = 0;
try {
    const nextBin = join(webDir, "node_modules", ".bin", process.platform === "win32" ? "next.exe" : "next");
    const result = spawnSync(nextBin, ["build"], {
        cwd: webDir,
        stdio: "inherit",
        env: { ...process.env, NEXT_OUTPUT: "export" },
    });
    exitCode = result.status ?? 1;
} finally {
    restore();
}

// 退出码为 0 但产物缺失也算失败，避免把上一轮旧产物同步进去
if (exitCode === 0 && !existsSync(join(outDir, "index.html"))) {
    console.error("[build:desktop] next build 退出码为 0 但 out/index.html 不存在，视为构建失败");
    exitCode = 1;
}
if (exitCode === 0) {
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(outDir, targetDir, { recursive: true });
    const stamp = new Date().toISOString();
    writeFileSync(join(targetDir, ".build-stamp"), stamp + "\n");
    console.log(`[build:desktop] 已同步 out → webui/out（${stamp}），可直接 go build -tags desktop`);
}
process.exit(exitCode);
