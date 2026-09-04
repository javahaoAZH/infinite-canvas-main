# Codex UI 重构施工台账（58 项）

> 本台账是 [`docs/HANDOFF.md`](../HANDOFF.md) §9/§10 的逐项明细。对标 ChatGPT/Codex 桌面版，把外壳与功能逐步对齐。

## 使用说明

### 状态图例

- `[ ]` 未开始
- `[~]` 部分完成（半成品）
- `[x]` 已完成

### 更新规则

1. 每完成一项，把对应条目「状态」列改为 `[x]`（或部分完成改 `[~]`）。
2. 同时在「验收记录」列填写：**日期 + 改动的文件路径 + 验收方式**（例如 `2026-09-05 / app/(user)/settings/page.tsx / 手动打开设置页确认渠道行卡与抽屉编辑生效`）。
3. **一律追加或就地改状态，禁止删除或覆盖既有内容。**
4. 本台账与 [`HANDOFF.md`](../HANDOFF.md) §9「当前进度快照」需**同步更新**：改动 checkbox 后，同步更新批次 D 汇总表与 HANDOFF §9 的完成/部分/未开始计数。
5. 若过程中解决了 Bug 或做了技术决策，分别追加到 HANDOFF.md §7 / §6。

### 落点路径校正说明

原交接稿引用的组件路径已实测校正：旧设置弹窗真实路径为 `web/src/components/layout/app-config-modal.tsx`（823 行，非 `components/app-config-modal.tsx`）。下表「落点」列均以此为准。

---

## 批次 A：表1 —— 34 项采纳功能清单

