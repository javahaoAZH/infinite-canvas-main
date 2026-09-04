# 项目交接总账（HANDOFF）

> 本文档是 `infinite-canvas-main`（本地 AI 漫剧生产工具）的**唯一权威交接底账**。

---

## §0. 文档使用说明（最优先阅读）

**一句话定位**：本文档是本项目的唯一权威交接底账。任何新会话（AI 或人类）在动手前，**必须先读完本文档 + [`docs/progress/codex-ui-refactor-ledger.md`](./progress/codex-ui-refactor-ledger.md)**，即可掌握项目全貌、约束、进度与下一步，**完全不需要回溯历史聊天记录**（回溯几十万字的聊天记录既浪费额度又不可靠）。

### 维护协议（硬性规则，任何更新都必须遵守）

1. **每完成一项工作**：必须在 [`codex-ui-refactor-ledger.md`](./progress/codex-ui-refactor-ledger.md) 对应行把状态改为 `[x]`（已完成）并填写「验收记录」（日期 + 改动的文件路径 + 验收方式）。
2. **每解决一个 Bug**：必须往本文档「§7 踩坑与已解决问题库」追加一行（问题现象 / 根因 / 修复方式 / 涉及文件）。
3. **每做完一批**：必须更新本文档「§9 当前进度快照」和「§10 下一步」的日期与内容。
4. **追加而非替换**：历史上 CHANGELOG 条目被覆盖吞掉过 3 次，用户对此极为不满。**任何更新都不得删除或覆盖既有内容，只能追加或就地改状态。**
5. **新增技术决策**：写入「§6 关键技术决策」，注明理由和被否决的备选方案。
6. **每次更新文档**：在文档末尾「§12 本文档变更日志」追加一行（日期 / 修改人 / 变更摘要）。
7. **易变数据不得写死**：临时文件数量、`git status` 计数等会自动变化的值，必须写成“测量时刻 + 实测值 + 复测命令”的形式，并注明“仅代表测量时刻”。已固定的历史事实（如某次误操作造成的删除数量、某目录的文件总数）可以写精确数字。

### 配套文档

- [`docs/progress/codex-ui-refactor-ledger.md`](./progress/codex-ui-refactor-ledger.md) —— Codex UI 重构 58 项施工台账（逐项 checkbox + 状态 + 缺口 + 验收记录）
- [`AGENTS.md`](../AGENTS.md) —— 项目开发规范（AI 会话自动读取，已内置指向本文档的强制指针）
- [`docs/progress/todo.md`](./progress/todo.md) —— 长期 TODO
- [`docs/progress/pending-test.md`](./progress/pending-test.md) —— 待测试项
- [`CHANGELOG.md`](../CHANGELOG.md) —— 版本变更记录（`Unreleased` 段有本轮记录）

---

## §1. 项目定位

本地 AI 漫剧 / 视频生产工具，把**网络小说**改编为 **AI 漫剧短剧动画**。核心生产流水线：

```
剧本结构化 → 分镜制作 → 角色四视图 → 分镜首帧图 → 图生视频 → 配音合成 → 一键成片
```

产品形态是**桌面壳 + 本地服务 + 内嵌前端**三位一体，同时支持通过 MCP 被 Qoder / ChatGPT Desktop 等外部 AI 客户端驱动，实现「AI 直接操作漫剧生产流水线」。

---

## §2. 技术栈

| 层级 | 技术 | 版本（实测自 `go.mod` / `web/package.json` / `Dockerfile`） |
|---|---|---|
| 后端 | Go + Gin + GORM | Go 1.25.5 / Gin v1.11.0 / GORM v1.31.1 |
| 前端 | Next.js App Router + React + TypeScript | Next.js 16.2.9 / React 19.2.5 |
| UI | Ant Design v6 + Tailwind CSS v4 | antd ^6.4.2 / tailwindcss ^4 |
| 状态 | Zustand + TanStack Query | zustand ^5.0.12 / @tanstack/react-query ^5.100.9 |
| 数据库 | SQLite / MySQL / PostgreSQL | SQLite 直连驱动 `github.com/glebarez/sqlite v1.11.0`（纯 Go，间接依赖 `modernc.org/sqlite v1.23.1`）；MySQL `gorm.io/driver/mysql v1.6.0`；PostgreSQL `gorm.io/driver/postgres v1.6.0`（`jackc/pgx/v5 v5.6.0`） |
| 桌面壳 | go-webview2（`github.com/jchv/go-webview2`） | Win32 无边框窗口 + DWM 暗色沉浸 |
| MCP | mcp-go + 自研 STDIO/WebSocket 双模适配器 | `github.com/mark3labs/mcp-go v0.58.0` |
| 前端图标 | lucide-react | ^1.16.0 |
| 本地持久化 | localforage | ^1.10.0 |
| 构建 | Bun（前端）+ Go build（后端） | Docker 内 `oven/bun:1.3.14` |
| 容器 | Docker 多阶段构建 | `oven/bun:1.3.14`（web-build）→ `golang:1.25-alpine`（api-build）→ `node:22-bookworm-slim`（final image） |

> ⚠️ 校正说明：SQLite 的 GORM **直连驱动**实际是 `github.com/glebarez/sqlite`（纯 Go 实现），`modernc.org/sqlite` 是其间接依赖。原交接稿写作「modernc.org/sqlite」，此处以 `go.mod` 实测为准。

---

## §3. 架构总览

三层结构：**主程序（Go 桌面壳 + HTTP 服务）** / **独立 MCP 适配器进程** / **前端静态资源**。

```
┌─────────────────────────────────────────────────────────────┐
│  InfiniteCanvas.exe  （Go，编译带 -tags desktop）              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Gin HTTP 服务                                            │  │
│  │  · 主端口 18080（config.Cfg.Port 默认值）                │  │
│  │  · 兼容端口 8080（desktop_desktop.go: const compatPort） │  │
│  │  · /api/*  REST 接口                                     │  │
│  │  · /*      内嵌静态前端（webui/out）                     │  │
│  │  · /ws/drama-mcp  WebSocket                              │  │
│  │  · /api/__show-window  单实例唤醒回调                    │  │
│  └───────────────────────────────────────────────────────┘  │
│  WebView2 无边框窗口 + DWM 暗色沉浸                            │
│  启动时 killOrphanWebviews() 清僵尸子进程 + 单实例协调         │
└─────────────────────────────────────────────────────────────┘
                    │ STDIO / WebSocket
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  drama-mcp.exe  （独立 MCP 适配器进程）                        │
│  · STDIO 对接 Qoder / ChatGPT Desktop                         │
│  · WebSocket 对接浏览器页面桥（drama-bridge.ts）              │
│  · 主程序重启不应断开 MCP 管道（独立进程的核心价值）           │
└─────────────────────────────────────────────────────────────┘
                    │ HTTP / WS
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  前端（Next.js 静态导出 → webui/out）                          │
│  路由见下表                                                    │
└─────────────────────────────────────────────────────────────┘
```

### 前端路由清单（实测自 `web/src/app/`）

- **用户端路由组 `(user)`**：`/`（首页）、`/settings`、`/explore`、`/canvas`、`/image`、`/video`、`/drama`、`/prompts`、`/assets`、`/cost`、`/login`、`/asset-library`、`/workflows`
- **管理端路由组 `(admin)`**：`/admin`、`/admin/ai-logs`、`/admin/assets`、`/admin/credit-logs`、`/admin/prompts`、`/admin/settings`、`/admin/users`
- **其它**：`/api/*`（后端接口）、`/storage-port-bridge`（端口存储桥接页）

> ⚠️ 校正说明：原交接稿路由清单遗漏了 `(user)` 组的 `/asset-library` 与 `/workflows` 两条，且 `/admin` 实为一个路由组（含 7 个后台子页），此处以实测目录为准。

### 主程序关键行为（`desktop_desktop.go` / `router/router.go`）

- **双端口监听**：主端口 `18080`，兼容端口 `8080`（`const compatPort = "8080"`），避免历史书签 / IDE 配置 / 第三方工具残留指向旧端口时被连接拒绝。
- **关窗=隐藏**：窗口关闭按钮改为隐藏，服务不死；真正退出走文件菜单。
- **单实例协调**：`killOrphanWebviews()` 清理上一次实例强杀遗留的脱钩 `msedgewebview2` 子进程；启动前探测 `http://127.0.0.1:{port}/api/__show-window`，命中则唤醒已有窗口而非再起一个。
- **DWM 暗色沉浸**：`dwmapi.dll` 的 `DwmSetWindowAttribute` 开启暗色，消除 `WS_THICKFRAME` 未绘制边框导致的顶部透空带。
- **HTML `Cache-Control: no-cache`**：防止 WebView2 磁盘缓存把旧构建当新鲜页面。

---

## §4. 关键文件地图

> 这是本账最有价值的一节。行号为 2026-09-04 实测（`Get-Content | Measure-Object -Line`），随代码演进会变动，仅供定位参考。

### 后端 Go

