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
const LOOP_HINT = "强制闭环：先读小说全文并调用 drama_get_skills → 建立原文覆盖台账与全量资产圣经（含角色、场景、道具、特效、风格、声音）→ 每项资产记录参考职责、生图提示词、禁止变化和逐图验收项 → 先确认四视图与面部身份控制包 → 再生产绑定原文情境的表演/动作资产 → 每镜 assetRefs 标注参考职责、主次与精确文件 → 审查和开工检查通过 → 只生成代表帧并人工逐张确认 → 代表视频通过后才批量生产。参考预算优先级：主身份、对应角度/姿态、场景/核心道具、风格/特效；超限先制作布局帧，禁止静默截断。";

// 图片扩展名 → MIME（注入工具把本地文件转 base64 dataUrl 后交给页面）
const IMAGE_MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// MCP 工具：名称 / 入参 / 行为与页面侧 BRIDGE_TOOLS 处理器一一对应
const TOOLS = {
    drama_list_projects: {
        description: "列出漫剧软件中的全部项目（按更新时间倒序）：id、标题、当前步骤（0-5 对应原文拆解/生产规划/资产生产/关键帧与分镜/动态镜头/配音成片）、分镜数、角色数。",
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
    drama_reset_workspace: {
        description: "清空当前生产工作区中的全部漫剧项目、画布项目和“我的素材”（含登录账号同步数据），但保留账号登录态、API Key、模型渠道与主题设置；完成后预置东方志怪·电影级3D国漫画风。不可撤销，必须明确传 confirm=RESET。",
        schema: {
            confirm: z.literal("RESET").describe("强确认文本，必须为 RESET"),
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
    drama_update_characters: {
        description: "按角色 id 或名称局部更新角色描述锚点；保留候选图、四视图、全部分镜与媒体，不用于更换角色身份。适合角色母版修订后安全清除旧武器或旧特效描述。",
        schema: {
            projectId: z.string().optional().describe("项目 id，缺省取当前活跃项目"),
            characters: z.array(z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                description: z.string().min(1),
            })).min(1),
        },
    },
    drama_apply_shots: {
        description: "整包写入可生产分镜：必须同时提交 coverage、assets，以及每镜的原文证据、职责、显式出场角色、起止状态、首帧/动态提示词、qualityCriteria 和 assetRefs；任一缺失或证据无法在小说中定位都会拒绝写入。会替换目标项目全部分镜并清空已有媒体；同名角色保留已生成视图。" + LOOP_HINT,
        schema: {
            projectId: z.string().optional().describe("目标项目 id，缺省取当前活跃项目"),
            episode: z.string().default("ep01").describe("集号，如 ep01"),
            coverage: z.array(z.object({
                quote: z.string().min(1).describe("可在小说中逐字定位的短引文"),
                disposition: z.enum(["画面", "对白", "旁白", "音效", "合并", "暂不采用"]),
                shotNumbers: z.array(z.number().int().min(1)).default([]).describe("承载该信息的镜号；暂不采用时可为空"),
                note: z.string().optional().describe("合并方式或暂不采用原因；暂不采用时必填"),
            })).min(1).describe("小说重要信息的全量去向台账"),
            assets: z.array(z.object({
                key: z.string().min(1).describe("全项目唯一稳定键，后续镜头按此引用"),
                category: z.enum(["角色", "场景", "道具", "生物", "特效", "图形", "声音", "风格"]),
                name: z.string().min(1),
                layer: z.enum(["身份母版", "状态变体", "表演动作", "空间布局", "合成层"]),
                factLevel: z.enum(["原文明确", "原文推断", "改编设计"]),
                sourceEvidence: z.string().min(1).describe("原文短引文；改编设计写必要性说明"),
                specification: z.string().min(1).describe("尺寸、视图、状态与生产规格"),
                lock: z.string().min(1).describe("跨镜逐字复用的可观察锚点"),
                deliverables: z.array(z.string().min(1)).min(1).describe("必须独立交付的视图、表情、姿态或状态图"),
                dependencies: z.array(z.string()).default([]).describe("依赖资产 key"),
                priority: z.enum(["P0", "P1", "P2", "P3"]),
                referenceRole: z.enum(["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]).optional(),
                generationPrompt: z.string().optional(),
                avoidPrompt: z.string().optional(),
                reviewCriteria: z.array(z.string()).optional(),
            })).min(1).describe("从小说逐段拆出的全量资产圣经"),
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
                        characters: z.array(z.string()).describe("本镜出场角色名数组；空镜必须显式传空数组"),
                        imagePrompt: z.string().min(1).describe("出图提示词：只写镜头起点的正向可见事实，画风基底与一致性约束由项目级统一拼接"),
                        videoPrompt: z.string().min(1).describe("图生视频提示词：只写从起始态到结束态的主体/环境运动、运镜与节奏，不写剪辑转场"),
                        sourceEvidence: z.string().min(1).describe("支持本镜的小说原文短引文，必须能在剧本全文中定位"),
                        location: z.string().min(1).describe("具体场景/空间，对应场景资产"),
                        storyTime: z.string().min(1).describe("日夜、闪回或叙事时点"),
                        shotPurpose: z.string().min(1).describe("本镜唯一要传递的叙事或物理变化"),
                        startState: z.string().min(1).describe("镜头起点的姿势、朝向、持物、道具位置与环境状态"),
                        endState: z.string().min(1).describe("镜头终点可核对状态"),
                        continuity: z.string().min(1).describe("必须带入下一镜的连续性状态；首镜写开场基准"),
                        qualityCriteria: z.string().min(1).describe("看图即可逐项核对的身份、资产版本、人体工学、空间、特效和连续性通过条件"),
                        assetRefs: z.array(z.object({
                            key: z.string().min(1).describe("assets 中的稳定 key"),
                            purpose: z.string().min(1).describe("本镜中的具体用途"),
                            variant: z.string().optional().describe("所需表情、姿态、时间态或结构态"),
                            files: z.array(z.string()).optional().describe("多文件资产必须用文件名关键词选中本镜需要的文件"),
                            referenceRole: z.enum(["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]).describe("该参考在本镜中的唯一控制职责"),
                            referencePriority: z.enum(["主参考", "辅助参考"]).describe("主参考优先锁定，辅助参考不得覆盖主参考"),
                        })).min(1).describe("本镜全部可见或参与动作的资产"),
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
        description: "按分镜 id 局部修复分镜与其原文证据、起止状态、连续性和资产引用；不动未提及镜头、不清空媒体。",
        schema: {
            projectId: z.string().optional().describe("目标项目 id，缺省取当前活跃项目"),
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
                        sourceEvidence: z.string().optional().describe("新的原文短引文"),
                        location: z.string().optional().describe("新的具体场景"),
                        storyTime: z.string().optional().describe("新的叙事时点"),
                        shotPurpose: z.string().optional().describe("新的镜头职责"),
                        startState: z.string().optional().describe("新的镜头起始态"),
                        endState: z.string().optional().describe("新的镜头结束态"),
                        continuity: z.string().optional().describe("新的跨镜连续性"),
                        qualityCriteria: z.string().optional().describe("新的可视化质检标准"),
                        assetRefs: z.array(z.object({ key: z.string().min(1), purpose: z.string().min(1), variant: z.string().optional(), files: z.array(z.string()).optional(), referenceRole: z.enum(["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]).optional(), referencePriority: z.enum(["主参考", "辅助参考"]).optional() })).optional().describe("新的全量资产引用；新写入必须标明参考职责与主次"),
                    }),
                )
                .min(1)
                .describe("要更新的分镜列表（只覆盖传入字段）"),
        },
    },
    drama_update_preproduction: {
        description: "安全升级旧项目的项目级前期数据：写入原文覆盖台账与资产圣经，并用现有分镜做完整性校验；保留全部镜头 id、角色四视图、分镜图、视频、配音与关键帧确认。应先用 drama_update_shots 补齐逐镜新增字段。",
        schema: {
            projectId: z.string().optional().describe("目标项目 id，缺省取当前活跃项目"),
            episode: z.string().optional().describe("集号，如 ep01"),
            coverage: z.array(z.object({
                quote: z.string().min(1),
                disposition: z.enum(["画面", "对白", "旁白", "音效", "合并", "暂不采用"]),
                shotNumbers: z.array(z.number().int().min(1)),
                note: z.string().optional(),
            })).min(1),
            assets: z.array(z.object({
                key: z.string().min(1),
                category: z.enum(["角色", "场景", "道具", "生物", "特效", "图形", "声音", "风格"]),
                name: z.string().min(1),
                layer: z.enum(["身份母版", "状态变体", "表演动作", "空间布局", "合成层"]),
                factLevel: z.enum(["原文明确", "原文推断", "改编设计"]),
                sourceEvidence: z.string().min(1),
                specification: z.string().min(1),
                lock: z.string().min(1),
                deliverables: z.array(z.string().min(1)).min(1),
                dependencies: z.array(z.string()),
                priority: z.enum(["P0", "P1", "P2", "P3"]),
                referenceRole: z.enum(["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]).optional(),
                generationPrompt: z.string().optional(),
                avoidPrompt: z.string().optional(),
                reviewCriteria: z.array(z.string()).optional(),
            })).min(1),
        },
    },
    drama_migrate_legacy_storage: {
        description: "把旧 8080 浏览器本地存储按库无损合并到当前 18080，并立即重新载入项目状态；缺省只迁 app_state，图片与媒体应分库调用。保留旧源数据，返回读取、导入数量和项目摘要。",
        schema: { stores: z.array(z.enum(["app_state", "image_files", "media_files", "image_generation_logs", "image_generation_categories", "video_generation_logs", "creative_workflows"])).optional() },
    },
    drama_export_project_snapshot: {
        description: "把当前浏览器项目完整状态无损保存到该项目的设定/浏览器项目快照.json，用于跨端口升级；不删除或修改现有媒体。",
        schema: { projectId: z.string().optional() },
    },
    drama_import_project_snapshot: {
        description: "从项目目录的设定/浏览器项目快照.json 导入完整项目状态，保留原项目 id、分镜 id、角色与媒体引用；同 id 项目会被快照替换。",
        schema: { project: z.string().min(1) },
    },
    drama_get_skills: {
        description: "获取AI漫剧前期生产规范：原文证据、资产圣经、角色模型包、场景/道具状态包、逐镜硬引用、连续性与开工闸门。创作、改稿或生图前必须先调用。",
    },
    drama_review_shots: {
        description: "用软件自带审查器检测当前活跃项目的分镜：机械检查 + 语义审查（语义模型失败自动降级仅机械结果，degraded=true）。整体结论 verdict 为 pass/revise/rework；findings 每条含 level（blocker/major/minor/note）、location（如「分镜 3」）、message、suggestion，可解析出镜号时附 shotId。审查只检测不改稿，修复用 drama_update_shots 回写。推荐闭环：" + LOOP_HINT,
    },
    drama_start_production: {
        description: "启动当前活跃项目的门禁流水线：代表帧未全部确认时只派发角色/代表帧小样；确认后才派发其余分镜、视频与配音。需先通过 drama_review_shots 与 drama_episode_check。可选 options：characterCandidates、autoAssignView、includeAudio，返回任务数与成本预估。",
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
        description: "一键成片：代表关键帧已确认、全镜视频及全部应有对白/旁白配音齐备后，按分镜顺序组装成片任务。返回 taskId，用 drama_get_render_status 轮询直到完成。",
    },
    drama_get_render_status: {
        description: "查询成片任务状态（taskId 必填，来自 drama_start_render 返回）：status（queued/preparing/rendering/completed/failed）、progress，完成后附成片 url（http/https 地址）。",
        schema: {
            taskId: z.string().min(1).describe("成片任务 id"),
        },
    },
    drama_inject_image: {
        description:
            "把本地图片（Qoder ImageGen 产物）注入到漫剧项目：target=character 注入为角色立绘候选（characterId 必填，可用 characterName 按名匹配；viewKey 可覆盖 front/side/back/threeQuarter；purge=true 会彻底替换旧图）。已确认角色资产不可变，未经用户明确要求禁止重做、裁切、purge 或覆盖。target=shotImage 注入为分镜图（shotId 必填），代码会先强制检查原文覆盖、逐镜连续性、全量资产确认与本镜文件选择；任一未通过均拒绝注入。注入前逐项比对人物身份、姿态接触、道具结构数量材质、场景空间与光色；同类不同造型或任一漂移均不得注入。",
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
            "登记/更新清单条目（优先按编号、其次按稳定键合并，新条目自动编号）：同步规划时不会覆盖旧条目的已确认版本、文件、审核与历史。分类、名称、稳定键、层级、事实等级、依据、锁定段、规格、交付件、依赖和用于应完整；状态走六态机，不要直接跳已确认。",
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
        description: "开工前硬检查：原文覆盖台账、逐镜职责、原文证据、场景、叙事时点、显式出场角色、起止状态、连续性、首帧/动态提示词、质检标准、资产引用、明确文件选择、当前版本文件与依赖必须全部通过；未确认资产会令可开工=false。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            episode: z.string().min(1).describe("集号，如 ep01"),
        },
    },
    drama_get_production_gates: {
        description: "读取当前项目 G0-G5 生产门禁、资产开工检查和代表关键帧清单。任何会产生图片/视频费用的操作前先调用；ready=false 的阶段不得越过。",
        schema: {
            projectId: z.string().optional().describe("项目 id，缺省取当前活跃项目"),
        },
    },
    drama_approve_keyframe: {
        description: "确认或撤销一张代表关键帧。只有实际查看图片，并核对人物身份、服装、装备、空间、光色与人体工学后才能 approved=true；图片重生成或重新注入会自动撤销。",
        schema: {
            projectId: z.string().optional().describe("项目 id，缺省取当前活跃项目"),
            shotId: z.string().min(1).describe("代表镜头 id，取自 drama_get_production_gates"),
            approved: z.boolean().optional().describe("true=确认，false=撤销，缺省 true"),
        },
    },
    drama_episode_update_shots: {
        description: "按镜号局部更新分集制作表中的精确资产引用与质检标准；多文件资产通过资产引用.文件选择本镜文件。不重建整集、不改镜头 ID、不清空或替换任何媒体。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            episode: z.string().min(1).describe("集号，如 ep01"),
            shots: z.array(z.object({
                镜号: z.number().int().min(1),
                所需资产: z.array(z.string()).optional(),
                资产引用: z.array(z.object({ 编号: z.string().min(1), 用途: z.string().min(1), 变体: z.string().optional(), 文件: z.array(z.string()).optional(), 参考职责: z.enum(["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]).optional(), 参考优先级: z.enum(["主参考", "辅助参考"]).optional() })).optional(),
                质检标准: z.string().optional(),
            })).min(1).describe("按镜号局部更新的条目"),
        },
    },
    drama_episode_export: {
        description: "把浏览器项目发布为分集制作包：合并资产圣经且不覆盖已确认版本，写入原文覆盖台账、逐镜职责、起止状态、精确资产引用、提示词与质检文件，并归档已有分镜图。",
        schema: {
            project: z.string().optional().describe("项目名，缺省取活跃项目名"),
            episode: z.string().min(1).describe("集号，如 ep01"),
        },
    },
};

const READ_ONLY_TOOLS = new Set(["drama_list_projects", "drama_get_project", "drama_get_skills", "drama_review_shots", "drama_get_production_gates", "drama_get_production_status", "drama_get_render_status", "drama_asset_list", "drama_episode_check"]);
const DESTRUCTIVE_TOOLS = new Set(["drama_apply_shots", "drama_control_production", "drama_api_request", "drama_inject_image", "drama_reset_workspace"]);
const OPEN_WORLD_TOOLS = new Set(["drama_start_production", "drama_control_production", "drama_start_render", "drama_api_request"]);
const server = new McpServer(
    { name: "drama-bridge", version: "0.1.0" },
    { instructions: `此服务器控制用户当前打开的无限画布漫剧工作区。${LOOP_HINT} 已确认资产不可变；失败稿不得绑定、确认或成为下一轮参考。表情只改变软组织、视线、呼吸和身体张力，不得改变脸部骨相。提示词分事实层、唯一变化层和摄影层；人物身份主参考必须真实进入生成请求，辅助参考不得覆盖身份。` },
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