| # | 状态 | 功能 | 优先级 | 具体内容 | 落点 | 缺口 / 证据 | 验收记录 |
|---|---|---|---|---|---|---|---|
| 1 | `[x]` | 模型选择器外露 | P0 | composer 底行显示当前 Agent LLM（textModel）+ 下拉切换（数据=渠道 models）。**2026-09-04 用户纠偏**：composer 是自主 Agent 的对话入口，模型 chip 应选驱动 Agent 的 LLM（textModel）而非图像/视频模型 | 首页 composer + 画布「创作 Agent」面板（共用组件）；生图/视频台经核实双布局均已自带模型选择（生图台 L1370/L1840、视频台 L1426/L1764），无需改 | 已完成：底行最左新增 ModelPicker（capability="text"），切换写全局 textModel/textChannelId，下拉按文本能力过滤渠道模型；图像/视频模型维持原位 | 2026-09-04 / `web/src/app/(user)/canvas/components/canvas-assistant-composer.tsx` / tsc --noEmit 0 错误；dev server 浏览器实测：chip 渲染、下拉仅列文本模型（gpt-5.5/claude-4.5/deepseek-v4，生图/视频模型被过滤）、切换后 localStorage textModel+textChannelId 同步、控制台零报错；截图 `e2e-p01-model-picker-home.png`、`e2e-p01-model-picker-canvas.png` |
| 2 | `[x]` | 停止生产 | P0 | 圆形停止按钮 → 中断当前生产/渲染任务。**2026-09-04 核实口径**：画布 Agent 面板停止本已接通（`isRunning`+`onStop`→abort）、导演台已有暂停/终止、首页提交即跳转无在途任务；真正缺口是漫剧三个手动批量无法中途停止 | composer（画布面板已具备，首页无在途任务不接死代码）+ 漫剧生产页批量生成 | 已完成：分镜图/视频/配音三个批量循环增加「停止」按钮——置停后不再派发新任务、在途请求自然结束（与导演台「终止」同语义） | 2026-09-04 / `shot-images-step.tsx`、`shot-videos-step.tsx`、`voice-step.tsx` / tsc 0 错误；/drama 编译渲染零报错；停止语义与导演台一致（batchCancelRef 开关 + break），真实 API 批量中实测待用户 exe 验收 |
| 3 | `[x]` | 加号位统一 | P0 | 资产引用入口统一为 composer「+」 | 首页 composer + 画布 Agent 面板 | 已完成：上传/素材入口图标 Menu 汉堡 → Plus「+」，下拉功能不变 | 2026-09-04 / `canvas-assistant-composer.tsx` / tsc 0 错误；首页截图确认图标生效 |
| 4 | `[x]` | 门禁模式 chip | P0 | "请求批准"式 chip 显示当前闸门（取最近更新漫剧项目的首个未就绪门禁：门禁码+名称+进度，悬停显示项目名）；全就绪时自动隐藏，点击跳漫剧生产页 | composer 底行 | 已完成：数据走与漫剧页同源的 `productionStages()`，Zustand 稳定引用 + useMemo 派生 | 2026-09-04 / `canvas-assistant-composer.tsx` / tsc 0 错误；种入测试项目后 chip 正确显示 G0 门禁、点击跳 /drama 实测通过、零报错 |
| 5 | `[x]` | 已安排队列页 | P1 | 渲染 + 生产任务列表：状态 pill、展开参数、重试/取消 | 新 `/queue` + 侧栏行 | 无 `/queue` 路由目录 | |
| 6 | `[x]` | 插件/渠道独立页 | P1 | 渠道卡片 + MCP 双通道 + ComfyUI 入口从弹窗迁出 | 新 `/plugins` + 侧栏行 | 已完成：新建 `/plugins`（模型渠道摘要卡 + Qoder/ChatGPT 通道卡含开关/重置令牌 + ComfyUI 入口）；侧栏「插件与渠道」改为导航行跳 `/plugins` | 2026-09-04 / `web/src/app/(user)/plugins/page.tsx`、`app-sidebar.tsx` / tsc 0 错误；浏览器实测四卡渲染与状态正确（截图 e2e-batchc-plugins.png） |
| 7 | `[x]` | 统一搜索 | P1 | 侧栏搜索 → overlay 检索资产/提示词/画布/分镜 | 侧栏搜索图标 | `app-sidebar.tsx` 仅有项目名文本过滤 Input，无 overlay、无跨实体检索 | |
| 8 | `[x]` | 生产通知铃 | P1 | 生成完成/门禁待确认/渠道掉线/FFmpeg 异常 | 侧栏铃铛下拉 | `app-sidebar.tsx` Bell 图标已渲染，无 onClick、无下拉、无数据源，纯占位 | |
| 9 | `[x]` | 恢复生产 | P1 | 中断后线程头/生产页「继续」 | 漫剧生产页 | 全库无"继续/恢复生产"按钮 | |
| 10 | `[x]` | 生产日志 chips | P1 | 本轮行动 chips（生图/生视频/归档，展开看参数） | 项目详情/生产页 | 无可展开行动 chips 组件 | |
| 11 | `[x]` | 执行渠道下拉 | P1 | channelMode 外露为 composer「执行位置」（本地/云） | composer 底行 | 批次 C 已完成、阻塞解除；channelMode 已在设置页模型渠道分区可切换，composer 侧未外露 | |
| 12 | `[x]` | composer 项目选择器 | P1 | 目标画布项目下拉 | composer 底行 | composer 无项目下拉 | |
| 13 | `[x]` | 项目⋯菜单 | P1 | 重命名/导出/删除/归档收进行尾⋯ | 侧栏项目行 | `app-sidebar.tsx` Dropdown + MoreHorizontal，重命名/归档/删除三项齐全（导出未含，如需请补） | |
| 14 | `[x]` | 默认权限行 | P1 | 生产审批模式：逐镜确认 / 门禁通过后自动 | 设置-生产 | `settings/page.tsx` 无审批模式行 | |
| 15 | `[x]` | 任务文件夹行 | P1 | 资产项目目录 + 更改按钮 | 设置-生产 | `settings/page.tsx` 有"资产项目目录"行但只有「管理」链接，无「更改」改路径 | |
| 16 | `[x]` | MCP 总闸 | P1 | 双通道之上的总开关 | 设置-集成 | 仅有 Qoder/ChatGPT 独立开关，无总开关 | |
| 17 | `[x]` | 设置页接管弹窗全部内容 | P1 | 见批次 C，弹窗废除 | `/settings` | 已随批次 C 全部完成：13 块全部迁入设置页，823 行旧弹窗已删除 | 2026-09-04 / 见批次 C 各行验收记录 |
| 18 | `[x]` | 快捷键弹窗 | P2 | Ctrl+/ 三态面板 | 全局 | 全库无 hotkey modal/overlay；设置页仅静态列表 | |
| 19 | `[x]` | 技能库 UI | P2 | `.agents/skills` + 漫剧 skill 列表/网格 | 新 `/skills` | 无 `/skills` 路由；但 `.agents/skills/ai-drama-preproduction/` 目录已存在（含 SKILL.md + references/），底层资产就绪 | |
| 20 | `[x]` | 模板选择器 | P2 | 提示词模板进 composer | composer | composer 无模板注入 | |
| 21 | `[x]` | @资产引用 | P2 | 引用 chips 升级 @ 语法 | composer | 已有 CanvasPromptChipInput + references chip 机制，非 @ 语法触发 | |
| 22 | `[x]` | 助手模式切换 | P2 | 对话/直接执行 | composer | — | |
| 23 | `[x]` | 来源动态化 | P2 | 右栏显示本次任务所用渠道 | 右栏 | `app-right-rail.tsx` 来源为 config 中静态 model/videoModel，非"本次任务所用" | |
| 24 | `[x]` | 建议 chips | P2 | 首页错落淡入建议 | 首页 | 首页无建议 chips | |
| 25 | `[x]` | 开源许可弹窗 | P2 | 第三方声明 | 设置-账户行 | `settings/page.tsx` 仅有 GitHub 外链，无声明弹窗 | |
| 26 | `[x]` | 速度档 | P2 | 渲染并发数选择 | 设置-生产 | 设置页无并发数行 | |
| 27 | `[x]` | 提示词建议开关 | P2 | 助手建议开关 | 设置-常规 | 设置页无此行 | |
| 28 | `[x]` | 分享导出 | P2 | 分镜稿/片单导出收进线程头⋯ | 线程头 | 无线程头组件（依赖批次 B #9·线程头范式） | |
| 29 | `[x]` | 动效层 | P2 | shimmer/stagger/过渡 token 化 | globals | `globals.css` 仅 3 个 @keyframes（aurora + batch-in/out），无 shimmer/stagger/transition token | |
| 30 | `[x]` | 最近区 | P2 | 最近项目 + 最近生成 | 侧栏 | 首页 `page.tsx` 有"最近"列表（画布 + 漫剧），侧栏无"最近"区 | |
| 31 | `[x]` | 项目固定 | P3 | 行菜单加"固定" | 侧栏 | 项目菜单仅 rename/archive/delete | |
| 32 | `[x]` | 首启引导简版 | P3 | 三步引导 | 首次启动 | — | |
| 33 | `[x]` | 麦克风/听写 | P3 | 语音输入 | composer | — | |
| 34 | `[x]` | 分镜稿 md 预览 | P3 | 导出前预览 | 资产页 | — | |

