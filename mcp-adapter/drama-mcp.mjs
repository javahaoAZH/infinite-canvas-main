#!/usr/bin/env node
// Qoder ↔ AI 漫剧软件 MCP 适配器（Blender MCP 模式）：
//   Qoder(MCP 客户端) --STDIO--> 本适配器 --WebSocket(127.0.0.1:9801)--> 漫剧页面（web/src/app/(user)/drama/services/drama-bridge.ts）
// 由 Qoder 作为 MCP 服务器拉起：node drama-mcp.mjs --token <令牌> [--port 9801]
// 协议：页面连上后首条消息必须是 {"type":"hello","token":"..."}；令牌匹配回 {"type":"ready"}，不匹配以 4401 关闭；
//   工具调用 {"type":"call","id":"...","tool":"...","args":{...}} → {"type":"result","id":"...","ok":true,"data":{...} | "ok":false,"error":"中文错误"}，单次调用 120 秒超时。
import { randomUUID } from "node:crypto";

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
    process.stderr.write("缺少 --token 参数：请在 Qoder MCP 注册配置中传入漫剧页面的通道令牌\n");
    process.exit(1);
}

const CALL_TIMEOUT_MS = 120_000;
const PAGE_NOT_CONNECTED = "漫剧页面未连接：请打开漫剧页面并开启「Qoder 通道」开关";

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

// 14 个 MCP 工具：名称 / 入参 / 行为与页面侧 BRIDGE_TOOLS 处理器一一对应
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
};

const server = new McpServer({ name: "drama-bridge", version: "0.1.0" });
for (const [name, tool] of Object.entries(TOOLS)) {
    server.registerTool(
        name,
        { description: tool.description, ...(tool.schema ? { inputSchema: tool.schema } : {}) },
        async (args) => {
            try {
                return { content: [{ type: "text", text: JSON.stringify(await callPage(name, args), null, 2) }] };
            } catch (error) {
                return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
            }
        },
    );
}

await server.connect(new StdioServerTransport());
process.stderr.write(`drama-mcp 适配器已启动：MCP(STDIO) ↔ WS(127.0.0.1:${port})，等待漫剧页面连接\n`);