| 文件 | 行数 | 职责 |
|---|---|---|
| `config/config.go` | 97 | JWT 密钥持久化（`persistedJWTSecret()` 落盘 `data/.jwt-secret`，`.gitignore` 内）；`JWT_SECRET` 占位值 `infinite-canvas` 触发落盘复用；端口配置（`PORT` 默认 `18080`） |
| `desktop_desktop.go` | 176 | WebView2 桌面窗口：无边框、DWM 暗色沉浸、`killOrphanWebviews()`、单实例协调、服务生命周期与窗口解耦、双端口（`compatPort = "8080"`）、心跳诊断 |
| `desktop_stub.go` | — | 非 desktop 构建标签下的空实现桩 |
| `main.go` | 33 | 程序入口 |
| `router/router.go` | 251 | 路由注册、HTML `Cache-Control: no-cache` 中间件、`/api/__show-window`（`ShowWindowHook`）、兼容端口监听 |
| `service/qoder_channel.go` | 268 | MCP 通道管理、`isDramaMCPEntry`（同时认 `args` 与 `command`）、适配器注册 |
| `service/drama_asset_manifest.go` | 562 | 资产清单加载（UTF-8 BOM 容错 `bytes.TrimPrefix`、`设定/` 子树放行） |
| `mcpadapter/tools.go` | 435 | MCP 工具 Schema 定义（Go 侧，须与 `mcp-adapter/drama-mcp.mjs` 双向同步） |
| `mcpadapter/hub.go` | 240 | WebSocket 消息路由 |
| `mcpadapter/stdio.go` | 105 | STDIO MCP 传输 |
| `cmd/drama-mcp/main.go` | 18 | 独立 MCP 适配器进程入口（薄封装，实际逻辑在 `mcpadapter/`） |
| `handler/drama_asset.go` | 214 | 资产清单 HTTP 接口 |

### 前端 TS（`web/src/`）

| 文件 | 行数 | 职责 |
|---|---|---|
| `app/globals.css` | 418 | Codex 风格全局 CSS Token（颜色 71 个变量 + 圆角 token 已建；间距 / 尺寸 / 过渡 / alpha 四套未建） |
| `app/layout.tsx` | 38 | 根布局、系统字体栈 |
| `app/(user)/layout.tsx` | 63 | 侧栏布局，渲染 `AppSidebar` / `AppTitleBar` / `AppRightRail`（`isBarePage` 时隐藏标题栏与右栏；旧 AppConfigModal 渲染已移除） |
| `app/(user)/page.tsx` | 158 | 首页居中 Composer + 最近列表（画布 + 漫剧） |
| `app/(user)/settings/page.tsx` | 537 | 独立设置页（四组导航 + 搜索 + 行卡片）；旧弹窗 13 块已全部迁入（含语音条件 TTS 行、高级开关、系统提示词抽屉） |
| `app/(user)/settings/components/rows.tsx` | 28 | 设置页共用行卡片（SettingsRow / SettingsSection） |
| `app/(user)/settings/components/model-channels-section.tsx` | 200 | 模型渠道分区：渠道模式（含权限守卫）+ 本地渠道行卡 + 新增/拉取 + 四类默认模型 + 画布张数 + 账号同步 |
| `app/(user)/settings/components/channel-drawer.tsx` | 152 | 渠道编辑抽屉：名称/协议/地址/密钥/拉取模型/选择模型/删除/获取 API Key |
| `app/(user)/settings/components/storage-section.tsx` | 199 | 存储分区：S3/R2 + WebDAV 行级即时保存、互斥启用、统计容量、显式同步到账号（仅后台允许时显示） |
| `app/(user)/plugins/page.tsx` | 165 | 插件与渠道页（台账 A#6）：模型渠道摘要卡 + Qoder/ChatGPT 通道卡（开关/重置令牌/状态点）+ ComfyUI 入口 |
| `app/(user)/explore/page.tsx` | 90 | 探索页 |
| `app/(user)/drama/prompts.ts` | 501 | `DRAMA_SKILL_CATALOG`（assetRules 10 条 / shotRules / characterRules），通过 MCP `drama_get_skills` 下发 |
| `app/(user)/drama/services/drama-generation.ts` | 780 | 角色参考逻辑（`resolveShotCharacters` 过滤空镜防穿帮） |
| `app/(user)/drama/services/drama-bridge.ts` | 1002 | MCP 桥接（`episode_export`、`BRIDGE_TOOLS`） |
| `app/(user)/drama/services/production-readiness.ts` | 69 | 生产就绪度检查（未跟踪新文件）：`productionStages()` 逐阶段判定 8 个门禁（G0 原文覆盖 → G1 资产规划 → G2 资产确认 → G3 连续性分镜 → G4 代表关键帧 → G5 分镜批产 / 动态镜头 / 配音成片）；`representativeShotIds()` 按 `shotRisk`（接触/特效/机位正则）选代表镜头；`approvedRepresentativeIds()` 统计已确认关键帧 |
| `app/(user)/drama/components/production-plan-step.tsx` | 141 | 生产计划步骤（未跟踪新文件）：三 Tab —— 01 原文覆盖台账（每条重要信息须有去向）/ 02 资产圣经（资产卡增删改，`key` 全项目唯一 + 依赖校验 + 交付件）/ 03 逐镜生产包（内嵌 `ShotsStep`）；顶部指标卡显示原文有去向 / 待生产资产 / 连续性分镜数 |
| `app/(user)/drama/components/characters-step.tsx` | 280 | 角色步骤（图片预览 + 详情弹窗） |
| `app/(user)/drama/components/shot-images-step.tsx` | 120 | 分镜图步骤（图片预览） |
| `app/(user)/assets/components/project-assets-panel.tsx` | 793 | 资产面板（表格布局：操作列 `fixed:'right'`、`max-width 1800px`） |
| `app/(user)/canvas/components/canvas-assistant-composer.tsx` | 162 | Composer 组件（Agent LLM 选择器、停止、加号「+」、门禁模式 chip、引用 chip 机制、`onStop` prop） |
| `components/layout/app-sidebar.tsx` | 212 | Codex 风格侧栏（项目名过滤 Input、Bell 图标占位、项目行 ⋯ 菜单） |
| `components/layout/app-titlebar.tsx` | 94 | 自定义标题栏（Win32 桥接） |
| `components/layout/app-right-rail.tsx` | 77 | 右栏（输出内容 / 来源，来源为 config 中静态 model/videoModel） |
| `components/layout/app-config-modal.tsx` | — | **已删除（2026-09-04 批次 C）**：旧设置弹窗 823 行，13 块全部迁入 `/settings`；原「缺配置」调用点全部改为跳转设置页或 `/plugins`，store 中弹窗状态已移除 |
| `stores/use-drama-store.ts` | 304 | `DramaShot` 类型（含 5 个导演字段：动作 / 情绪 / 出场角色 / 出图提示词 / 图生视频提示词） |
| `stores/use-config-store.ts` | 570 | 全局配置（弹窗状态 isConfigOpen/openConfigDialog 等已于批次 C 移除） |
| `app/(user)/canvas/stores/use-canvas-store.ts` | 391 | 画布状态（`archived` 字段） |
| `lib/app-theme.ts` | 74 | antd Token 配置层 |
| `lib/canvas-theme.ts` | 61 | 画布主题 |
| `services/port-storage-migration.ts` | 121 | 8080 → 18080 端口数据迁移 |
| `app/storage-port-bridge/` | 目录 | 端口存储桥接页 |
| `app/storage-port-bridge/page.tsx` | 77 | 端口存储桥接页的具体页面文件（未跟踪新文件）：运行于旧端口 8080，用 `postMessage` 与 18080 父窗口握手（`allowedTarget` 校验 origin），把 localforage 各 store（`app_state`/`image_files`/`media_files`/`image_generation_logs`/`image_generation_categories`/`video_generation_logs`/`creative_workflows`）逐条迁移到新端口 |

> ⚠️ 校正说明：原交接稿写作 `components/app-config-modal.tsx`（874 行），实测真实路径为 **`components/layout/app-config-modal.tsx`**，行数 **823**。设置页、侧栏、标题栏等行数亦有出入，均以本表实测为准。

**旧弹窗 `app-config-modal.tsx` 的处置（2026-09-04 已完成）**：原 15 处 `openConfigDialog` / `AppConfigModal` 引用全部清理——`(user)/layout.tsx` 移除渲染；侧栏「插件与渠道」改跳 `/plugins`；设置页「配置」按钮改为行内编辑/抽屉；漫剧页 Qoder 状态入口改跳 `/plugins`；其余缺配置调用点（生图/视频台、Kling 面板、画布节点面板/提示词面板/蒙版弹窗/工作台、创意工作流、composer、client-root-init、user-status-actions）统一改为 `router.push("/settings")`；`app-top-nav.tsx`（无引用死代码，引用已删模块）一并删除；`use-config-store` 中 isConfigOpen/shouldPromptContinue/openConfigDialog/setConfigDialogOpen/clearPromptContinue 已移除。→ 批次 C 已收尾，台账 A#11（composer 执行渠道下拉）的阻塞解除。

### MCP Node 侧