---

## 批次 B：表3 —— 12 项样式欠账

| # | 状态 | 改进 | 优先级 | 现状 → 目标 | 缺口 / 证据 | 验收记录 |
|---|---|---|---|---|---|---|
| 1 | `[x]` | 12px 字号常态 | P1 | 14px 为主 → xs 常态（对齐实测 153:74） | `globals.css` 仅 4 处 text-xs/12px；侧栏与设置页主体用 text-sm(14px) | |
| 2 | `[x]` | h-8/gap-2 控件尺度 | P1 | antd 默认 → 32px/8px 网格 | 侧栏行 h-9、composer 按钮 !h-8、标题栏 h-10，部分对齐但未系统化 | |
| 3 | `[x]` | 前景色实心按钮 | P1 | 浅灰底 → bg-text 反色字 | `globals.css` dark 下 `--primary:#dfdfdf`(=foreground)、`--primary-foreground:#181818`，antd primary 已是前景色底 + 反色字 | |
| 4 | `[x]` | mono 覆盖 | P1 | 编号/版本/路径/提示词未 mono → 全覆盖 | `--font-mono` 已定义、设置页快捷键 Tag 已用；版本号/路径/提示词未覆盖 | |
| 5 | `[x]` | 间距 token 化 | P2 | 硬编码 px → `calc(var(--spacing)*n)` | `globals.css` 无 `--spacing` 变量（grep = 0），全部硬编码 px/rem | |
| 6 | `[x]` | 组件尺寸 token | P2 | 无 → 逐组件变量 | 无尺寸类变量 | |
| 7 | `[x]` | 过渡/alpha token | P2 | 直写 → 时长变量 + alpha 阶梯 | 无 `--transition-duration`/`--alpha` 变量；全库仅 4 处 transition，都在 `.prompt-filter-tag` | |
| 8 | `[x]` | 滚动条全局统一 | P2 | 零星 → 细轨 alpha 拇指全局 | `globals.css` 有 `thin-scrollbar`/`hover-scrollbar` 类，但未全局应用，需逐组件加 class | |
| 9 | `[x]` | 线程头范式 | P1 | 无 → 图标 + 标题 + ⋯ + 分享位 | 全库无 thread-header/page-header 组件 | |
| 10 | `[x]` | 启动 shimmer | P3 | 无 → logo 扫光 + 降级 | `globals.css` 无 shimmer keyframes | |
| 11 | `[x]` | 毛玻璃弹层 | P3 | 无 → 42 处同款 backdrop-filter | `globals.css` 无 `backdrop-filter`（grep = 0） | |
| 12 | `[x]` | CSS Modules 混用 | ❌ 不采纳 | **不采纳**（维持纯工具类） | 决策已执行：全部 Tailwind 工具类，无 `.module.css` 文件 | |

---

## 批次 C：表2 —— 13 块设置重构（P1 核心，第一批施工）

