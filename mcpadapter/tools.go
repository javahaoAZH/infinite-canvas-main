package mcpadapter

// 漫剧工具：名称/入参/行为与页面侧 BRIDGE_TOOLS 处理器一一对应，
// 漫剧工具描述与 inputSchema 逐行对照 mcp-adapter/drama-mcp.mjs（zod → JSON Schema 字面量），
// 含页面侧通用代理工具与资产清单六工具（drama_asset_* / drama_episode_*），同样纯透传。

// 「AI 检测 → 修复 → 回写」闭环提示，同 drama-mcp.mjs LOOP_HINT
const loopHint = "推荐闭环：先 drama_get_skills 获取写法规范 → 产出内容 → drama_review_shots 检测 → 对不合格 findings 用 drama_update_shots 回写修复 → 复检通过后 drama_start_production。"

// 无入参工具的 schema（MCP 规范要求 inputSchema 存在）
const emptySchema = `{"type":"object","properties":{}}`

type toolDef struct {
	name        string
	description string
	inputSchema string
}

var toolDefs = []toolDef{
	{
		name:        "drama_list_projects",
		description: "列出漫剧软件中的全部项目（按更新时间倒序）：id、标题、当前步骤（0-5 对应剧本/分镜/角色四视图/分镜图/图生视频/配音成片）、分镜数、角色数。",
		inputSchema: emptySchema,
	},
	{
		name:        "drama_get_project",
		description: "读取项目详情：剧本全文、题材/场景/画风（含中文标签与自定义画风描述）、全部分镜（id、序号、画面描述、对白、旁白、秒数、图片/视频/配音是否已生成）、角色（名称、描述、已分配视图数）、最近成片地址。不传 projectId 时取当前活跃项目。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "项目 id，缺省取当前活跃项目"}
			}
		}`,
	},
	{
		name:        "drama_create_project",
		description: "新建漫剧项目并设为活跃项目（软件当前不在 /drama 页面时会自动跳转过去，用户可实时看到后续逐条写入）。可选 title 为项目名。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"title": {"type": "string", "description": "项目名称"}
			}
		}`,
	},
	{
		name:        "drama_set_options",
		description: "设置生成选项（字段都可选）：题材 genre、场景 scene、画风 artStyle（取 custom 时配合 customArtStyle 传可观察写法的自定义画风描述）。合法 id 以 drama_get_skills 返回目录为准，非法 id 报错并列出全部合法值。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"genre": {"type": "string", "description": "题材 id，空字符串表示不指定"},
				"scene": {"type": "string", "description": "场景/世界观预设 id，空字符串表示不指定"},
				"artStyle": {"type": "string", "description": "画风 id，custom 表示自定义"},
				"customArtStyle": {"type": "string", "description": "自定义画风描述（可观察写法）"}
			}
		}`,
	},
	{
		name:        "drama_set_script",
		description: "写入剧本文本（script 必填非空，可选 title 同步项目名）。只写原文不做结构化，分镜需另行 drama_apply_shots 直写。推荐闭环：" + loopHint,
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "项目 id，缺省取当前活跃项目"},
				"script": {"type": "string", "minLength": 1, "description": "剧本文本"},
				"title": {"type": "string", "description": "项目名称（传入时同步更新）"}
			},
			"required": ["script"]
		}`,
	},
	{
		name:        "drama_apply_shots",
		description: "结构化直写分镜与角色（Qoder 大脑入口，不经文本模型）：整包替换当前活跃项目的全部分镜并清空已生成的媒体表；同名角色沿用已有立绘与视图分配。分镜与角色写法规范先看 drama_get_skills。推荐闭环：" + loopHint,
		inputSchema: `{
			"type": "object",
			"properties": {
				"shots": {
					"type": "array",
					"minItems": 1,
					"description": "全量分镜列表（整包替换）",
					"items": {
						"type": "object",
						"properties": {
							"description": {"type": "string", "minLength": 1, "description": "画面描述：只写镜头起点时刻可见的物理事实"},
							"dialogue": {"type": "string", "description": "对白，可为空字符串"},
							"narration": {"type": "string", "description": "旁白（画外音），可为空字符串"},
							"seconds": {"type": "integer", "minimum": 1, "maximum": 30, "description": "本镜时长（秒）1-30，缺省 5"}
						},
						"required": ["description"]
					}
				},
				"characters": {
					"type": "array",
					"description": "角色表，同名角色沿用已有立绘与视图分配",
					"items": {
						"type": "object",
						"properties": {
							"name": {"type": "string", "minLength": 1, "description": "角色名"},
							"description": {"type": "string", "minLength": 1, "description": "可观察外貌描述（立绘提示词基底）"}
						},
						"required": ["name", "description"]
					}
				}
			},
			"required": ["shots"]
		}`,
	},
	{
		name:        "drama_update_shots",
		description: "按分镜 id 部分更新分镜（「AI 检测 → 修复 → 回写」闭环专用）：只覆盖传入字段（秒数钳 1-30），不动未提及分镜、不清空媒体表、保留已有媒体关联；id 不存在时报错列出无效 id。分镜 id 从 drama_get_project 或 drama_apply_shots 返回获取，drama_review_shots 的 findings 带 index 定位与可解析时的 shotId。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"shots": {
					"type": "array",
					"minItems": 1,
					"description": "要更新的分镜列表（只覆盖传入字段）",
					"items": {
						"type": "object",
						"properties": {
							"id": {"type": "string", "minLength": 1, "description": "分镜 id"},
							"description": {"type": "string", "description": "新的画面描述"},
							"dialogue": {"type": "string", "description": "新的对白"},
							"narration": {"type": "string", "description": "新的旁白"},
							"seconds": {"type": "integer", "minimum": 1, "maximum": 30, "description": "新的时长（秒）"}
						},
						"required": ["id"]
					}
				}
			},
			"required": ["shots"]
		}`,
	},
	{
		name:        "drama_get_skills",
		description: "获取漫剧软件的技能规范目录（单一事实来源）：题材卡 genres（18 张，含要点与示例）、场景预设 scenes、画风 artStyles、镜头语言词表 frameLexicon、分镜写法规范 shotRules、角色描述规范 characterRules。创作任何剧本/分镜前先调用本工具。",
		inputSchema: emptySchema,
	},
	{
		name:        "drama_review_shots",
		description: "用软件自带审查器检测当前活跃项目的分镜：机械检查 + 语义审查（语义模型失败自动降级仅机械结果，degraded=true）。整体结论 verdict 为 pass/revise/rework；findings 每条含 level（blocker/major/minor/note）、location（如「分镜 3」）、message、suggestion，可解析出镜号时附 shotId。审查只检测不改稿，修复用 drama_update_shots 回写。推荐闭环：" + loopHint,
		inputSchema: emptySchema,
	},
	{
		name:        "drama_start_production",
		description: "启动当前活跃项目的自动生产流水线（立绘 → 分镜图 → 视频 ∥ 配音）：需项目已有分镜，其他项目生产中会报错。可选 options：characterCandidates（1 或 4 张立绘候选）、autoAssignView、includeAudio。返回任务数与成本预估。建议先用 drama_review_shots 检测并修复分镜后再启动。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"options": {
					"type": "object",
					"description": "生产选项",
					"properties": {
						"characterCandidates": {"type": "integer", "enum": [1, 4], "description": "角色立绘候选张数，1 或 4，缺省 4"},
						"autoAssignView": {"type": "boolean", "description": "是否自动把首选立绘分配到 front 视图，缺省 true"},
						"includeAudio": {"type": "boolean", "description": "是否包含配音任务，缺省 true"}
					}
				}
			}
		}`,
	},
	{
		name:        "drama_get_production_status",
		description: "查询当前活跃项目的自动生产状态：无计划时 status=none；有计划时返回 status（draft/confirmed/running/paused/done/aborted）、progress（done/total/failed/skipped）与任务明细（id、kind、label、status、attempts、error）。",
		inputSchema: emptySchema,
	},
	{
		name:        "drama_control_production",
		description: "控制当前活跃项目的自动生产：pause（暂停）/ resume（继续）/ abort（终止），或 retry / skip（需 taskId；retry 仅限失败任务，skip 支持失败或待执行任务，处理后自动按需拉起执行器）。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"action": {"type": "string", "enum": ["pause", "resume", "abort", "retry", "skip"], "description": "控制动作"},
				"taskId": {"type": "string", "description": "retry / skip 时的任务 id（drama_get_production_status 返回）"}
			},
			"required": ["action"]
		}`,
	},
	{
		name:        "drama_start_render",
		description: "一键成片：把当前活跃项目已生成的分镜视频与配音组装为成片任务（需登录账号，且至少一个分镜视频已生成）。返回 taskId，用 drama_get_render_status 轮询直到完成。",
		inputSchema: emptySchema,
	},
	{
		name:        "drama_get_render_status",
		description: "查询成片任务状态（taskId 必填，来自 drama_start_render 返回）：status（queued/preparing/rendering/completed/failed）、progress，完成后附成片 url（http/https 地址）。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"taskId": {"type": "string", "minLength": 1, "description": "成片任务 id"}
			},
			"required": ["taskId"]
		}`,
	},
	{
		name:        "drama_api_request",
		description: "通用后端 API 代理：以当前登录态调用本软件任意 /api 接口（设置、素材、画布、管理等），返回 {code, data, msg}。path 必须以 /api/ 开头，method 限 GET/POST/PUT/DELETE，非 GET 成功后软件界面会实时刷新。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"], "description": "HTTP 方法"},
				"path": {"type": "string", "description": "接口路径，以 /api/ 开头，如 /api/settings"},
				"body": {"type": "object", "description": "POST/PUT 请求体，GET/DELETE 可不传"}
			},
			"required": ["method", "path"]
		}`,
	},
	{
		name:        "drama_local_config",
		description: "读取或写入前端本地配置（API Key 等浏览器本地设置）；action=get 返回 config 与 effective（生效值），action=set 按 patch 逐项更新并自动持久化，界面实时生效。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"action": {"type": "string", "enum": ["get", "set"], "description": "get 读取，set 写入"},
				"patch": {"type": "object", "description": "action=set 时要更新的配置字段，非法字段报中文错误"}
			},
			"required": ["action"]
		}`,
	},
	{
		name:        "drama_asset_list",
		description: "查询项目资产清单（D 盘项目文件夹 资产清单.json 为唯一事实源，三区分离：store 工作区/清单发布区/history 历史区）：可按分类（角色/场景/道具/生物/特效/图形）、状态（待产出/制作中/待审核/需修改/已确认/已归档）、优先级（P0-P3）过滤；返回条目含版本、审核记录、锁定段、依赖、用于。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"project": {"type": "string", "description": "项目名，缺省取活跃项目名"},
				"category": {"type": "string", "description": "分类过滤"},
				"status": {"type": "string", "description": "状态过滤"},
				"priority": {"type": "string", "description": "优先级过滤"}
			}
		}`,
	},
	{
		name:        "drama_asset_upsert",
		description: "登记/更新清单条目（按编号合并，新条目自动编号）：分类（六类之一）与名称必填；优先级 P0-P3；依据（如 第2章·卡§9）；锁定段（角色卡生图提示词原文，一字不改）；规格；依赖（条目编号数组）；用于（集.镜数组，如 ep01.镜头3）。状态走六态机，不要直接跳已确认。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"project": {"type": "string", "description": "项目名，缺省取活跃项目名"},
				"entry": {"type": "object", "description": "条目对象（中文字段名：编号/分类/名称/规格/优先级/状态/依据/锁定段/依赖/用于）"}
			},
			"required": ["entry"]
		}`,
	},
	{
		name:        "drama_asset_bind",
		description: "把本地产物绑定到清单条目成为新版本 vNNN（旧版文件自动移入 history/，条目状态→待审核）；files 为本地绝对路径（适配器转 base64 转发）；source 可选复跑参数 JSON 文本（提示词全文/尺寸/种子/渠道）。绑定后等人工审核：drama_asset_confirm 或资产页。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"project": {"type": "string", "description": "项目名，缺省取活跃项目名"},
				"id": {"type": "string", "minLength": 1, "description": "条目编号"},
				"files": {"type": "array", "minItems": 1, "items": {"type": "string"}, "description": "产物本地绝对路径"},
				"note": {"type": "string", "description": "版本备注"},
				"source": {"type": "string", "description": "复跑参数 JSON 文本"}
			},
			"required": ["id", "files"]
		}`,
	},
	{
		name:        "drama_asset_confirm",
		description: "批量审核确认清单条目（结论=已确认，审核轮次留档，审核人=MCP）；需修改请用 drama_asset_upsert 把状态改回待产出并在审核意见说明原因。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"project": {"type": "string", "description": "项目名，缺省取活跃项目名"},
				"ids": {"type": "array", "minItems": 1, "items": {"type": "string"}, "description": "条目编号数组"},
				"comment": {"type": "string", "description": "审核意见"}
			},
			"required": ["ids"]
		}`,
	},
	{
		name:        "drama_episode_check",
		description: "开工前检查：返回该集引用资产的缺产出/未确认/依赖阻塞清单与是否可开工；不可开工时先补齐并确认资产（drama_asset_upsert/bind/confirm）。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"project": {"type": "string", "description": "项目名，缺省取活跃项目名"},
				"episode": {"type": "string", "minLength": 1, "description": "集号，如 ep01"}
			},
			"required": ["episode"]
		}`,
	},
	{
		name:        "drama_episode_export",
		description: "把浏览器活跃项目的分镜导出为 分集/<集>/分镜稿.md 九字段表，并把该集分镜图归档到 分集/<集>/shots/（返回归档数）；导出后可对照分镜稿审核资产。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"project": {"type": "string", "description": "项目名，缺省取活跃项目名"},
				"episode": {"type": "string", "minLength": 1, "description": "集号，如 ep01"}
			},
			"required": ["episode"]
		}`,
	},
}
