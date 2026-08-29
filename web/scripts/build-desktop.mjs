import { existsSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 桌面端静态构建：临时禁用 src/app/api 代理路由（export 模式不支持 route handler），
// 以 NEXT_OUTPUT=export 触发 next.config.ts 的静态导出，构建完成或中断后恢复原目录。
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(webDir, "src/app/api");
const disabledDir = resolve(webDir, "src/api.disabled");

// 自愈：上次构建被中断导致未恢复时，先还原再继续。
if (!existsSync(apiDir) && existsSync(disabledDir)) {
    renameSync(disabledDir, apiDir);
}

const restore = () => {
    if (existsSync(disabledDir)) {
        renameSync(disabledDir, apiDir);
    }
};

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
process.exit(exitCode);