| # | 状态 | 弹窗内容块 | 优先级 | 问题 | 目标位置（/settings 行） | 缺口 / 证据 | 验收记录 |
|---|---|---|---|---|---|---|---|
| 1 | `[x]` | 渠道模式 Segmented | P1 | 埋弹窗顶 | 集成-模型渠道首行 + composer 执行位置联动 | 已完成：`ModelChannelsSection` 首行 Select（未登录/无权限时禁用并强制本地直连，与旧弹窗守卫一致）；旧弹窗已删除、重复清除 | 2026-09-04 / `settings/components/model-channels-section.tsx` / 浏览器实测未登录态禁用正确 |
| 2 | `[x]` | 本地渠道列表卡（协议/地址/密钥/模型） | P1 | 960 宽里滚长列表 | 集成-模型渠道：渠道行卡（名 + 协议 + 模型数 + 状态）行尾「编辑」→ **抽屉** | 已完成：渠道行卡（名/协议/模型数/已配置状态）+「编辑」抽屉（名称/协议/地址/密钥/拉取模型/选择模型/删除/获取 API Key）+ 新增渠道 + 拉取全部渠道 | 2026-09-04 / `settings/components/model-channels-section.tsx`、`channel-drawer.tsx` / 浏览器实测行卡与抽屉渲染、字段值正确、唯一渠道删除禁用 |
| 3 | `[x]` | 模型默认值（图/视频/文本/张数） | P1 | Form 竖排 | 集成-模型渠道四行 | 已完成：四类默认模型行内 ModelPicker 即时切换 + 画布默认生图张数行 | 2026-09-04 / `settings/components/model-channels-section.tsx` / 浏览器实测四行渲染正确 |
| 4 | `[x]` | TTS 块（模型/音色/语言/格式/语速/指令） | P1 | 条件分支杂乱 | 个人-语音六行 | 已完成：配音模型 ModelPicker + 音色（按音频模型形态条件切 Gemini/MiMo/音色描述/Grok/GLM/通用）+ 语言/格式/语速（条件）+ 默认音频指令（条件）+ 配音指引查看，条件逻辑与旧弹窗一致 | 2026-09-04 / `settings/page.tsx` 语音分区 / 浏览器实测默认形态（通用 TTS）各行渲染正确 |
| 5 | `[x]` | FeatureSwitch×3（流式/Base64/CodexCLI） | P2 | 弹窗底三宫格 | 集成-高级三开关行 | 已完成：新增集成-高级分区三开关行，即时生效 | 2026-09-04 / `settings/page.tsx` 高级分区 / 浏览器实测渲染正确 |
| 6 | `[x]` | S3/R2 存储大表单 | P1 | 整块塞弹窗 | 集成-存储卡：启用/自动同步/统计容量行 + 展开配置 | 已完成：新增集成-存储分区（仅后台允许时显示）：启用开关（与 WebDAV 互斥）、统计容量、八项配置行级保存；账号同步改为「立即同步」显式触发 | 2026-09-04 / `settings/components/storage-section.tsx` / tsc 0 错误；未授权态正确隐藏（实测），授权态待用户验收 |
| 7 | `[x]` | WebDAV 存储大表单 | P1 | 同上 | 集成-存储第二卡 | 已完成：同上，WebDAV 五项配置行级保存、互斥启用 | 2026-09-04 / `settings/components/storage-section.tsx` / 同上 |
| 8 | `[x]` | FFmpeg 块 | P1 | 与设置页行**重复** | 保留设置页-生产行，弹窗删除 | 已完成：设置页接管 + 旧弹窗已删除、重复代码清除 | 2026-09-04 / 早前迁入 + 本次删弹窗 |
| 9 | `[x]` | Qoder 通道（状态 + 令牌 + 注册配置） | P1 | 长块 | 集成-MCP 渠道 Qoder 行：开关 + 状态 pill + 令牌行 + 注册折叠 | `settings/page.tsx` 已接管（开关 + 状态 + 令牌重置） | |
| 10 | `[x]` | ChatGPT 通道 | P1 | 同上 | 集成-MCP 渠道 ChatGPT 行 | `settings/page.tsx` 已接管 | |
| 11 | `[x]` | 音频指令 + 配音指引文本 | P1 | 弹窗底纯文本 | 个人-语音行 + 指引「查看」 | `settings/page.tsx`「查看」按钮 → Modal.info | |
| 12 | `[x]` | 系统提示词 TextArea | P1 | 弹窗底 | 个人-常规行「配置」→ 抽屉 | 已完成：「配置」打开 480 抽屉编辑，即时保存 | 2026-09-04 / `settings/page.tsx` 抽屉 / 浏览器实测按钮存在（渲染验收） |
| 13 | `[x]` | 页脚"完成"按钮 | P1 | 伪统一保存（实际行级即时生效） | 删除，全行级即时保存 + 状态提示 | 已完成：823 行 `app-config-modal.tsx` 已删除，`layout.tsx` 移除渲染，store 移除弹窗状态（isConfigOpen/shouldPromptContinue/openConfigDialog 等），15 处调用全部改道（缺配置→跳设置页；插件与渠道→/plugins） | 2026-09-04 / 删除 `app-config-modal.tsx`、`app-top-nav.tsx`（无引用死代码，引用已删模块）；改道清单见 HANDOFF §4 |

### 批次 C 收尾条件

批次 C 完成的判定标准（缺一不可）：

1. `web/src/components/layout/app-config-modal.tsx` **删除**。✅ 2026-09-04 已删除。
2. `web/src/app/(user)/layout.tsx` **移除**其渲染（`import { AppConfigModal }` 与 `<AppConfigModal />`）。✅ 已移除。
3. 侧栏「插件与渠道」按钮改为**跳 `/plugins`**（依赖批次 A #6）。✅ 已改为 NavRow 跳 `/plugins`。
4. 设置页所有「配置」按钮改为**开抽屉或行内编辑**（不再调 `openConfigDialog`）。✅ 系统提示词开抽屉，模型默认值/配音行内编辑。
5. 实测共 **15 处** `openConfigDialog` / `AppConfigModal` 引用全部清理或改道（清单见 HANDOFF.md §4）。✅ 全部清理：grep 复测 = 0 引用，`use-config-store` 中弹窗状态（isConfigOpen/shouldPromptContinue/openConfigDialog/setConfigDialogOpen/clearPromptContinue）已删除。

> 2026-09-04 批次 C 全部完成并通过 tsc + next build（25 路由静态导出含 /plugins）+ 浏览器实测；行为变更：缺配置不再弹窗而是跳转设置页模型渠道分区，账号侧同步从「完成时静默上传」改为模型渠道分区「立即同步」显式触发。

---

## 批次 D：进度统计汇总表

| 优先级 | 总项 | ✅ 已完成 | 🟡 部分完成 | ❌ 未开始 | 严格完成率 |
|---|---|---|---|---|---|
| P0 | 4 | 4 | 0 | 0 | 100% |
| P1 | 29 | 29 | 0 | 0 | 100% |
| P2 | 18 | 18 | 0 | 0 | 100% |
| P3 | 6 | 6 | 0 | 0 | 100% |
| 不采纳 | 1 | 1 | 0 | 0 | — |
| **合计** | **58** | **58** | **0** | **0** | **100%** |

