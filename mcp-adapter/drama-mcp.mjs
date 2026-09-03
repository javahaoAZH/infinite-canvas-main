#!/usr/bin/env node
// 桌面 MCP 客户端 ↔ AI 漫剧软件适配器（Blender MCP 模式）：
//   Qoder/ChatGPT --STDIO--> 本适配器 --WebSocket(127.0.0.1:port)--> 漫剧页面（web/src/app/(user)/drama/services/drama-bridge.ts）
// 由桌面 MCP 客户端拉起：node drama-mcp.mjs --token <令牌> [--port 9801]
// 协议：页面连上后首条消息必须是 {"type":"hello","token":"..."}；令牌匹配回 {"type":"ready"}，不匹配以 4401 关闭；
//   工具调用 {"type":"call","id":"...","tool":"...","args":{...}} → {"type":"result","id":"...","ok":true,"data":{...} | "ok":false,"error":"中文错误"}，单次调用 120 秒超时。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WebSocketServer } from "ws";

const argv = process.argv.slice(2);
function readArg(name) {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : "";
}
const token = readArg("token");
const port = Number(readArg("port")) || 9801;
if (!token) {
    process.stderr.write("缺少 --token 参数：请在桌面 MCP 注册配置中传入漫剧页面的通道令牌\n");
    process.exit(1);
}

const CALL_TIMEOUT_MS = 120_000;
const PAGE_NOT_CONNECTED = "无限画布页面未连接：请保持软件开启并启用对应的桌面 MCP 通道";

// 已通过令牌验证的漫剧页面连接（同一时间只保留最新一条，新页面接入会顶掉旧页面）
let page = null;
// 进行中的工具调用：call id -> { resolve, reject, timer }
const pending = new Map();

const wss = new WebSocketServer({ host: "127.0.0.1", port });
wss.on("error", (error) => {
    process.stderr.write(`适配器 WebSocket 启动失败（127.0.0.1:${port}）：${error.message}\n`);
    process.exit(1);
});
wss.on("connection", (socket) => {
    let authed = false;
    socket.on("message", (raw) => {
        let message;
        try {
            message = JSON.parse(String(raw));
        } catch {
            return;
        }
        if (!authed) {
            if (message && message.type === "hello" && message.token === token) {
                authed = true;
                if (page && page !== socket && page.readyState === page.OPEN) page.close(4400, "已有新的页面连接");
                page = socket;
                socket.send(JSON.stringify({ type: "ready" }));
            } else {
                socket.close(4401, "令牌不匹配");
            }
            return;
        }
        if (message && message.type === "result" && typeof message.id === "string" && pending.has(message.id)) {
            const entry = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(entry.timer);
            if (message.ok) entry.resolve(message.data ?? null);
            else entry.reject(new Error(String(message.error || "工具执行失败")));
        }
    });
    socket.on("close", () => {
        if (page !== socket) return;
        page = null;
        for (const [id, entry] of pending) {
            pending.delete(id);
            clearTimeout(entry.timer);
            entry.reject(new Error("漫剧页面连接已断开"));
        }
    });
});

// 工具调用转发到页面并等待结果（120 秒超时；页面未连接直接报中文错误）
function callPage(tool, args) {
    return new Promise((resolve, reject) => {
        if (!page || page.readyState !== page.OPEN) {
            reject(new Error(PAGE_NOT_CONNECTED));
            return;
        }
        const id = randomUUID();
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`工具调用超时（${CALL_TIMEOUT_MS / 1000} 秒）：${tool}`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        try {
            page.send(JSON.stringify({ type: "call", id, tool, args: args || {} }));
        } catch {
            pending.delete(id);
            clearTimeout(timer);
            reject(new Error(PAGE_NOT_CONNECTED));
        }
    });
}

// 「AI 检测 → 修复 → 回写」闭环提示（写入 set_script / apply_shots 的工具描述）
const LOOP_HINT = "推荐闭环：先 drama_get_skills 获取写法规范 → 产出内容 → drama_review_shots 检测 → 对不合格 findings 用 drama_update_shots 回写修复 → 复检通过后 drama_start_production。";