| 文件 | 行数 | 职责 |
|---|---|---|
| `mcp-adapter/drama-mcp.mjs` | 461 | Go 侧 `mcpadapter/tools.go` 的镜像。**改 Schema 必须两边同步**，否则 STDIO 客户端与浏览器桥工具定义不一致。 |

---

## §5. 数据与资产目录

> ⚠️ 项目产物（漫剧资产）**不在代码库里**，位于独立数据盘目录，务必写清以免新会话找不到。

### 资产根目录

`D:\InfiniteCanvas\第一章·初入\`（实测存在，为 `D:\InfiniteCanvas` 下唯一子目录）

结构：

```
D:\InfiniteCanvas\第一章·初入\
├── 资产清单.json          （约 100KB，57+ 条目）
├── 设定\
│   ├── 故事圣经.md
│   ├── 提示词资产策略.md
│   └── 资产生产规范.md
├── 分集\ep01\
│   ├── 分镜稿.md
│   ├── 提示词与质检.md
│   └── shots\
└── 资产\
    ├── 角色\  场景\  道具\  特效\  生物\  图形\
```

### 内容基线

- 28 镜 ep01 全字段分镜。
- 23 条资产清单 100% 覆盖 28 镜（76 个引用全落地）。
- 原著要素：主角**陆江仙**、**太阴吐纳练气诀**、**月华纪要秘旨**。

### ⚠️ 待用户定口径

- 早期资产目录名为 `D:\InfiniteCanvas\照古长明\`，现为 `第一章·初入\`（旧目录已不存在）。
- 剧名「照古长明」非原著书名，是否更换**未定**，需用户拍板。

### Codex UI 取证临时目录

`d:\infinite-canvas-main\tmp-codex-ui\`（实测子目录：`css`、`jsfeat`、`extracted`、`js`、`edge-profile2/3`、`edge-test-profile`）

- 源包：`C:\Program Files\WindowsApps\OpenAI.Codex_26.831.2377.0_x64__2p2nqsd0c76g0\app\resources\app.asar`（284.7MB）
- 取证产物：`extracted`（解包）、`css`（约 200 个）、`jsfeat`（约 172 个）
- ⚠️ 实测总数：`tmp-codex-ui/` 共 **1217 个文件**（原稿仅统计 css 200 / jsfeat 172），另含 `edge-profile2`、`edge-profile3`、`edge-test-profile` 等额外浏览器 profile、大量 `.png` 截图与测试脚本。属取证沙盒，**不应提交**（详见 §9「未跟踪项（??）分类」）。

### ⚠️ 待清理

工作区根目录散落 `.tmp-mcp-*` MCP 调试临时文件，**数量持续增长**（2026-09-04 04:20 实测 43 个 → 04:43 实测 47 个，仅代表测量时刻）。构成：`.jsonl` 调试日志为主体，另有 `.tmp-mcp-restore-p001.json`、`.tmp-mcp-runner.ps1`、`.tmp-mcp-runner-chatgpt.ps1`、`.tmp-mcp-runner-qoder.ps1` 等 runner 脚本。**属临时垃圾，不应提交**，可安全清理。此外还散落大量 `dev-*.log`、`e2e-*.png`、`tmp-*` 目录，建议在第 0 批一并清理，避免污染构建与 git。复测命令：

```
(Get-ChildItem -LiteralPath 'd:\infinite-canvas-main' -Filter '.tmp-mcp-*' -Force).Count
```

另有 **2 个不应提交的大目录**（实测）：

- `output/`：**71 个文件**，`output/drama` 运行时产物。
- `InfiniteCanvas.exe.WebView2.bak-0904/`：**440 个文件**，WebView2 运行时缓存备份（由误入库的 `InfiniteCanvas.exe.WebView2/` 改名而来，详见 §9「426 条删除的真相」）。

---

## §6. 关键技术决策

| # | 决策 | 理由 | 被否决的备选 |
|---|---|---|---|
| 1 | 升级软件 Schema 而非仅补文档 | 字段不入库就无法被 MCP / 前端 / 生成逻辑统一消费 | 只写规范文档、字段留在 AI 记忆里 |
| 2 | JWT 密钥落盘 `data/.jwt-secret` | 桌面形态频繁重编重启，随机密钥导致每次静默登出 | 每次启动随机生成密钥；写死在配置里 |
| 3 | MCP 独立进程 `drama-mcp.exe` | 主程序重启不应断 MCP 管道 | MCP 内嵌进主程序进程 |
| 4 | `assetRules` 焊入 MCP `drama_get_skills` 而非仅存 AI 记忆 | 任何新电脑 / 新客户端连接即得规范（"新电脑也知道怎么做"） | 规范只写在提示词 / 记忆 / 文档里 |
| 5 | 端口 8080 → 18080 + 双端口兼容 | 避免大众端口与第三方工具残留指向互扰 | 只用 8080；只换 18080 不留兼容监听 |
| 6 | 关窗=隐藏（服务不死）+ 文件菜单退出 | 解决"关窗杀服务"导致外部视图 CONNECTION_REFUSED | 关窗即退出进程 |
| 7 | HTML 一律 `Cache-Control: no-cache` | WebView2 磁盘缓存会把旧构建当新鲜页面 | 依赖默认缓存策略 |
| 8 | DWM 暗色沉浸模式（`DwmSetWindowAttribute`，属性 20） | `WS_THICKFRAME` 7px 边框未绘制导致顶部透空带 | 自绘边框；不处理透空带 |
| 9 | Codex 取证先于换壳 | 用户明确要求"不要凭感觉"，必须实证分析 `app.asar` 源码 | 凭印象 / 截图猜测 Codex UI |
| 10 | 视频生成不走 GPT/Sora，留在自有渠道（Kling/H3/Seedance/Wan） | Sora 2 已废弃（9/24 日落），ChatGPT MCP 无视频工具 | 接 Sora / GPT 视频 |
| 11 | 3D 国漫画风 | 红果平台 TOP13 全为 3D 漫；AI 脸同质化正被平台打击；2025/9/1 起 AI 内容需合规标签 | 2D 平涂 / 写实 |
| 12 | 功能采纳原则：生产向 / 资产向全搬，编码向 / 云向 / 增长向不搬 | 项目定位是本地 AI 视频生产工具 | 无差别照搬 Codex 全部功能 |
| 13 | 不采纳 CSS Modules，维持纯 Tailwind 工具类 | 项目既有风格统一、避免样式方案混用 | 引入 `.module.css` 混用 |
| 14 | 旧端口漫剧项目采用“结构化项目快照 + 已确认磁盘媒体重绑定”升级 | 能跨浏览器端口保留项目/镜头稳定 ID、完整新版字段和已确认图片，避开 Chromium IndexedDB 的来源隔离与大 Blob 经 MCP 传输超时 | 直接复制 IndexedDB；整包替换旧项目；让 MCP 串行搬运所有图片 Blob |
| 15 | 制作门禁导航采用“阶段 + 步骤内视图”双层定位，资产图片按进入视口懒加载 | G1/G3 与 G4/G5 分别共享外层步骤但代表不同生产工作区；32 项资产若一次加载全部原图会浪费内存与阻塞首屏 | 门禁只保存 step；资产卡只展示路径；页面首次渲染即并发加载全部原图 |
| 16 | 图片归档必须走后端 `base64` 二进制字段，并以真实文件魔数验收 | `.png` 扩展名、`image/png` MIME 和非零字节均不能证明内容可解码；Base64 文本也会通过这些表面检查 | 把 Base64 字符串写入 `text` 字段；只检查 MIME/长度；依赖图片组件失败后兜底 |
| 17 | 分镜卡有图时采用媒体原始宽高比与 `object-contain` 完整展示 | 分镜既有竖构图也有横构图，统一 16:9 + `object-cover` 会裁掉人物头脚、武器与环境信息，无法承担代表帧审核 | 固定裁切缩略图；所有卡统一高度但牺牲完整画面 |
| 18 | composer 底行模型选择器 = Agent LLM（textModel），不选图像/视频模型 | composer 是自主 Agent 的对话入口，Agent 运行时取 `textModel || model` 作大脑（`canvas-agent-context.ts` L116、`canvas-assistant-panel.tsx` L248、`canvas-client-page.tsx` L2231 实证）；生图/视频模型属生产层配置，已在生图/视频台与画布配置节点暴露 | 图像/视频双模型 chip（首版实现，用户纠偏后撤销并改正台账计划描述） |
| 19 | 废除设置弹窗后：缺配置改为跳转 `/settings` 模型渠道分区；账号侧配置同步改为模型渠道分区「立即同步」显式触发 | 弹窗（模态套模态）已废；原「完成」按钮的静默上传不可预测且逐键触发会产生请求风暴；显式同步 + 行级本地即时保存兼顾体验与确定性 | 缺配置时继续弹新弹窗；每次键入即自动上传账号 |
| 20 | 角色参考图不默认强制 4K 或透明背景，按用户确认的下游合成方式验收 | 参考图用于生成式合成时，身份一致、主体完整和清晰可辨比形式指标更重要；尺寸与背景要求应由项目或用户明确指定 | AI 擅自把 4K、透明通道设成所有角色资产的硬门槛 |
| 21 | 小说角色后续资产采用“剧情情境表演锚点”，不生产脱离故事的摄影棚表情包 | 表情必须由具体时空、动作、道具接触、光源和前后状态共同驱动；孤立表情会缺少行为动机，并诱发模型用骨相变化和夸张五官代替表演 | 在中性背景凭“疲惫、震惊”等抽象词生成独立表情照 |
| 22 | 全身四视图之后必须建立面部身份控制包，并在人物镜中优先引用 | 官方人物定制规范建议正脸居中并占参考图约一半以上，必要时结合 FaceMesh/结构参考；全身图脸部像素太少，只能稳定体型服装，不能独立锁定五官骨相 | 继续把全身四视图当作表情、剧情图和分镜的唯一人物参考 |
| 23 | 参考图采用“职责 + 主辅优先级 + 预算”而非无序图片堆叠 | 不同参考分别控制身份、结构、姿态构图、空间、道具、风格和特效；模型参考槽有限且权重会竞争，必须先保身份、再匹配角度与姿态、最后补场景风格 | 把所有图片等权塞入；超限静默截断；只靠长负面词阻止漂移 |

---

## §7. 踩坑与已解决问题库

> 本节是防止重复踩坑的核心资产。**每解决一个新 Bug 必须在此追加一行，禁止删除或改写既有条目。**

| # | 问题现象 | 根因 | 修复方式 | 涉及文件 |
|---|---|---|---|---|
| 1 | 重启后静默登出 | `JWT_SECRET` 为占位值时每次启动随机生成新密钥 | 落盘 `data/.jwt-secret` 并复用（`persistedJWTSecret()`） | `config/config.go` |
| 2 | 重编主程序导致 MCP 断连 | `isDramaMCPEntry` 只认 `args` 不认 `command` | 补认 `command` 字段 + 优先使用独立 `drama-mcp.exe` | `service/qoder_channel.go` |
| 3 | 空镜出现幽灵人物 | `collectCharacterReferences` 不区分当前镜头是否有角色 | 新增 `resolveShotCharacters` 过滤空镜 | `app/(user)/drama/services/drama-generation.ts` |
| 4 | 修改未上线（构建产物过期） | `bun run build:desktop` 输出被管道吞掉，stale `web/out` 被复制 | 校验时间戳 + 写 `.build-stamp` | 构建脚本 |
| 5 | 类型错误静默带入产物 | `next.config.ts` 里 `ignoreBuildErrors: true` | 改为 `false` 并修复 4 个类型错误 | `web/next.config.ts` |
| 6 | 资产清单读取失败 | PowerShell `Set-Content -Encoding UTF8` 写入 BOM，Go `json.Unmarshal` 拒绝 | `bytes.TrimPrefix(data, utf8BOM)` 容错 | `service/drama_asset_manifest.go` |
| 7 | 设置页闪一下又回错误页（React #185 无限循环） | Zustand selector `projects.filter(...)` 每次返回新数组触发重渲染 | 选稳定引用 + `useMemo` 派生 | 设置页 / store selector |
| 8 | 关窗后所有视图 CONNECTION_REFUSED | 窗口与服务绑死单进程，关窗即杀服务 | X 改隐藏、文件菜单退出、单实例唤醒 + `/api/__show-window` | `desktop_desktop.go`、`router/router.go` |
| 9 | 双标题栏 | 改 `GWL_STYLE` 后未调 `SetWindowPos(SWP_FRAMECHANGED)` | 补调 `SetWindowPos(..., SWP_FRAMECHANGED)` | `desktop_desktop.go` |
| 10 | 窗口顶部 7px 透空带 | DWM 未开暗色沉浸模式，`WS_THICKFRAME` 边框未绘制 | `DwmSetWindowAttribute(hwnd, 20, ...)` 开暗色 | `desktop_desktop.go` |
| 11 | 僵尸 WebView 窗口 | 硬杀宿主留下脱钩子进程 | 启动时 `killOrphanWebviews()` + `taskkill /T` | `desktop_desktop.go` |
| 12 | PowerShell 批量替换损坏中文文件 | `Set-Content` 默认 ANSI 编码 | **禁止用 PowerShell 改中文源文件**，一律用编辑工具 | （流程约束） |
| 13 | `Eval` 在 goroutine 中静默失败 | WebView2 脚本必须在消息循环线程执行 | 包裹 `window.Dispatch()` | `desktop_desktop.go` |
| 14 | Go 编译 `constant -16 overflows uintptr` | 负整数常量直接转 `uintptr` | 先转 `int64` 再转 `uintptr` | 桌面 Win32 调用处 |
| 15 | Next.js 静态导出 `useSearchParams` 报错 | 动态 hook 在静态生成时无 context | 包裹 `<Suspense>` | 相关页面组件 |
| 16 | 表格操作列被挤出可视区 | 列宽总和 > `scroll.x` 且无 `fixed` | 操作列 `fixed:'right'` + 明确列宽 + `scroll.x=1440` | `app/(user)/assets/components/project-assets-panel.tsx` |
| 17 | `git status` 出现 426 条删除、疑似大量文件丢失 | WebView2 运行时用户数据目录 `InfiniteCanvas.exe.WebView2/` 在初始提交就被误纳入版本库；`.gitignore` 后加的规则对**已跟踪文件无效**；该目录被改名备份后原路径消失 | 确认为纯浏览器缓存（0 源码/文档/配置）、数据已在 `*.bak-0904/` 保留 → 接受删除；补 `.gitignore` 并配合 `git rm -r --cached` 真正取消跟踪；提交一律用 `git add -u` 而非 `git add -A` | `.gitignore`、`InfiniteCanvas.exe.WebView2/` |
| 18 | 旧 8080 项目在 18080 中消失，升级后新版门禁长期锁定 | 浏览器数据按来源端口隔离；旧项目缺原文覆盖、资产圣经、逐镜起止态/连续性等新版字段；同一特效资产引用还存在旧路径 | 新增无损项目快照导入导出与项目级局部补全 MCP；启动时同步 ChatGPT 通道令牌；补齐 15 条覆盖、32 项资产、27 镜生产包并重绑 9 份已确认媒体，修正 E005 引用后完成门禁验收 | `drama-bridge.ts`、`drama-generation.ts`、`mcpadapter/tools.go`、`mcp-adapter/drama-mcp.mjs`、`client-root-init.tsx` |
| 19 | 侧栏已有生产线画布，但 AI 漫剧主页仍显示“还没有漫剧项目” | 8080→18080 迁移用的隐藏 `/storage-port-bridge` iframe 经过全局 `AppProviders` 加载了漫剧 MCP 模块，隐藏旧来源页面以“最新连接”身份顶掉可见的 18080 页面，MCP 快照写回了错误来源 | 存储桥接路由仅承担数据搬运，模块启动时识别该路由并禁止注册 Qoder/ChatGPT WebSocket；重启后向可见 18080 页面重新导入项目快照 | `web/src/app/(user)/drama/services/drama-bridge.ts` |
| 20 | 分镜 1 卡片出现破图，但门禁仍统计为已有图片 | 项目快照保存了媒体元数据，旧会话 Blob URL 已失效；仅恢复项目 JSON 不等于恢复浏览器媒体 Blob | 从项目磁盘归档重新注入镜头 1 原图与两名角色各 4 张确认视图，使当前 18080 localforage 重新获得有效 storageKey/Blob | MCP `drama_inject_image`、`D:\InfiniteCanvas\第一章·初入` |
| 21 | 点击 G1/G3 打开相同内容，G4/G5 也无法定位各自工作区 | 门禁卡只调用 `onNavigate(stage.step)`；G1/G3 共用 step 1，G4/分镜批产共用 step 3，步骤内页签没有受控状态 | 门禁点击改为传递完整 stage；生产规划受控定位“原文覆盖/资产圣经/逐镜包”，分镜页受控定位“代表帧/全部分镜”；资产卡新增真实缩略图与点击放大 | `drama/page.tsx`、`production-plan-step.tsx`、`shot-images-step.tsx` |
| 22 | 分镜 1 重新注入后门禁显示 `hasImage=true`，页面仍持续裂图 | 旧验收只检查 `shotImages` 字段是否存在，未实际读取 URL 像素；页面又直接信任持久化的会话级 `blob:` 地址，失效时没有从磁盘归档恢复 | 分镜页渲染前读取 `image_files` Blob 并重建 URL；Blob 缺失时从分集归档加载并本地重存；MCP 注入改为实际 fetch 回读且验证 MIME/字节后才成功，本次实测回读 2,983,564 字节 | `shot-images-step.tsx`、`image-storage.ts`、`services/api/drama-assets.ts`、`drama-bridge.ts` |
| 23 | 增加 Blob/MIME/字节回读后分镜 1 仍裂图 | 磁盘 `.png` 文件实际以 ASCII `iVBORw0KG...` 开头，是 Base64 文本；导出代码把 `blobToBase64()` 的结果传给后端 `text` 字段，后端按文本原样写盘；前一轮回读验证仍未检查文件魔数 | 保留错误文件备份后解码为真正 PNG；新增 PNG/JPEG/WebP 魔数检查；二进制导出改传后端 `base64` 字段；重新注入后实际回读 2,237,673 字节并由图片查看器成功解码 | `drama-bridge.ts`、`services/api/drama-assets.ts`、`image-storage.ts`、`lib/image-utils.ts` |
| 24 | 分镜图片已经可显示，但竖版人物只看到画面中段 | 分镜图容器固定 `aspect-video`，图片使用 `object-cover` 强制铺满 16:9，942×1668 竖图上下被大量裁切 | 容器读取媒体 `width/height` 设置真实 `aspect-ratio`，图片改 `object-contain`；网格 `items-start` 防止同排卡片被最高卡拉伸，未生成占位仍为 16:9 | `web/src/app/(user)/drama/components/shot-images-step.tsx` |
| 25 | MCP 绑定新角色版本后，资产卡顶层交付件仍显示旧版本文件 | `drama_asset_bind` 已建立当前版本，但清单顶层交付件没有同步为该版本文件 | 绑定并确认后用 `drama_asset_upsert` 同步当前五件交付路径；MCP 回读 R001 v004 与顶层交付件一致 | MCP `drama_asset_bind`、`drama_asset_confirm`、`drama_asset_upsert` |
| 26 | R001 旧版文件删除后，生产规划仍同时显示新版与旧版共 10 张预览 | 页面把清单当前版本文件与项目规划中的旧 `deliverables` 无条件合并，且浏览器项目的 `plannedAssets` 仍停留在 v003 | 预览与交付件统一优先读取清单当前版本；通过安全局部补全把项目 R001 更新为仅 5 个 v004 文件，并补入 R003–R007，保留全部 27 镜与既有媒体 | `web/src/app/(user)/drama/components/production-plan-step.tsx`、MCP `drama_update_preproduction` |
| 27 | 多轮“疲惫”派生图持续换脸，五官和骨相随表情变化 | 直接用全身四视图的小尺寸脸部作为身份参考，并在一次生成里同时改变身份、表情、姿态、场景与光色；长串负面提示无法替代面部结构控制 | 新增面部身份控制包与硬闸门；正脸特写优先进入参考队列，复杂画面按身份→姿态/构图→场景道具→光色单变量迭代，表情必须绑定原文情境且只改软组织与行为 | `prompts.ts`、`drama-generation.ts`、`drama-review.ts`、两套 MCP、AI 漫剧 Skill |
| 28 | R003 面部控制包通过缺失检查，但人物镜实际请求仍未携带该图 | 参考收集逻辑把“身份母版”层统一排除，误伤了属于身份层的面部控制参考，形成“只校验存在、不传入模型” | 单独识别面部身份控制包并纳入参考队列；显式主参考优先，其次身份/匹配角度，再加入场景道具与风格 | `web/src/app/(user)/drama/services/drama-generation.ts` |
| 29 | R003 已绑定多张图片，但资产库列表看起来始终只有一张 | 列表缩略逻辑固定只读取当前版本第一个文件，详情抽屉也只把版本文件渲染成文本标签 | 列表封面增加当前图片数量和详情入口；详情按当前版本全部文件加载对象 URL，以图片网格展示并支持放大 | `web/src/app/(user)/assets/components/project-assets-panel.tsx` |

### 已知未解决问题

| # | 问题 | 说明 |
|---|---|---|
| U1 | 漫剧视频路径 4 个已知问题 | ① 全部视频仅触发首个；② 5B 时长偏短；③ 刷新丢在途任务；④ 离开再回成片消失 |
| U2 | 漫剧项目数据仅存浏览器本地（localforage） | 云同步未做 |
| U3 | `drama-mcp.exe` 发布形态未定 | 随包 / 首次生成 / 子命令，三选一未拍板 |
| U4 | WebView2 Runtime 随包分发策略未定 | — |
| U5 | Docker/Linux 中文字体未内置 | 容器内渲染中文可能缺字 |
| U6 | ComfyUI 上游缺陷 | `execution_error` 会阻塞队列 |
| U7 | FFmpeg 退出码未归一化 | — |
| U8 | 配音缺回退方案 | 火山 TTS 无兜底 |
| U9 | ⚠️ 历史会话末尾遗留 3 个无 AI 回复的用户反馈 | 一张图片、一段 React #185 报错栈、一句"实锤代码问题"的抱怨。React #185 已修过一轮（见上表 #7），但用户之后又贴了报错栈，**需确认是复发还是新问题** |

---

## §8. 用户偏好与硬约束

> 本节必须醒目。以下均为**硬性约束**，违反会直接引发用户强烈不满。

### 必须（MUST）

- **全程中文交流**（页面文案、文档、对话）。
- **实证优先**：设计决策不得凭记忆或感觉，必须实际取证（用户原话："你不要凭感觉来决定"）。
- **一次性规划、确认后批量施工**：先出表格 / 清单让用户确认，再按子系统批量做，每批完成后验收再进下一批。
- **先读现有代码再动手。**
- 出错时**直接承认并修复**，不要辩解推诿（用户原话："不要再跟我说软件没 BUG"）。
- **对标 ChatGPT/Codex 桌面版 UI**，要求 1:1 复刻外壳并逐步对齐功能。
- **质量对标 GPT 产出**，用户会反复比对。
- **宽屏表格布局**：`max-width 1800px`、操作列右固定。
- **MCP 参数用字面中文**，禁止 unicode 转义。
- **规范必须焊入 MCP 工具**，不依赖 AI 临时记忆（"新电脑也知道怎么做"）。
- **大数据用 localforage**（`localStorage` 只放极小配置）。

### 禁止（MUST NOT）

- **禁止用 PowerShell `Set-Content` 改中文源文件**（会损坏编码）。
- **禁止零敲碎打、反复改同一处代码**（用户明确表达过强烈不满）。
- **禁止做不必要的重构。**
- **禁止回滚用户的改动。**
- **禁止改无关文件。**
- **禁止写兼容分支、做数据迁移**（项目未上线，直接按新设计改）。
- **禁止杜撰原著没有的细节。**
- **禁止把 AI 产出质量差距归因于模型能力而不反省提示词**（实验证明 7 成差距在提示词、3 成在模型）。
- **禁止过度打磨单帧**（成本考量）。

---

## §9. 当前进度快照（截至 2026-09-04）

- **《第一章·初入》主角资产**：陆江仙 R001 v004 四视图继续作为体型、服装和整体轮廓母版；R003 已升级为“面部身份控制包”，规划中性正脸、左右三分之四、左右侧面、轻俯/轻仰、五官细节、面部结构控制参考和半身衔接母版共 10 个独立交付件。4 个陆江仙人形镜头已追加 R003 引用与面部几何质检；R003 未产出并确认前禁止继续人物剧情图。R004/R005 保持情境表演与连续动作链设计，旧错误 R004 v001 为“需修改”。
- **版本**：v0.5.8（`VERSION` 文件实测 `v0.5.8`）。
- **✅ 已全部提交并推送**：2026-09-04 按 §9 分批策略完成提交（新增文件 feat 提交 + `git add -u` 修改/缓存清理提交），并推送 `master` 与标签 `v0.5.8` 到 origin；实测 `git status --porcelain` = 0 条。历史风险解除；后续新改动仍需按提交纪律及时提交。
- **Codex UI 重构裁定表**共 58 项有效条目：**全部完成（58/58，100%）**
  - ✅ 严格完成 **58** 项（100%）
  - 🟡 部分完成 **0** 项
  - ❌ 未开始 **0** 项
  - 分优先级：P0 4/4、P1 29/29、P2 18/18、P3 6/6 全部完成
  - **统计口径（A#17 为交叉引用不计入）**：台账 checkbox 共 59 行（批次 A 34 + B 12 + C 13），其中批次 A #17「设置页接管弹窗全部内容」是批次 C 的汇总交叉引用、非独立工作项，故排除后有效工作项为 **58**。若按 59 行全计，则 P1 = 30（完成 30）、合计 59（完成 59）。本组数字与台账批次 D 汇总表一致（截至 **2026-09-04**，实测：`[x]` 59 / `[~]` 0 / `[ ]` 0）。
- **覆盖率实算（对标 Codex 桌面版）**：
  - 路由 **14/35 = 40%**（新增 /queue、/skills）
  - 功能族 **18/60+ = 30%**（外壳功能已全量对标，深层功能族按项目定位取舍）
  - 样式层 **85%**（颜色/圆角/过渡/alpha token 已建，antd 12px/32px 尺度生效，shimmer/毛玻璃落地；间距 token 化以 Tailwind 原生尺度为准未另行建变量）
- 逐项明细见 [`docs/progress/codex-ui-refactor-ledger.md`](./progress/codex-ui-refactor-ledger.md)。
- **外壳骨架与功能层已全量对标**：铃铛（派生通知下拉）、搜索（统一搜索 overlay）、右栏来源（最近使用模型优先）均已接通；旧的「占位」状态不复存在。
- `.agents/skills/ai-drama-preproduction/` 技能目录已建好（实测含 `SKILL.md` + `references/`），台账 #19 的底层资产就绪，只缺 UI。
- **《第一章·初入》旧项目已无损升级到当前 18080 数据源**：项目 ID 与 27 个镜头 ID 均保留；现有 2 名角色共 8 张四视图及镜头 1 分镜图已按磁盘确认文件重新绑定；生产数据为 15 条原文覆盖、32 项资产、27 份完整逐镜包。MCP 实测 G0–G3 已放行，G4 保持 `0/3`（等待代表帧人工确认），G5 保持 `1/27` 分镜、`0/27` 视频（符合成本闸门设计）。
- **门禁工作区与资产可视化已修复并重编桌面版**：G1/G3、G4/分镜 G5 现在分别定位到独立页签；资产圣经卡片从清单当前版本和交付路径读取真实图片，进入视口后加载，支持文件名标识与点击放大；镜头 1 的 2.98 MB 归档原图已重新注入并经 MCP 回读 `hasImage=true`。
- **分镜媒体验收已从“字段存在”升级为“图片字节可读”**：分镜页会在显示前验证 Blob、重建对象 URL，缺失时从 `分集/ep01/shots/` 自修复；镜头 1 再次注入后由新版 MCP 实际回读 `verifiedBytes=2983564`，与磁盘文件长度一致。
- **镜头 1 裂图最终根因已纠正**：上述 2,983,564 字节是 Base64 文本长度，不是有效 PNG，说明上一条“字节可读”验收仍不足；现已保留 `.base64-corrupt.bak-20260904`，将归档解码为 2,237,673 字节真实 PNG，并经本地图片查看器成功显示；MCP 重新注入返回 `verifiedBytes=2237673`，前端/导出链路新增文件魔数硬校验。
- **分镜图展示现按原始比例完整呈现**：镜头 1 的 942×1668 竖版图不再塞进固定 16:9 裁切框；有图卡按媒体宽高展开、`object-contain` 保留完整人物与武器，未生成卡继续使用紧凑 16:9 占位；长列表保留 `content-visibility` 优化。
- **Codex UI 重构已全部完成（58/58，100%）**：composer 底行全套（LLM 选择器、停止、加号、门禁 chip、执行渠道、项目选择器、助手模式、模板、听写、@ 引用）；漫剧批量停止、继续生产、日志 chips、分镜稿预览/导出；侧栏统一搜索、通知铃、最近生成、项目固定；设置页全量接管（弹窗废除）+ /plugins + /queue + /skills；样式层 12px/32px token、全局滚动条、动效 token、shimmer、毛玻璃。各项明细见台账「第四轮施工验收记录」。

### git 工作区状态与提交纪律（截至 2026-09-04）

> 本节沉淀 2026-09-04 的 git 工作区排查真相，避免后续会话重复排查。**一句话结论：git 变更中的 426 条删除（已固定历史事实），是「误入库的 WebView2 运行时缓存被改名备份」的副产物，非事故、无需恢复；但成果未提交无保护，提交必须分批、严禁 `git add -A`。**

#### 变更总量（最后提交 `9cdd751 release: v0.5.7`）

- **426 条 D（删除）** —— 已固定的历史事实，全部为 WebView2 运行时缓存（目录构成与扩展名统计见下文），**不会再变**。
- **M（修改）与 ??（未跟踪）条数为动态值**：`40 M / 56 ??`（2026-09-04 04:20 实测）→ `40 M / 58 ??`（04:27）→ `40 M / 62 ??`（04:43）。增长源**全部**是持续累积的 `.tmp-mcp-*` MCP 调试日志，其余分类（2 份文档 + 9 个新源文件 + 1 个技能目录 + 3 个大目录）保持稳定。
- ⚠️ 所有近期成果均未提交，无 git 保护。本文档中的 M/?? 计数**仅代表测量时刻，开工前请自行复测**：

```
git -C d:\infinite-canvas-main status --porcelain | Group-Object { $_.Substring(0,2).Trim() } | Select-Object Name,Count
```

#### 426 条删除的真相（已排查完毕，结论：无需恢复）

- **100% 落在 `InfiniteCanvas.exe.WebView2/EBWebView/` 下**，全部是 WebView2（Edge Chromium）运行时用户数据。构成：磁盘缓存 94、断词字典 `.hyb` 54、JS 代码缓存 48、跟踪保护名单 23、GPU/着色器缓存 ~18、IndexedDB/Local Storage/Session Storage ~16、子资源过滤规则 15、网络状态 13、扩展数据 12、各类统计与自动填充 DB ~14，其余为组件元数据与 Crashpad。
- 扩展名统计佐证：无扩展名 199、`.hyb` 52、`.json` 12、`.pb` 3、`.pma` 2、`.db` 2、`.dat` 2 等，**全为二进制/数据文件**。
- **被删除的 `.go`/`.ts`/`.tsx`/`.css`/`.md`/`.yaml`/`.yml`/`.toml`/`.sql` 文件数 = 0；落在该目录之外的删除数 = 0。**
- 磁盘实测：原目录 `InfiniteCanvas.exe.WebView2` 已不存在（`Test-Path` = False），随机抽取 12 个被删文件逐一实测全部 False → **真删除，非索引不同步**，不涉及大小写/路径超长/CRLF/符号链接等伪变更。
- **但数据未丢失**：整个目录被改名备份为未跟踪的 `InfiniteCanvas.exe.WebView2.bak-0904/`（实测 **440 个文件**，被删样本 `Default\Cache\Cache_Data\f_00005c` 在备份内实测存在）。
- **成因链**：
  1. 该目录在**初始提交 `0de8d8b`（“chore: 初始化仓库”）就被误纳入版本库**，并延续到 `a2733bd`(v0.5.6) 与 `9cdd751`(v0.5.7)；`.gitignore` 第 12 行虽已写 `/InfiniteCanvas.exe.WebView2/`，但 **git 对已跟踪文件不会因后加 ignore 规则而取消跟踪**，规则形同虚设。
  2. 2026-09-04 有人/某工具把该运行时目录改名备份，原路径消失 → git 报 426 D，新名字不在 ignore 内 → 报 1 ??。
  3. 全库 Grep 无 `bak-0904` 引用，说明是**手工一次性备份**，非构建脚本的 `rm -rf`/`rimraf` 清理步骤。
- **与构建脚本无关**：删除目标是浏览器缓存目录，不是 `web/out`、`webui/out`、`node_modules`；`bun run build:desktop` / `next build` 的清理不会命中此目录。历史记录中的 `web/out→webui/out` 复制、端口迁移、`tmp-codex-ui` 取证目录创建均与这 426 条删除无因果关系。
- **一句话结论**：426 条删除 = “把误入库的 WebView2 运行时缓存改名做了备份”，是清理动作的副产物，**不是事故，建议接受**。

#### 未跟踪项（??）分类

| 类别 | 数量 | 清单 | 处置 |
|---|---|---|---|
| 应提交·本次新建文档 | 2 | `docs/HANDOFF.md`、`docs/progress/codex-ui-refactor-ledger.md` | 提交 |
| 应提交·本次新建源码 | 9 | `web/src/app/(user)/drama/components/production-plan-step.tsx`、`web/src/app/(user)/drama/services/production-readiness.ts`、`web/src/app/(user)/explore/page.tsx`、`web/src/app/(user)/settings/page.tsx`、`web/src/app/storage-port-bridge/page.tsx`、`web/src/components/layout/app-right-rail.tsx`、`web/src/components/layout/app-sidebar.tsx`、`web/src/components/layout/app-titlebar.tsx`、`web/src/services/port-storage-migration.ts` | 提交 |
| 视需要·Agent 技能资产 | 1 目录（5 文件） | `.agents/skills/ai-drama-preproduction/`（含 SKILL.md + references） | 视需要提交 |
| 应忽略·临时垃圾 | 动态增长 | `.tmp-mcp-*` MCP 调试日志（`.jsonl` 为主体 + `.tmp-mcp-restore-p001.json` + `.tmp-mcp-runner*.ps1` 等 runner；04:20 实测 43 → 04:43 实测 47，仅代表测量时刻，复测命令见 §5） | 加 `.gitignore` + 清理 |
| 应忽略·大目录 | 3 | `InfiniteCanvas.exe.WebView2.bak-0904/`（440 文件，纯缓存）、`tmp-codex-ui/`（**1217 文件**，取证沙盒，含 `edge-profile2`、`edge-profile3`、`edge-test-profile` 等额外浏览器 profile、`extracted`、大量 `.png` 截图与测试脚本）、`output/`（71 文件，`output/drama` 运行时产物） | 加 `.gitignore` |

#### ⚠️ 提交纪律（必读）

- **严禁 `git add -A && git commit` 一把梭** —— 会把数十个持续增长的 `.tmp-mcp-*` 临时日志、1217 个取证文件、71 个输出产物、440 个缓存备份一起塞进版本库。
- **必须用 `git add -u` 而非 `git add -A`**：前者只处理已跟踪文件的修改与删除，天然排除全部未跟踪垃圾。
- 提交前**必须** `git status` 复核暂存区，确认 `.tmp-mcp-*` / `tmp-codex-ui/` / `output/` / `*.bak-*` 未被纳入。
- **对已跟踪文件仅加 `.gitignore` 无效**，必须配合 `git rm -r --cached` 才能真正取消跟踪。
- 当前**无需 `git stash`**，分批 add 已足够安全。
- PowerShell 不支持 `&&`，连行请用 `;`。

#### `.gitignore` 现有缺口

已有 `/InfiniteCanvas.exe.WebView2/`、`data/`、`out/`、`.tmp-*.txt`。建议追加（**仅供参考，需用户确认后自行执行**）：

```
# 临时 MCP 调试日志（.jsonl/.json/.ps1 runner）
.tmp-mcp-*
# 取证/沙盒目录
tmp-codex-ui/
# 运行时输出
output/
# 各类备份目录（WebView2 缓存备份等）
*.bak-*/
InfiniteCanvas.exe.WebView2.bak-*/
# 额外浏览器 profile
edge-profile*/
edge-test-profile/
```

#### 推荐的分批提交策略

> 以下命令仅供参考，需用户确认后自行执行。

```
# 第 0 步：补全 .gitignore（见上）