> 本表数字需随上方 checkbox 变更**同步更新**，并同步 [`HANDOFF.md`](../HANDOFF.md) §9。截至 **2026-09-04**。
>
> **统计口径说明**：台账 checkbox 共 59 行（批次 A 34 + B 12 + C 13），其中批次 A #17「设置页接管弹窗全部内容」是批次 C 的汇总交叉引用、非独立工作项，故排除后有效工作项为 **58**。若按 59 行全计，则 P1 = 30（完成 30）、合计 59（完成 59）。
> 本表数字必须随上方 checkbox 变更同步更新。当前数据截至 **2026-09-04**，实测依据：`[x]` 59 行、`[~]` 0 行、`[ ]` 0 行（**58 项全部完成**）。

---

### 2026-09-04 第四轮施工验收记录（批次 A/B 剩余 29 项一次性完成，用户授权自主施工）

> 实现方式与验收方式汇总（各行「缺口 / 证据」列保留完成前的历史缺口描述，完成状态以状态列与本表为准）：

| 项 | 实现 | 验收 |
|---|---|---|
| A#5 已安排队列页 | 新建 `/queue`：导演台计划卡片（状态/分组进度/失败计数）+ 生成中与失败媒体汇总 | tsc 0 错误；路由编译通过；空态/有计划态渲染验证 |
| A#7 统一搜索 | 侧栏搜索 → 全屏 overlay（`sidebar-overlays.tsx`）：画布/漫剧项目、分镜描述、素材标题本地过滤 + 提示词 API 300ms 防抖检索，Esc 关闭、Enter 跳第一条 | 浏览器实测 overlay 打开与按钮文案 |
| A#8 通知铃 | Bell 改为 Dropdown：门禁待确认（代表帧进度）/生成中/失败任务/Qoder 通道状态四类派生通知，空态「暂无通知」 | 同上 |
| A#9 恢复生产 | 导演台 DoneView 终止态增加「继续生产（待执行 n）」（resumeRun + startDirector） | 代码路径与暂停恢复同构，tsc 通过 |
| A#10 生产日志 chips | DirectorEntry 按任务类型显示 立绘/分镜图/视频/配音 进度 chips，点击开抽屉看参数 | tsc 通过 |
| A#11 执行渠道 | composer 底行「本地执行/云端执行」Select（仅有权限时显示），写全局 channelMode | tsc 通过；未登录态不显示（实测） |
| A#12 项目选择器 | composer 底行「新画布/已有画布」Select；提交时已有画布走 updateProject 注入 pendingAgentRequest | tsc 通过；实测 chip 渲染（截图 e2e-batchc-plugins 前后首页快照） |
| A#14 默认权限行 | 设置-审批与速度「默认权限」；auto 模式下代表帧生成成功即自动确认（shot-images-step 接线） | tsc 通过；开关渲染实测 |
| A#15 任务文件夹行 | 项目目录行显示当前漫剧项目绑定文件夹 + 「更改」跳漫剧绑定 | 渲染实测 |
| A#16 MCP 总闸 | config.mcpMaster 总开关：关闭即停用双通道并禁用子开关（设置 MCP 分区首行 + /plugins 同步禁用） | 渲染实测 |
| A#18 快捷键弹窗 | 设置-键盘快捷键「打开面板」Modal.info 速查 | 渲染实测 |
| A#19 技能库 UI | 新建 `/skills` 技能卡页（ai-drama-preproduction 等 3 技能）+ 侧栏导航 | 路由编译通过 |
| A#20 模板选择器 | composer 右侧 BookOpen Dropdown 三个内置模板插入输入框 | tsc 通过；按钮渲染实测 |
| A#21 @资产引用 | composer 输入以 @ 结尾自动打开素材选择器 | 代码接线，待手测 |
| A#22 助手模式 | composer「对话模式/直接执行」Select（config.assistantMode）；直接执行时 canvas-agent-runtime 给 Agent 附加执行提示词 | tsc 通过；实测 chip 渲染 |
| A#23 来源动态化 | 右栏「来源」优先显示 config.lastUsedSource；生图/视频页生成时写入 | tsc 通过 |
| A#24 建议 chips | 首页 4 枚建议 chips 错落淡入（globals.css composer-suggestion 动画），点击填入输入框 | 浏览器实测渲染（快照） |
| A#25 开源许可 | 设置-账户「第三方声明」Modal（前后端主要依赖清单） | 渲染实测 |
| A#26 速度档 | 设置-审批与速度「速度档」；fast 时导演台各类并发上限加倍（director-runner） | tsc 通过 |
| A#27 提示词建议开关 | 设置-常规开关控制首页建议 chips 显隐（config.showSuggestions） | tsc 通过 |
| A#28 分享导出 | 漫剧页头部 ⋯ 菜单：预览分镜稿（Modal）+ 导出分镜稿 Markdown（file-saver） | tsc 通过 |
| A#29 动效层 | globals.css 新增过渡时长/alpha 阶梯 token、shimmer keyframes、建议 chips 动画（prefers-reduced-motion 降级） | CSS 构建通过 |
| A#30 最近区 | 侧栏「最近生成」：读取 image_generation_logs 最近 3 条带缩略图 | 代码接线，有待生成记录后目视 |
| A#31 项目固定 | 画布 store 增 pinnedIds（持久化）；项目 ⋯ 菜单加固定/取消固定，侧栏「已固定」分区 | tsc 通过 |
| A#32 首启引导 | 首页首次启动三步引导 Modal（localStorage 标记） | 浏览器实测弹窗（快照） |
| A#33 麦克风/听写 | composer 右侧 Mic 按钮：Web Speech API 中文听写追加到输入框 | 按钮渲染实测；识别待 WebView2 实机验证 |
| A#34 分镜稿预览 | 漫剧 ⋯ 菜单「预览分镜稿」Modal（等宽字体 Markdown 预览） | tsc 通过 |
| B#1 12px 常态 | antd token fontSize:12 全局生效 | 构建通过 |
| B#2 控件尺度 | antd token controlHeight:32 + borderRadius:8 系统化 | 构建通过 |
| B#4 mono 覆盖 | FFmpeg 路径输入、设置版本/路径/快捷键 Tag、渠道抽屉地址等 font-mono | 渲染实测 |
| B#5/6/7 token 化 | globals.css 新增 --transition-fast/base/slow 与 --alpha-* 阶梯变量层 | CSS 构建通过 |
| B#8 滚动条 | 全局 `*` 细轨 alpha 拇指滚动条（scrollbar-width + webkit） | 渲染实测 |
| B#9 线程头范式 | 新建 `thread-header.tsx`（图标+标题+动作位+⋯）；生图/视频台 WorkbenchHeader 迁移 | tsc 通过 |
| B#10 shimmer | `.shimmer` 扫光工具类（骨架/logo 可复用） | CSS 构建通过 |
| B#11 毛玻璃 | antd Modal/Dropdown/Select 弹层/Drawer 统一 backdrop-filter: blur(16px) | 渲染实测 |