// 图片扩展名 → MIME（注入工具把本地文件转 base64 dataUrl 后交给页面）
const IMAGE_MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// 15 个 MCP 工具：名称 / 入参 / 行为与页面侧 BRIDGE_TOOLS 处理器一一对应
const TOOLS = {
    drama_list_projects: {
        description: "列出漫剧软件中的全部项目（按更新时间倒序）：id、标题、当前步骤（0-5 对应剧本/分镜/角色四视图/分镜图/图生视频/配音成片）、分镜数、角色数。",
    },
    drama_get_project: {
        description: "读取项目详情：剧本全文、题材/场景/画风（含中文标签与自定义画风描述）、全部分镜（id、序号、画面描述、对白、旁白、秒数、图片/视频/配音是否已生成）、角色（名称、描述、已分配视图数）、最近成片地址。不传 projectId 时取当前活跃项目。",
        schema: {
            projectId: z.string().optional().describe("项目 id，缺省取当前活跃项目"),
        },
    },
    drama_create_project: {
        description: "新建漫剧项目并设为活跃项目（软件当前不在 /drama 页面时会自动跳转过去，用户可实时看到后续逐条写入）。可选 title 为项目名。",
        schema: {
            title: z.string().optional().describe("项目名称"),
        },
    },
    drama_set_options: {
        description: "设置生成选项（字段都可选）：题材 genre、场景 scene、画风 artStyle（取 custom 时配合 customArtStyle 传可观察写法的自定义画风描述）。合法 id 以 drama_get_skills 返回目录为准，非法 id 报错并列出全部合法值。",
        schema: {
            genre: z.string().optional().describe("题材 id，空字符串表示不指定"),
            scene: z.string().optional().describe("场景/世界观预设 id，空字符串表示不指定"),
            artStyle: z.string().optional().describe("画风 id，custom 表示自定义"),
            customArtStyle: z.string().optional().describe("自定义画风描述（可观察写法）"),
        },
    },
    drama_set_script: {
        description: "写入剧本文本（script 必填非空，可选 title 同步项目名）。只写原文不做结构化，分镜需另行 drama_apply_shots 直写。推荐闭环：" + LOOP_HINT,
        schema: {
            projectId: z.string().optional().describe("项目 id，缺省取当前活跃项目"),
            script: z.string().min(1).describe("剧本文本"),
            title: z.string().optional().describe("项目名称（传入时同步更新）"),
        },
    },
    drama_apply_shots: {
        description: "结构化直写分镜与角色（Qoder 大脑入口，不经文本模型）：整包替换当前活跃项目的全部分镜并清空已生成的媒体表；同名角色沿用已有立绘与视图分配。分镜与角色写法规范先看 drama_get_skills。推荐闭环：" + LOOP_HINT,
        schema: {
            shots: z
                .array(
                    z.object({
                        description: z.string().min(1).describe("画面描述：只写镜头起点时刻可见的物理事实"),
                        dialogue: z.string().optional().describe("对白，可为空字符串"),
                        narration: z.string().optional().describe("旁白（画外音），可为空字符串"),
                        seconds: z.number().int().min(1).max(30).optional().describe("本镜时长（秒）1-30，缺省 5"),
                        shotSize: z.string().optional().describe("可选景别：远景/全景/中景/中近景/近景/特写（自由描述亦可，缺省不指定）"),
                        camera: z.string().optional().describe("可选运镜：固定镜头/推镜头/拉镜头/横移/环绕/手持跟拍/升/降（自由描述亦可，缺省不指定）"),
                        transition: z.string().optional().describe("可选转场：硬切/叠化/匹配剪辑/白闪/黑场（自由描述亦可，缺省不指定）"),
                        action: z.string().optional().describe("动作：角色在本镜内可见的肢体动作与表情变化（小说心理描写必须外化为可见动作后写在这里）"),
                        emotion: z.string().optional().describe("情绪：本镜人物情绪或画面情绪基调（如震惊/压抑/释然/惊叹），进提示词驱动光线与构图"),
                        characters: z.array(z.string()).optional().describe("本镜出场角色名数组：出图时按此精确注入角色一致性锚点"),
                        imagePrompt: z.string().optional().describe("出图提示词：非空时覆盖分镜图提示词的内容段（画风基底与一致性约束仍由项目级统一拼接）"),
                        videoPrompt: z.string().optional().describe("图生视频提示词：非空时覆盖视频提示词的内容段（运镜、转场、时长与画质约束仍由项目级统一拼接）"),
                    }),
                )
                .min(1)
                .describe("全量分镜列表（整包替换）"),
            characters: z
                .array(
                    z.object({
                        name: z.string().min(1).describe("角色名"),
                        description: z.string().min(1).describe("可观察外貌描述（立绘提示词基底）"),
                    }),
                )
                .optional()
                .describe("角色表，同名角色沿用已有立绘与视图分配"),
        },
    },
    drama_update_shots: {
        description: "按分镜 id 部分更新分镜（「AI 检测 → 修复 → 回写」闭环专用）：只覆盖传入字段（秒数钳 1-30），不动未提及分镜、不清空媒体表、保留已有媒体关联；id 不存在时报错列出无效 id。分镜 id 从 drama_get_project 或 drama_apply_shots 返回获取，drama_review_shots 的 findings 带 index 定位与可解析时的 shotId。",
        schema: {
            shots: z
                .array(
                    z.object({
                        id: z.string().min(1).describe("分镜 id"),
                        description: z.string().optional().describe("新的画面描述"),
                        dialogue: z.string().optional().describe("新的对白"),
                        narration: z.string().optional().describe("新的旁白"),
                        seconds: z.number().int().min(1).max(30).optional().describe("新的时长（秒）"),
                        shotSize: z.string().optional().describe("新的景别（空串清除）"),
                        camera: z.string().optional().describe("新的运镜（空串清除）"),
                        transition: z.string().optional().describe("新的转场（空串清除）"),
                        action: z.string().optional().describe("新的动作（空串清除）"),
                        emotion: z.string().optional().describe("新的情绪（空串清除）"),
                        characters: z.array(z.string()).optional().describe("新的出场角色名数组"),
                        imagePrompt: z.string().optional().describe("新的出图提示词（空串清除）"),
                        videoPrompt: z.string().optional().describe("新的图生视频提示词（空串清除）"),
                    }),
                )
                .min(1)
                .describe("要更新的分镜列表（只覆盖传入字段）"),
        },
    },
    drama_get_skills: {
        description: "获取漫剧软件的技能规范目录（单一事实来源）：题材卡 genres（18 张，含要点与示例）、场景预设 scenes、画风 artStyles、镜头语言词表 frameLexicon、分镜写法规范 shotRules、角色描述规范 characterRules。创作任何剧本/分镜前先调用本工具。",
    },
    drama_review_shots: {
        description: "用软件自带审查器检测当前活跃项目的分镜：机械检查 + 语义审查（语义模型失败自动降级仅机械结果，degraded=true）。整体结论 verdict 为 pass/revise/rework；findings 每条含 level（blocker/major/minor/note）、location（如「分镜 3」）、message、suggestion，可解析出镜号时附 shotId。审查只检测不改稿，修复用 drama_update_shots 回写。推荐闭环：" + LOOP_HINT,
    },
    drama_start_production: {
        description: "启动当前活跃项目的自动生产流水线（立绘 → 分镜图 → 视频 ∥ 配音）：需项目已有分镜，其他项目生产中会报错。可选 options：characterCandidates（1 或 4 张立绘候选）、autoAssignView、includeAudio。返回任务数与成本预估。建议先用 drama_review_shots 检测并修复分镜后再启动。",
        schema: {
            options: z
                .object({
                    characterCandidates: z.union([z.literal(1), z.literal(4)]).optional().describe("角色立绘候选张数，1 或 4，缺省 4"),
                    autoAssignView: z.boolean().optional().describe("是否自动把首选立绘分配到 front 视图，缺省 true"),
                    includeAudio: z.boolean().optional().describe("是否包含配音任务，缺省 true"),
                })
                .optional()
                .describe("生产选项"),
        },
    },
    drama_get_production_status: {
        description: "查询当前活跃项目的自动生产状态：无计划时 status=none；有计划时返回 status（draft/confirmed/running/paused/done/aborted）、progress（done/total/failed/skipped）与任务明细（id、kind、label、status、attempts、error）。",
    },
    drama_control_production: {
        description: "控制当前活跃项目的自动生产：pause（暂停）/ resume（继续）/ abort（终止），或 retry / skip（需 taskId；retry 仅限失败任务，skip 支持失败或待执行任务，处理后自动按需拉起执行器）。",
        schema: {
            action: z.enum(["pause", "resume", "abort", "retry", "skip"]).describe("控制动作"),
            taskId: z.string().optional().describe("retry / skip 时的任务 id（drama_get_production_status 返回）"),
        },
    },
    drama_start_render: {
        description: "一键成片：把当前活跃项目已生成的分镜视频与配音组装为成片任务（需登录账号，且至少一个分镜视频已生成）。返回 taskId，用 drama_get_render_status 轮询直到完成。",
    },
    drama_get_render_status: {
        description: "查询成片任务状态（taskId 必填，来自 drama_start_render 返回）：status（queued/preparing/rendering/completed/failed）、progress，完成后附成片 url（http/https 地址）。",
        schema: {
            taskId: z.string().min(1).describe("成片任务 id"),
        },
    },
    drama_inject_image: {
        description:
            "把本地图片（Qoder ImageGen 产物）注入到漫剧项目：target=character 注入为角色立绘候选（characterId 必填，可用 characterName 按名匹配；autoAssignView 缺省 true 自动分配到首个空视图，viewKey 可指定覆盖 front/side/back/threeQuarter 某一视图，purge=true 先清空旧候选与旧视图再写入以彻底替换）；target=shotImage 注入为分镜图（shotId 必填，取自 drama_get_project，本来就是覆盖式）。推荐工作流：drama_apply_shots 写入分镜 → 逐角色/逐镜生成图片并注入 → drama_start_production 只补跑视频与配音（已有图片自动跳过）。",
        schema: {
            file: z.string().min(1).describe("本地图片绝对路径（png / jpg / jpeg / webp）"),
            target: z.enum(["character", "shotImage"]).describe("注入目标：character=角色立绘候选，shotImage=分镜图"),
            characterId: z.string().optional().describe("目标角色 id（target=character 时，与 characterName 二选一）"),
            characterName: z.string().optional().describe("目标角色名（target=character 时，与 characterId 二选一，按名匹配）"),
            shotId: z.string().optional().describe("目标分镜 id（target=shotImage 时必填，取自 drama_get_project）"),
            autoAssignView: z.boolean().optional().describe("注入立绘后自动分配到首个空视图，缺省 true"),
            viewKey: z.enum(["front", "side", "back", "threeQuarter"]).optional().describe("指定覆盖某个视图（替换旧立绘）；不传则走 autoAssignView 只填首个空视图"),
            purge: z.boolean().optional().describe("target=character 时先清空该角色旧候选与旧视图再写入新图（彻底替换，不留旧图堆积）"),
        },
        handler: async (args) => {
            const filePath = String(args.file || "");
            if (!filePath) throw new Error("file 不能为空");
            const mime = IMAGE_MIME_BY_EXT[extname(filePath).toLowerCase()];
            if (!mime) throw new Error("仅支持图片文件：.png / .jpg / .jpeg / .webp");
            let buffer;
            try {
                buffer = await readFile(filePath);
            } catch {
                throw new Error(`读取图片失败：${filePath}，请确认路径存在`);
            }
            return callPage("drama_inject_image", { ...args, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` });
        },
    },
    drama_asset_list: {
        description:
            "查询项目资产清单（D 盘项目文件夹 资产清单.json 为唯一事实源，三区分离：store 工作区/清单发布区/history 历史区）：可按分类（角色/场景/道具/生物/特效/图形）、状态（待产出/制作中/待审核/需修改/已确认/已归档）、优先级（P0-P3）过滤；返回条目含版本、审核记录、锁定段、依赖、用于；并返回分集分镜（分集：季→集→镜头，含所需资产/推荐模型/产物）与季集结构。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            category: z.string().optional().describe("分类过滤"),
            status: z.string().optional().describe("状态过滤"),
            priority: z.string().optional().describe("优先级过滤"),
        },
    },
    drama_asset_upsert: {
        description:
            "登记/更新清单条目（按编号合并，新条目自动编号）：分类（六类之一）与名称必填；优先级 P0-P3；依据（如 第2章·卡§9）；锁定段（角色卡生图提示词原文，一字不改）；规格；依赖（条目编号数组）；用于（集.镜数组，如 ep01.镜头3）。状态走六态机，不要直接跳已确认。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            entry: z.record(z.string(), z.any()).describe("条目对象（中文字段名：编号/分类/名称/规格/优先级/状态/依据/锁定段/依赖/用于）"),
        },
    },
    drama_asset_bind: {
        description:
            "把本地产物绑定到清单条目成为新版本 vNNN（旧版文件自动移入 history/，条目状态→待审核）；files 为本地绝对路径（适配器转 base64 转发）；source 可选复跑参数 JSON 文本（提示词全文/尺寸/种子/渠道）。绑定后等人工审核：drama_asset_confirm 或资产页。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            id: z.string().min(1).describe("条目编号"),
            files: z.array(z.string().min(1)).min(1).describe("产物本地绝对路径"),
            note: z.string().optional().describe("版本备注"),
            source: z.string().optional().describe("复跑参数 JSON 文本"),
        },
        handler: async (args) => {
            const paths = Array.isArray(args.files) ? args.files.map(String) : [];
            const payloads = [];
            for (const filePath of paths) {
                const buffer = await readFile(filePath).catch(() => null);
                if (!buffer) throw new Error(`读取产物失败：${filePath}`);
                const mime = IMAGE_MIME_BY_EXT[extname(filePath).toLowerCase()] || "application/octet-stream";
                payloads.push({ name: filePath.split(/[\\/]/).pop(), dataUrl: `data:${mime};base64,${buffer.toString("base64")}` });
            }
            return callPage("drama_asset_bind", { ...args, files: payloads });
        },
    },
    drama_asset_confirm: {
        description: "批量审核确认清单条目（结论=已确认，审核轮次留档，审核人=MCP）；需修改请用 drama_asset_upsert 把状态改回待产出并在审核意见说明原因。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            ids: z.array(z.string().min(1)).min(1).describe("条目编号数组"),
            comment: z.string().optional().describe("审核意见"),
        },
    },
    drama_episode_check: {
        description: "开工前检查：返回该集引用资产的缺产出/未确认/依赖阻塞清单与是否可开工；不可开工时先补齐并确认资产（drama_asset_upsert/bind/confirm）。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            episode: z.string().min(1).describe("集号，如 ep01"),
        },
    },
    drama_episode_export: {
        description: "把浏览器活跃项目的分镜导出为 分集/<集>/分镜稿.md 九字段表，并把该集分镜图归档到 分集/<集>/shots/（返回归档数）；同时把分镜沉淀进清单 分集（季→集→镜头），供界面「按季投产」视图与后续生产读取。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            episode: z.string().min(1).describe("集号，如 ep01"),
        },
    },
};

const READ_ONLY_TOOLS = new Set(["drama_list_projects", "drama_get_project", "drama_get_skills", "drama_review_shots", "drama_get_production_status", "drama_get_render_status", "drama_asset_list", "drama_episode_check"]);
const DESTRUCTIVE_TOOLS = new Set(["drama_apply_shots", "drama_control_production", "drama_api_request", "drama_inject_image"]);
const OPEN_WORLD_TOOLS = new Set(["drama_start_production", "drama_control_production", "drama_start_render", "drama_api_request"]);
const server = new McpServer(
    { name: "drama-bridge", version: "0.1.0" },
    { instructions: "此服务器控制用户当前打开的无限画布漫剧工作区。修改项目前先读取项目并确认 projectId；整包替换分镜前先告知用户会清空已有媒体。启动批量生产或成片会调用外部模型并可能产生费用，应先确认范围。优先遵循 drama_get_skills 返回的制作规范。" },
);
for (const [name, tool] of Object.entries(TOOLS)) {
    server.registerTool(
        name,
        {
            description: tool.description,
            ...(tool.schema ? { inputSchema: tool.schema } : {}),
            annotations: { readOnlyHint: READ_ONLY_TOOLS.has(name), destructiveHint: DESTRUCTIVE_TOOLS.has(name), openWorldHint: OPEN_WORLD_TOOLS.has(name) },
        },
        async (args) => {
            try {
                // 带 handler 的工具（如图片注入）在适配器侧先预处理再转发页面，其余直接透传
                const data = tool.handler ? await tool.handler(args) : await callPage(name, args);
                return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
            } catch (error) {
                return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
            }
        },
    );
}

await server.connect(new StdioServerTransport());
process.stderr.write(`drama-mcp 适配器已启动：MCP(STDIO) ↔ WS(127.0.0.1:${port})，等待漫剧页面连接\n`);