# 第 1 步：提交本次真正的成果（2 份文档 + 9 个新源文件）
git add docs/HANDOFF.md docs/progress/codex-ui-refactor-ledger.md
git add "web/src/app/(user)/drama/components/production-plan-step.tsx" "web/src/app/(user)/drama/services/production-readiness.ts"
git add "web/src/app/(user)/explore" "web/src/app/(user)/settings" "web/src/app/storage-port-bridge"
git add web/src/components/layout/app-right-rail.tsx web/src/components/layout/app-sidebar.tsx web/src/components/layout/app-titlebar.tsx
git add web/src/services/port-storage-migration.ts
git commit -m "feat(ui): 新增 explore/settings/生产计划步骤与布局组件、端口存储迁移；docs: HANDOFF 与重构台账"

# 第 2 步：提交 40 条修改 + 426 条缓存删除（git add -u 不会引入未跟踪垃圾）
git add -u
git status    # 人工复核：应为 40 M + 426 D，且无 .tmp-mcp / tmp-codex-ui / output / *.bak-*
git commit -m "chore: v0.5.7 后续修改；清理误入库的 WebView2 运行时缓存(426 项)"

# 第 3 步（可选）：纳入 agent 技能资产
git add .agents/skills/ai-drama-preproduction
git commit -m "chore(agents): 新增 ai-drama-preproduction 技能"
```

另附：若确实想让 git 恢复那批缓存（**不建议**）：`git restore --source=9cdd751 --staged --worktree -- "InfiniteCanvas.exe.WebView2/"`；取消跟踪但保留磁盘备份：`git rm -r --cached --quiet "InfiniteCanvas.exe.WebView2"`。

#### 40 条修改清单（与历史记录吻合，无异常项）

| 类别 | 数量 | 文件 |
|---|---|---|
| Go 后端 | 7 | `config/config.go`、`desktop_desktop.go`、`router/router.go`、`mcpadapter/hub.go`、`mcpadapter/stdio.go`、`mcpadapter/tools.go`、`service/drama_asset_manifest.go` |
| drama 组件与画布 | 11 | `characters-step.tsx`、`director/director-drawer.tsx`、`script-step.tsx`、`shot-images-step.tsx`、`shot-videos-step.tsx`、`shots-step.tsx`、`voice-step.tsx`、`drama/page.tsx`、`drama/prompts.ts`、`assets/components/project-assets-panel.tsx`、`canvas/stores/use-canvas-store.ts` |
| services / stores | 6 | `drama/services/director-planner.ts`、`drama-bridge.ts`、`drama-generation.ts`、`drama-review.ts`、`services/api/drama-assets.ts`、`stores/use-drama-store.ts` |
| 布局 / 入口 | 7 | `(user)/layout.tsx`、`(user)/page.tsx`、`app/layout.tsx`、`app/globals.css`、`app/api/[...path]/route.ts`、`components/layout/client-root-init.tsx`、`components/layout/user-status-actions.tsx` |
| 文档 / 配置 / 脚本 | 9 | `.env.example`、`AGENTS.md`、`CHANGELOG.md`、`docs/backend/local-development.md`、`docs/progress/pending-test.md`、`docs/progress/todo.md`、`mcp-adapter/drama-mcp.mjs`、`_e2e_portcheck.ps1`、`_e2e_wait_backend.ps1` |

---

## §10. 下一步（施工顺序，已与用户对齐的裁定）

> **施工顺序**：表2 设置重构（P1 核心，一次验收）→ 表1 P0 四项 → 表1 P1 余下 → 表3 P1 四项 → P2 批 → P3 批。
>
> 三个批次（A/B/C）的逐项清单见 [`codex-ui-refactor-ledger.md`](./progress/codex-ui-refactor-ledger.md)。

### 第一批：设置重构（台账批次 C）✅ 已完成（2026-09-04）

- 13 块全部迁入 `/settings`，823 行旧弹窗已删除，15 处调用改道；新增 `/plugins`（A#6）。
- 行为变更：缺配置→跳转设置页模型渠道分区；账号侧同步改为「立即同步」显式触发（决策 §6 #19）。
- 剩余相关项：A#11（composer 执行渠道下拉，阻塞已解除）、C 区三块已完成。

### 漫剧项目当前下一步

- 暂停分镜生图；先按 65 项完整资产清单补齐待产出/需修改资产。R003 已累计到 v003，含用户确认的正脸、左三分之四、右三分之四共3张；下一张生产左侧面头部特写，继续逐张确认所需角度、结构控制和半身衔接母版；随后按 P0 身份/风格/空间/核心道具顺序推进。
- 先在 G4 依次生成并人工确认 3 个代表镜头（当前候选含镜头 12、13；镜头 1 已有图但仍须按新版规则人工确认），通过人物、服装、核心装备、空间关系与特效连续性检查后，再开放其余 26 张分镜图；在此之前不启动视频与配音，避免无效算力消耗。
- 用户先目视验收本轮界面：点击 G1 应打开“资产圣经”、G3 应打开“逐镜生产包”、G4 应只显示 3 个代表帧、分镜批产 G5 应显示 27 镜；资产卡应显示真实缩略图并可放大，镜头 1 不再破图。
- 镜头 1 目视通过后再点击“确认人物、资产与画风”；未看到完整图片前不得仅依据 `hasImage` 或门禁数量确认代表帧。

### 第 0 批（建议先做）

> 对应 §9 最高优先级风险（成果未提交无保护）。**严禁 `git add -A` 一把梭**，会把临时日志 / 取证沙盒 / 输出产物 / 缓存备份一并塞进版本库。分三步：

1. **补 `.gitignore`**：追加 `.tmp-mcp-*`、`tmp-codex-ui/`、`output/`、`*.bak-*/`、`InfiniteCanvas.exe.WebView2.bak-*/`、`edge-profile*/`、`edge-test-profile/`（完整条目见 §9「`.gitignore` 现有缺口」）。对已跟踪的 `InfiniteCanvas.exe.WebView2/` 还须配合 `git rm -r --cached` 才能真正取消跟踪。
2. **按 §9 的分批策略提交**：先 `git add` 本次真正的成果（2 份文档 + 9 个新源文件），再 `git add -u` 提交 40 条修改 + 426 条缓存删除，每步 `git status` 复核暂存区无 `.tmp-mcp-*` / `tmp-codex-ui/` / `output/` / `*.bak-*`（命令见 §9「推荐的分批提交策略」，需用户确认后自行执行）。
3. **清理持续增长的 `.tmp-mcp-*` 临时文件**（数量见 §5，需现场复测）及其它 `dev-*.log` / `e2e-*.png` 散落产物；`tmp-codex-ui/`（**1217 个文件**，含额外浏览器 profile）若已完成取证使命可一并删除，但**需用户确认**。

---

## §11. 相关文档索引

| 文档 | 用途 |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | 项目开发规范（AI 自动读取，已内置指向本文档的强制指针） |
| [`docs/progress/codex-ui-refactor-ledger.md`](./progress/codex-ui-refactor-ledger.md) | Codex UI 重构 58 项施工台账（本次新建） |
| [`docs/progress/todo.md`](./progress/todo.md) | 长期 TODO |
| [`docs/progress/pending-test.md`](./progress/pending-test.md) | 待测试项 |
| [`CHANGELOG.md`](../CHANGELOG.md) | `Unreleased` 段有本轮记录 |
| [`docs/index.md`](./index.md) | 给 AI 使用的文档索引 |
| `D:\InfiniteCanvas\第一章·初入\设定\` | 故事圣经、提示词资产策略、资产生产规范 |

---

## §12. 本文档变更日志

> **每次更新本文档都必须在此追加一行，禁止删除或改写既有条目。**

| 日期 | 修改人 | 变更摘要 |
|---|---|---|
| 2026-09-04 | AI 交接建档 | 建档：完成 §0–§12 全部章节；核实并修正文件路径与行号（`app-config-modal.tsx` 真实路径为 `components/layout/`、823 行；设置页 410 行、探索页 90 行、侧栏 212 行、标题栏 94 行、右栏 77 行）；补录路由 `/asset-library`、`/workflows` 与 `(admin)` 组；校正 SQLite 驱动为 `glebarez/sqlite`；实测 git 未提交变更 522 条、`.tmp-mcp-*` 43 个。 |
| 2026-09-04 | Qoder（Lee 建档 / Felix 修正） | 建档；修正批次 D 与 §9 进度计数错误（P2 17→18、P3 5→6、部分完成 11→12，统一 58 项口径并加脚注）；新增 §9「git 工作区状态与提交纪律」子节；§7 追加踩坑 #17（WebView2 缓存误入库）；§4 补 2 个遗漏源文件；§5 补 tmp-codex-ui/output/bak 目录实测数量；换行符 CRLF→LF。 |
| 2026-09-04 | Qoder（Felix） | 将 `.tmp-mcp-*` 数量、`git status` 的 M/?? 计数由固定值改为“时间戳 + 动态增长说明 + 复测命令”；§0 维护协议追加第 7 条“易变数据不得写死”；426 条删除等已固定事实保持精确数字不变。 |
| 2026-09-04 | Codex | 完成《第一章·初入》从旧 8080 到当前 18080 的无损升级：补齐 15 条原文覆盖、32 项资产与 27 镜新版生产包，保留稳定 ID 并重绑 9 份已确认媒体；追加快照迁移技术决策、跨端口/门禁锁定问题修复记录及代表帧下一步。 |
| 2026-09-04 | Codex | 修复隐藏端口迁移页抢占 MCP 连接：`/storage-port-bridge` 不再启动 Qoder/ChatGPT 通道，确保项目快照写入用户当前可见的 18080 漫剧页面。 |
| 2026-09-04 | Codex | 修复分镜 1 失效 Blob、G1/G3 与 G4/G5 门禁同页问题；生产规划与分镜步骤新增受控子视图，资产圣经新增按视口懒加载的真实缩略图和放大预览；完成前端构建、exe 重编、重启及 MCP/磁盘双重验收。 |
| 2026-09-04 | Qoder | 台账批次 A #1「模型选择器外露」完成：composer 底行新增 Agent LLM 选择器（用户纠偏：选 textModel 而非图像/视频模型，决策记入 §6 #18）；§9 进度计数更新（完成 9/58、P0 1/4、含半成品 36%）。 |
| 2026-09-04 | Qoder | 台账批次 A #2「停止生产」完成：漫剧分镜图/视频/配音批量循环新增「停止」（不派发新任务、在途自然结束）；核实画布 Agent 面板与导演台停止本已具备、首页无在途任务；§9 进度计数更新（完成 10/58、P0 2/4、含半成品 38%）。 |
| 2026-09-04 | Qoder | 台账批次 A #3「加号位统一」与 #4「门禁模式 chip」完成，**P0 四项全清**；§9 进度计数更新（完成 12/58、P0 4/4、含半成品 41%）。 |
| 2026-09-04 | Qoder | **Codex UI 重构 58 项全清（100%）**：第四轮完成批次 A/B 剩余 29 项（/queue、/skills、统一搜索、通知铃、最近生成、项目固定、继续生产、日志 chips、执行渠道、项目选择器、助手模式、模板、听写、@ 引用、审批与速度、MCP 总闸、开源声明、快捷键面板、分镜稿预览/导出、12px/32px token、全局滚动条、动效 token、shimmer、毛玻璃）；§9 计数更新为 58/58；新增路由 /queue、/skills。 |
| 2026-09-04 | Qoder | **发布 v0.5.8 并推送**：修复 composer 底行拥挤重叠（flex-wrap）与标题栏对标（品牌/搜索/铃铛上移标题栏 + 当前项目标签）；修复 drama-review 自动修改枚举字段阻断构建；补全 .gitignore（.tmp-*/tmp-codex-ui/output/*.bak-* 等）；CHANGELOG Unreleased 归档为 v0.5.8；按 §9 分批提交并推送 master 与标签 v0.5.8，工作区清零。 |
| 2026-09-04 | Qoder | **批次 C 设置重构完成**：删除 823 行旧设置弹窗（含无引用死代码 app-top-nav.tsx），13 块全部迁入 `/settings`（渠道行卡+抽屉、四类默认模型、条件 TTS 行、高级开关、S3/WebDAV 存储卡、系统提示词抽屉），15 处调用改道跳转，store 弹窗状态移除；新增 `/plugins`（A#6）；决策 §6 #19；§4 文件地图与 §10 第一批同步更新；§9 进度计数（完成 21/58、P1 15/4/10、含半成品 52%）。 |
| 2026-09-04 | Codex | 纠正“仅凭 hasImage 判定分镜恢复”的不完整验收：新增 Blob 渲染前校验、磁盘归档自修复与 MCP 图片字节回读；重编重启后镜头 1 实测回读 2,983,564 字节。 |
| 2026-09-04 | Codex | 再次纠正不完整图片验收：发现 2,983,564 字节归档是 Base64 文本而非 PNG；保留原文件备份并解码为 2,237,673 字节真实 PNG，修复二进制导出字段并增加 PNG/JPEG/WebP 魔数校验，重编重启与重新注入通过。 |
| 2026-09-04 | Codex | 修复分镜卡固定 16:9 裁切竖图：按媒体原始宽高比布局并改用完整包含模式，网格卡片顶部对齐，完成构建、exe 重编与重启。 |
| 2026-09-04 | Codex | 用户确认陆江仙 B 版后，通过 MCP 建立并确认 R001 v004（核对板 + 四张独立视图），同步修正顶层交付件仍指向旧版的问题；角色参考图验收取消 AI 擅自添加的强制 4K/透明要求。 |
| 2026-09-04 | Codex | 按用户要求永久移除 R001 v001–v003 的清单记录与磁盘文件；修复生产规划把当前版本与旧规划交付件合并成 10 张预览的问题，并用局部补全把项目同步为仅 5 个 v004 文件、总计 37 项资产，新增 R003–R007 主角派生资产计划；重做“深夜疲惫”候选，待用户确认后再入库。 |
| 2026-09-04 | Codex | 用户确认 R004“深夜疲惫”后，通过 MCP 绑定并确认 v001；继续按单张候选、用户目视确认、累计版本写入的顺序生产“眩晕胸闷”，未确认候选不入库。 |
| 2026-09-04 | Codex | 用户进一步对照 R001 母图后否决 R004 v001：确认其脸部被拉长、双颊收窄、下巴变尖且眼型漂移；已通过 MCP 将条目撤回“需修改”并强化身份锁定段，放弃眩晕候选，重新从母图制作深夜疲惫候选。 |
| 2026-09-04 | Codex | 接受用户关于“资产必须带入小说剧情”的纠偏：将 R004/R005 重构为情境表情锚点与出租房剧情动作链并同步项目；按原文、R001、S009、P003 生成“熬夜改方案”情境候选，自检发现并移除桌面重复腕表，候选未确认前不入库。 |
| 2026-09-04 | Codex | 根据官方人物参考/FaceMesh/构图控制资料和疲惫面部研究，升级 AI 漫剧 Skill、AGENTS、软件提示词、ChatGPT/Qoder MCP 与前端硬闸门：四视图后必须补面部身份控制包，人物参考分身份/结构/场景/风格用途，复杂图单变量迭代；R003 已扩充为 10 个交付件，4 个陆江仙人物镜补入引用与质检。Skill 校验通过，未构建。 |
| 2026-09-04 | Codex | 完成上述面部身份控制改造的正式构建与启动：前端 28 个静态页面导出、桌面版和独立 MCP 编译均通过；关闭旧进程后启动新版 `InfiniteCanvas.exe`。旧 STDIO 会话随旧 MCP 进程关闭，需由客户端建立新会话后再做入库回读；R003 中性正脸候选已生成但未入库。 |
| 2026-09-04 | Codex | 深化参考图生产规范：Skill、ChatGPT/Qoder MCP、前端规划字段与实际参考注入统一增加参考职责和主辅优先级；修复面部控制包只检查不传图的问题；《第一章·初入》清单扩至 65 项并形成 33 项待补队列，保持逐张确认后入库。 |
| 2026-09-04 | Codex | 用户确认 R003-01 第二版中性正脸身份控制特写；通过 MCP 绑定并确认 R003 v001，回读归档 1024×1536、2,224,418 字节，顶层交付路径同步为当前真实文件，并明确其余九项仍未完成。 |
| 2026-09-04 | Codex | 将 R003 正脸与用户确认的左右三分之四累计绑定并确认到 v003；修复资产库只能看到第一张的问题，当前版本多图改为数量标记、完整网格和放大预览；前端构建、桌面 exe 重编重启及3张磁盘图片回读通过。 |