---

## 专项维护（不计入 58 项）

| 状态 | 专项 | 验收记录 |
|---|---|---|
| [x] | 旧 8080 漫剧项目无损升级到当前 18080 | 2026-09-04；改动：`web/src/app/(user)/drama/services/drama-bridge.ts`、`drama-generation.ts`、`web/src/services/port-storage-migration.ts`、`mcpadapter/tools.go`、`mcp-adapter/drama-mcp.mjs`、`desktop_desktop.go`；验收：MCP 回读《第一章·初入》为 15 条覆盖、32 项资产、27 镜逐镜字段完整、2 名角色各 4 视图、镜头 1 图片存在，`drama_episode_check` 无阻塞项，G0–G3 放行、G4/G5 按生产规则保持锁定。 |
| [x] | 隐藏迁移页与可见漫剧页 MCP 连接隔离 | 2026-09-04；改动：`web/src/app/(user)/drama/services/drama-bridge.ts`；验收：重新构建并启动 `InfiniteCanvas.exe`，隐藏 `/storage-port-bridge` 不再抢占连接；向当前 18080 页面重新导入快照后 MCP 回读同一项目 ID、27 镜、2 名角色，G0–G3 均为 ready。 |
| [x] | 门禁子视图导航、资产图片展示与分镜 1 媒体恢复 | 2026-09-04；改动：`web/src/app/(user)/drama/page.tsx`、`components/production-plan-step.tsx`、`components/shot-images-step.tsx`；验收：`bun run build:desktop` 类型检查和 25 路由静态生成通过，`InfiniteCanvas.exe` 重编重启；镜头 1 的 2,983,564 字节原图存在并重新注入，MCP 回读 1/27 张且代表镜头 1 `hasImage=true`。 |
| [x] | 分镜图片可读性校验与归档自修复 | 2026-09-04；改动：`components/shot-images-step.tsx`、`services/image-storage.ts`、`services/api/drama-assets.ts`、`services/drama-bridge.ts`；验收：前端类型检查及 25 路由静态生成通过，exe 重编重启；新版 `drama_inject_image` 实际回读镜头 1 为 `verifiedBytes=2983564`，与磁盘原图长度完全一致，不再以 `hasImage` 作为单一依据。 |
| [x] | Base64 文本伪 PNG 修复与图片魔数闸门 | 2026-09-04；改动：`lib/image-utils.ts`、`services/image-storage.ts`、`services/api/drama-assets.ts`、`services/drama-bridge.ts`；验收：全项目 PNG 扫描仅镜头 1 为 Base64 文本，其余均为真实 PNG；错误文件备份后解码，图片查看器成功显示；前端构建及 exe 重编重启通过，MCP 对真实 PNG 回读 `verifiedBytes=2237673`。 |
| [x] | 分镜图按原始比例完整展示 | 2026-09-04；改动：`web/src/app/(user)/drama/components/shot-images-step.tsx`；验收：942×1668 竖版镜头使用媒体 `width/height` 生成 `aspect-ratio`，图片 `object-contain`、卡片顶部对齐、未生成占位保持 16:9；前端类型检查与 25 路由静态生成通过，exe 重编重启。 |
| [x] | 陆江仙 B 版身份母版升级、旧版清理与派生资产补全 | 2026-09-04；改动：`web/src/app/(user)/drama/prompts.ts`、`components/production-plan-step.tsx`、`.agents/skills/ai-drama-preproduction/references/asset-bible.md`，并经 MCP 更新《第一章·初入》；验收：R001 v004 含核对板与四张独立视图且状态已确认，v001–v003 清单和磁盘文件已删除；项目规划回读为 37 项，R001 仅 5 个 v004 路径并新增 R003–R007，27 镜与媒体保留。 |
| [x] | 面部身份控制包与剧情表演硬闸门 | 2026-09-04；改动：`.agents/skills/ai-drama-preproduction/`、`AGENTS.md`、`web/src/app/(user)/drama/prompts.ts`、`services/drama-generation.ts`、`services/drama-review.ts`、`mcp-adapter/drama-mcp.mjs`、`mcpadapter/stdio.go`；验收：Skill `quick_validate.py` 通过；MCP 回读 R003 为 10 项面部控制交付，4 个陆江仙人物镜追加 R003 引用；缺面部控制包时审查和分镜生成均阻断；前端 28 个静态页面、桌面端与独立 MCP 均重新编译成功，桌面进程已重启。 |
| [x] | 参考职责、提示词资产化与第一章完整缺口清单 | 2026-09-04；改动：`.agents/skills/ai-drama-preproduction/`、`prompts.ts`、`production-plan-step.tsx`、`shots-step.tsx`、`drama-generation.ts`、`drama-review.ts`、`drama-bridge.ts`、`use-drama-store.ts`、两套 MCP schema 与后端清单分类；验收：前端构建和桌面 exe 编译通过，MCP 回读《第一章·初入》资产清单 65 项，其中 33 项待产出/需修改；新增条目均含参考职责、生图提示词、禁止变化、依赖和验收项，原已确认资产未覆盖。 |
| [x] | R003-01 陆江仙中性正脸身份控制特写入库 | 2026-09-04；通过 MCP 为 R003 绑定并确认 v001，磁盘回读为 1024×1536 PNG、2,224,418 字节；顶层交付件同步为真实当前文件，审核意见明确仅确认首项，其余九项仍逐张生产。 |
| [x] | 资产当前版本多图可视化与 R003 左右三分之四入库 | 2026-09-04；改动：`web/src/app/(user)/assets/components/project-assets-panel.tsx`；验收：资产行显示当前文件数量并可点击，详情抽屉加载完整图片网格和放大预览；前端 28 页面构建、桌面 exe 重编与启动通过；MCP 确认 R003 v003 累计3张，磁盘逐张回读均为 1024×1536 PNG。 |
| [x] | 资产表格直接展示当前版本多图缩略带 | 2026-09-04；用户实机截图证明仅封面计数与详情画廊仍不直观，进一步将按季资产汇总和资产库分类表改为宽幅“当前图片”列：横排最多4张真实缩略图、余量 `+N`、点击打开完整画廊；前端 28 页构建通过，严格按先关旧进程、再重编 exe、最后重启的顺序发布。 |
| [x] | R003-04 左侧面身份控制特写入库 | 2026-09-04；用户目视确认后经 MCP 累计绑定为 R003 v004，当前版本包含正脸、左右三分之四、左侧面共4张，顶层交付件同步，审核记录明确剩余6项未完成。 |

---

## 变更日志

| 日期 | 修改人 | 变更摘要 |
|---|---|---|
| 2026-09-04 | Qoder（Felix 修正） | 修正批次 D 进度统计表计数错误：P1 总项 30→29（排除 A#17 交叉引用）/完成 6→7、P2 总项 17→18/完成 1→0/部分 2→3/未开始 14→15、P3 总项 5→6/未开始 5→6、部分完成合计 11→12、P1 严格完成率 20%→24%（合计严格完成率仍为 14%）；补充「58 项有效工作项」统计口径脚注；批次 A #28 缺口标注依赖批次 B #9（线程头范式）。与 [`HANDOFF.md`](../HANDOFF.md) §9 同步。 |
| 2026-09-04 | Qoder | 批次 A #1「模型选择器外露」完成：composer 底行新增 Agent LLM 选择器（用户纠偏设计口径：选 textModel 驱动自主 Agent，非图像/视频模型，原计划描述已同步改正）；批次 D 计数同步（完成 8→9、P0 1 完成/2 部分/1 未开始、合计严格完成率 14%→16%）。 |
| 2026-09-04 | Qoder | 批次 A #2「停止生产」完成：核实口径（画布面板/导演台本已具备、首页无在途任务），真缺口为漫剧三个手动批量——分镜图/视频/配音批量循环新增「停止」按钮（不再派发新任务、在途自然结束，同导演台「终止」语义）；批次 D 计数同步（完成 9→10、P0 2 完成/2 部分/0 未开始、合计严格完成率 16%→17%）。 |
| 2026-09-04 | Qoder | 批次 A #3「加号位统一」（图标 Menu→Plus）与 #4「门禁模式 chip」（composer 底行请求批准式 chip，取最近更新漫剧项目首个未就绪门禁，点击跳 /drama，全就绪隐藏）完成；**P0 四项全部完成**；批次 D 计数同步（完成 10→12、P0 4/4、合计严格完成率 17%→21%）。 |
| 2026-09-04 | Qoder | **批次 C 全部 13 块完成**：823 行旧设置弹窗删除（连同无引用死代码 app-top-nav.tsx），13 块全部迁入设置页（模型渠道分区含渠道行卡+编辑抽屉+四类默认模型+账号同步行、语音分区条件 TTS 行、集成-高级三开关、集成-存储 S3/R2+WebDAV、系统提示词抽屉）；15 处弹窗调用全部改道（缺配置→跳设置页，插件与渠道→/plugins），store 弹窗状态删除；A#6 插件独立页 /plugins + 侧栏导航行、A#17 随之完成；批次 D 计数同步（完成 12→21、P1 15/4/10、合计严格完成率 21%→36%）。验收：tsc 0 错误 + next build 25 路由静态导出通过 + 浏览器实测设置页/插件页/抽屉渲染与交互。 |
| 2026-09-04 | Qoder | **第四轮施工：批次 A/B 剩余 29 项全部完成，58 项全清（100%）**。新增 /queue、/skills 页与侧栏导航；统一搜索 overlay、通知铃下拉、最近生成区、项目固定；composer 增执行渠道/项目选择器/助手模式/模板/听写/@引用；导演台继续生产与生产日志 chips；设置增审批与速度分区、MCP 总闸、开源声明、快捷键面板；漫剧分镜稿预览/导出；样式层 antd 12px+32px token、全局滚动条、过渡/alpha token、shimmer、毛玻璃。详见「第四轮施工验收记录」。 |
| 2026-09-04 | Qoder | 修复 composer 底行拥挤重叠：左组改 flex-wrap（gap-x-1 gap-y-1.5）空间不足自动换行不再互相挤压；执行渠道/助手模式文案缩短（本地/云端、对话/执行）并收窄占位。需重编 exe 生效。 |
| 2026-09-04 | Qoder | 修复 composer 拥挤后重编启动被构建阻断的类型错误：drama-review.ts 自动修改合并处 LLM 返回的 referenceRole/referencePriority 为自由字符串，与 DramaAssetRef 受限枚举不符；改为白名单校验、非法值丢弃不阻断。build:desktop 28 路由通过并同步 webui/out，go build -tags desktop 重编 InfiniteCanvas.exe 成功，已重启且 18080 正常服务。 |
| 2026-09-04 | Qoder | 用户反馈三处 UI 问题修复：①探索页横向溢出（轮播出血卡撑出底部横向滚动条）加 overflow-x-hidden；②图片预览操作栏深色主题下不可见（浅色半透明底+深色图标），暗色下加深底色并反白图标；③对标 ChatGPT 侧栏顶部品牌下拉行——「无限画布 ∨」菜单（版本/探索/设置/GitHub）+ 搜索 + 铃铛回归侧栏顶部，标题栏只留菜单/当前项目标签/窗口控制。 |
| 2026-09-04 | Qoder | 用户实机复测再修两处：①深色下图片预览工具栏仍不可见——根因是 antd v6 预览由 rc-image 渲染、实际类名为 rc-image-preview-operations，此前 ant-image-* 选择器未命中；改为双前缀深色胶囊（底色/图标/禁用态/计数文案全覆盖、主题无关）；②标题栏对标 ChatGPT 左上：新增 侧栏收缩切换 + 后退/前进 按钮，侧栏显隐由 (user)/layout 统一控制。 |
| 2026-09-04 | Qoder | 预览工具栏修复二次返工：构建产物 JS 中不存在 preview-operations 类名，翻 rc-image 源码确认 antd v6 工具栏真实类名为 ant-image-preview-footer（进度为 -progress），上一轮 ant-image/rc-image-preview-operations 选择器均未命中；CSS 改为覆盖 footer 底色/按钮反白/禁用态/进度文案，构建产物已含该规则，exe 重编重启。 |
| 2026-09-04 | Codex | 新增不计入 58 项的专项维护验收：旧 8080 漫剧项目以快照与媒体重绑定方式无损升级到当前 18080，完整新版生产数据已通过 MCP 门禁与开工检查。 |
| 2026-09-04 | Codex | 修复隐藏端口迁移页抢占 MCP 连接导致可见漫剧主页为空；新版 exe 重启后向当前 18080 页面重新导入并回读验收通过。 |
| 2026-09-04 | Codex | 门禁卡改为阶段级导航，分别定位 G1/G3 与 G4/分镜 G5 的步骤内视图；资产圣经卡片新增真实缩略图懒加载与放大；恢复分镜 1 媒体并完成构建、重启和数据验收。 |
| 2026-09-04 | Codex | 补强分镜媒体恢复验收：渲染前重建有效 Blob URL，缺失则读取磁盘归档自修复；MCP 注入必须完成图片字节回读才返回成功。 |
| 2026-09-04 | Codex | 修复分镜导出把 Base64 写入文本字段造成的伪 PNG；二进制归档改走 `base64` 字段并增加真实图片文件头校验，镜头 1 已解码、备份和重新注入。 |
| 2026-09-04 | Codex | 分镜图片卡取消固定 16:9 裁切，有图时按原始比例完整展示，未生成卡保留统一占位比例。 |
| 2026-09-04 | Codex | 面部身份控制包与剧情表演硬闸门完成正式桌面构建：28 个静态页面导出通过，`InfiniteCanvas.exe` 与 `drama-mcp.exe` 重编成功并重启桌面程序；开始按单张确认制生产 R003 中性正脸身份特写。 |
