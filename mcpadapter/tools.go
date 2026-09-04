package mcpadapter

// 漫剧工具：名称/入参/行为与页面侧 BRIDGE_TOOLS 处理器一一对应，
// 漫剧工具描述与 inputSchema 逐行对照 mcp-adapter/drama-mcp.mjs（zod → JSON Schema 字面量），
// 含页面侧通用代理工具与资产清单六工具（drama_asset_* / drama_episode_*），同样纯透传。

// 「AI 检测 → 修复 → 回写」闭环提示，同 drama-mcp.mjs LOOP_HINT
const loopHint = "强制闭环：先读小说全文并调用 drama_get_skills → 锁定项目级美术风格圣经 → 建立原文覆盖台账与资产圣经（设定板只作核对，每个视图/状态独立交付；真实像素、比例与透明通道符合规格）→ drama_apply_shots 同时提交 coverage、assets、逐镜职责、出场角色、首帧/动态提示词、qualityCriteria、assetRefs 与起止状态 → drama_episode_export 发布清单 → drama_review_shots 与 drama_episode_check 均通过 → drama_get_production_gates 获取代表镜头 → 只生成代表帧 → 实际检查图片后逐张 drama_approve_keyframe → 才能批量生产。自动检查不得代替人工看图确认，废弃造型不得留在当前可选资产池。"

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
		description: "列出漫剧软件中的全部项目（按更新时间倒序）：id、标题、当前步骤（0-5 对应原文拆解/生产规划/资产生产/关键帧与分镜/动态镜头/配音成片）、分镜数、角色数。",
		inputSchema: emptySchema,
	},
	{
		name:        "drama_get_project",
		description: "读取项目详情：剧本全文、题材/场景/画风（含中文标签与自定义画风描述）、全部分镜（id、序号、画面描述、对白、旁白、秒数、景别/运镜/转场、动作/情绪/出场角色/出图提示词/图生视频提示词、图片/视频/配音是否已生成）、角色（名称、描述、已分配视图数）、最近成片地址。不传 projectId 时取当前活跃项目。",
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
		name:        "drama_reset_workspace",
		description: "清空当前生产工作区中的全部漫剧项目、画布项目和“我的素材”（含登录账号同步数据），但保留账号登录态、API Key、模型渠道与主题设置；完成后预置东方志怪·电影级3D国漫画风。不可撤销，必须明确传 confirm=RESET。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"confirm": {"type": "string", "const": "RESET", "description": "强确认文本，必须为 RESET"}
			},
			"required": ["confirm"]
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
		name:        "drama_update_characters",
		description: "按角色 id 或名称局部更新角色描述锚点；保留候选图、四视图、全部分镜与媒体，不用于更换角色身份。适合角色母版修订后安全清除旧武器或旧特效描述。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "项目 id，缺省取当前活跃项目"},
				"characters": {"type": "array", "minItems": 1, "items": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}, "description": {"type": "string", "minLength": 1}}, "required": ["description"]}}
			},
			"required": ["characters"]
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
		description: "整包写入可生产分镜：必须同时提交 coverage、assets，以及每镜的原文证据、职责、显式出场角色、起止状态、首帧/动态提示词、qualityCriteria 和 assetRefs；任一缺失或证据无法在小说中定位都会拒绝写入。会替换目标项目全部分镜并清空已有媒体；同名角色保留已生成视图。" + loopHint,
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "目标项目 id，缺省取当前活跃项目"},
				"episode": {"type": "string", "description": "集号，如 ep01"},
				"coverage": {"type": "array", "minItems": 1, "description": "小说重要信息的全量去向台账", "items": {"type": "object", "properties": {"quote": {"type": "string", "minLength": 1}, "disposition": {"type": "string", "enum": ["画面", "对白", "旁白", "音效", "合并", "暂不采用"]}, "shotNumbers": {"type": "array", "items": {"type": "integer", "minimum": 1}}, "note": {"type": "string"}}, "required": ["quote", "disposition", "shotNumbers"]}},
				"assets": {"type": "array", "minItems": 1, "description": "从小说逐段拆出的全量资产圣经", "items": {
					"type": "object",
					"properties": {
						"key": {"type": "string", "minLength": 1, "description": "全项目唯一稳定键"},
						"category": {"type": "string", "enum": ["角色", "场景", "道具", "生物", "特效", "图形", "声音", "风格"]},
						"name": {"type": "string", "minLength": 1},
						"layer": {"type": "string", "enum": ["身份母版", "状态变体", "表演动作", "空间布局", "合成层"]},
						"factLevel": {"type": "string", "enum": ["原文明确", "原文推断", "改编设计"]},
						"sourceEvidence": {"type": "string", "minLength": 1},
						"specification": {"type": "string", "minLength": 1},
						"lock": {"type": "string", "minLength": 1},
						"deliverables": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
						"dependencies": {"type": "array", "items": {"type": "string"}},
						"priority": {"type": "string", "enum": ["P0", "P1", "P2", "P3"]},
						"referenceRole": {"type": "string", "enum": ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]},
						"generationPrompt": {"type": "string"},
						"avoidPrompt": {"type": "string"},
						"reviewCriteria": {"type": "array", "items": {"type": "string"}}
					},
					"required": ["key", "category", "name", "layer", "factLevel", "sourceEvidence", "specification", "lock", "deliverables", "dependencies", "priority"]
				}},
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
							"seconds": {"type": "integer", "minimum": 1, "maximum": 30, "description": "本镜时长（秒）1-30，缺省 5"},
							"shotSize": {"type": "string", "description": "景别（远景/全景/中景/中近景/近景/特写）"},
							"camera": {"type": "string", "description": "运镜（固定镜头/推镜头/拉镜头/横移/环绕/手持跟拍/升/降）"},
							"transition": {"type": "string", "description": "转场（硬切/叠化/匹配剪辑/白闪/黑场）"},
							"action": {"type": "string", "description": "动作：角色在本镜内可见的肢体动作与表情变化（小说心理描写必须外化为可见动作后写在这里）"},
							"emotion": {"type": "string", "description": "情绪：本镜人物情绪或画面情绪基调（如震惊/压抑/释然/惊叹），进提示词驱动光线与构图"},
							"characters": {"type": "array", "items": {"type": "string"}, "description": "本镜出场角色名数组；空镜必须显式传空数组"},
							"imagePrompt": {"type": "string", "minLength": 1, "description": "出图提示词：只写镜头起点的正向可见事实，画风基底与一致性约束由项目级统一拼接"},
							"videoPrompt": {"type": "string", "minLength": 1, "description": "图生视频提示词：只写从起始态到结束态的主体/环境运动、运镜与节奏，不写剪辑转场"},
							"sourceEvidence": {"type": "string", "minLength": 1, "description": "支持本镜的小说原文短引文"},
							"location": {"type": "string", "minLength": 1, "description": "具体场景/空间"},
							"storyTime": {"type": "string", "minLength": 1, "description": "日夜、闪回或叙事时点"},
							"shotPurpose": {"type": "string", "minLength": 1, "description": "本镜唯一要传递的叙事或物理变化"},
							"startState": {"type": "string", "minLength": 1, "description": "镜头起点连续性状态"},
							"endState": {"type": "string", "minLength": 1, "description": "镜头终点连续性状态"},
							"continuity": {"type": "string", "minLength": 1, "description": "必须带入下一镜的状态；首镜写开场基准"},
							"qualityCriteria": {"type": "string", "minLength": 1, "description": "看图即可逐项核对的身份、资产版本、人体工学、空间、特效和连续性通过条件"},
							"assetRefs": {"type": "array", "minItems": 1, "description": "本镜全部可见或参与动作的资产", "items": {"type": "object", "properties": {"key": {"type": "string", "minLength": 1}, "purpose": {"type": "string", "minLength": 1}, "variant": {"type": "string"}, "files": {"type": "array", "items": {"type": "string"}}, "referenceRole": {"type": "string", "enum": ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]}, "referencePriority": {"type": "string", "enum": ["主参考", "辅助参考"]}}, "required": ["key", "purpose", "referenceRole", "referencePriority"]}}
						},
						"required": ["description", "characters", "imagePrompt", "videoPrompt", "sourceEvidence", "location", "storyTime", "shotPurpose", "startState", "endState", "continuity", "qualityCriteria", "assetRefs"]
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
			"required": ["coverage", "assets", "shots"]
		}`,
	},
	{
		name:        "drama_update_shots",
		description: "按分镜 id 局部修复分镜与其原文证据、起止状态、连续性和资产引用；不动未提及镜头、不清空媒体。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "目标项目 id，缺省取当前活跃项目"},
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
							"seconds": {"type": "integer", "minimum": 1, "maximum": 30, "description": "新的时长（秒）"},
							"shotSize": {"type": "string", "description": "新的景别"},
							"camera": {"type": "string", "description": "新的运镜"},
							"transition": {"type": "string", "description": "新的转场"},
							"action": {"type": "string", "description": "新的动作（空串清除）"},
							"emotion": {"type": "string", "description": "新的情绪（空串清除）"},
							"characters": {"type": "array", "items": {"type": "string"}, "description": "新的出场角色名数组"},
							"imagePrompt": {"type": "string", "description": "新的出图提示词（空串清除）"},
							"videoPrompt": {"type": "string", "description": "新的图生视频提示词（空串清除）"},
							"sourceEvidence": {"type": "string", "description": "新的原文短引文"},
							"location": {"type": "string", "description": "新的具体场景"},
							"storyTime": {"type": "string", "description": "新的叙事时点"},
							"shotPurpose": {"type": "string", "description": "新的镜头职责"},
							"startState": {"type": "string", "description": "新的镜头起始态"},
							"endState": {"type": "string", "description": "新的镜头结束态"},
							"continuity": {"type": "string", "description": "新的跨镜连续性"},
							"qualityCriteria": {"type": "string", "description": "新的可视化质检标准"},
							"assetRefs": {"type": "array", "items": {"type": "object", "properties": {"key": {"type": "string", "minLength": 1}, "purpose": {"type": "string", "minLength": 1}, "variant": {"type": "string"}, "files": {"type": "array", "items": {"type": "string"}}, "referenceRole": {"type": "string", "enum": ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]}, "referencePriority": {"type": "string", "enum": ["主参考", "辅助参考"]}}, "required": ["key", "purpose"]}}
						},
						"required": ["id"]
					}
				}
			},
			"required": ["shots"]
		}`,
	},
	{
		name:        "drama_update_preproduction",
		description: "安全升级旧项目的项目级前期数据：写入原文覆盖台账与资产圣经，并用现有分镜做完整性校验；保留全部镜头 id、角色四视图、分镜图、视频、配音与关键帧确认。应先用 drama_update_shots 补齐逐镜新增字段。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "目标项目 id，缺省取当前活跃项目"},
				"episode": {"type": "string", "description": "集号，如 ep01"},
				"coverage": {"type": "array", "minItems": 1, "items": {"type": "object", "properties": {"quote": {"type": "string", "minLength": 1}, "disposition": {"type": "string", "enum": ["画面", "对白", "旁白", "音效", "合并", "暂不采用"]}, "shotNumbers": {"type": "array", "items": {"type": "integer", "minimum": 1}}, "note": {"type": "string"}}, "required": ["quote", "disposition", "shotNumbers"]}},
				"assets": {"type": "array", "minItems": 1, "items": {"type": "object", "properties": {"key": {"type": "string", "minLength": 1}, "category": {"type": "string", "enum": ["角色", "场景", "道具", "生物", "特效", "图形", "声音", "风格"]}, "name": {"type": "string", "minLength": 1}, "layer": {"type": "string", "enum": ["身份母版", "状态变体", "表演动作", "空间布局", "合成层"]}, "factLevel": {"type": "string", "enum": ["原文明确", "原文推断", "改编设计"]}, "sourceEvidence": {"type": "string", "minLength": 1}, "specification": {"type": "string", "minLength": 1}, "lock": {"type": "string", "minLength": 1}, "deliverables": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}}, "dependencies": {"type": "array", "items": {"type": "string"}}, "priority": {"type": "string", "enum": ["P0", "P1", "P2", "P3"]}, "referenceRole": {"type": "string", "enum": ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]}, "generationPrompt": {"type": "string"}, "avoidPrompt": {"type": "string"}, "reviewCriteria": {"type": "array", "items": {"type": "string"}}}, "required": ["key", "category", "name", "layer", "factLevel", "sourceEvidence", "specification", "lock", "deliverables", "dependencies", "priority"]}}
			},
			"required": ["coverage", "assets"]
		}`,
	},
	{
		name:        "drama_migrate_legacy_storage",
		description: "把旧 8080 浏览器本地存储按库无损合并到当前 18080，并立即重新载入项目状态；缺省只迁 app_state，图片与媒体应分库调用。保留旧源数据，返回读取、导入数量和项目摘要。",
		inputSchema: `{"type":"object","properties":{"stores":{"type":"array","items":{"type":"string","enum":["app_state","image_files","media_files","image_generation_logs","image_generation_categories","video_generation_logs","creative_workflows"]}}}}`,
	},
	{
		name:        "drama_export_project_snapshot",
		description: "把当前浏览器项目完整状态无损保存到该项目的设定/浏览器项目快照.json，用于跨端口升级；不删除或修改现有媒体。",
		inputSchema: `{"type":"object","properties":{"projectId":{"type":"string"}}}`,
	},
	{
		name:        "drama_import_project_snapshot",
		description: "从项目目录的设定/浏览器项目快照.json 导入完整项目状态，保留原项目 id、分镜 id、角色与媒体引用；同 id 项目会被快照替换。",
		inputSchema: `{"type":"object","properties":{"project":{"type":"string","minLength":1}},"required":["project"]}`,
	},
	{
		name:        "drama_get_skills",
		description: "获取AI漫剧前期生产规范：原文证据、资产圣经、角色模型包、场景/道具状态包、逐镜硬引用、连续性与开工闸门。创作、改稿或生图前必须先调用。",
		inputSchema: emptySchema,
	},
	{
		name:        "drama_review_shots",
		description: "用软件自带审查器检测当前活跃项目的分镜：机械检查 + 语义审查（语义模型失败自动降级仅机械结果，degraded=true）。整体结论 verdict 为 pass/revise/rework；findings 每条含 level（blocker/major/minor/note）、location（如「分镜 3」）、message、suggestion，可解析出镜号时附 shotId。审查只检测不改稿，修复用 drama_update_shots 回写。推荐闭环：" + loopHint,
		inputSchema: emptySchema,
	},
	{
		name:        "drama_get_production_gates",
		description: "读取当前项目 G0-G5 生产门禁、资产开工检查和代表关键帧清单。任何会产生图片/视频费用的操作前先调用；ready=false 的阶段不得越过。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "项目 id，缺省取当前活跃项目"}
			}
		}`,
	},
	{
		name:        "drama_approve_keyframe",
		description: "确认或撤销一张代表关键帧。只有实际查看图片，并核对人物身份、服装、装备、空间、光色与人体工学后才能 approved=true；图片重生成或重新注入会自动撤销。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"projectId": {"type": "string", "description": "项目 id，缺省取当前活跃项目"},
				"shotId": {"type": "string", "minLength": 1, "description": "代表镜头 id，取自 drama_get_production_gates"},
				"approved": {"type": "boolean", "description": "true=确认，false=撤销，缺省 true"}
			},
			"required": ["shotId"]
		}`,
	},
	{
		name:        "drama_start_production",
		description: "启动当前活跃项目的门禁流水线：代表帧未全部确认时只派发角色/代表帧小样；确认后才派发其余分镜、视频与配音。需先通过 drama_review_shots 与 drama_episode_check。可选 options：characterCandidates、autoAssignView、includeAudio，返回任务数与成本预估。",
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
		description: "一键成片：代表关键帧已确认、全镜视频及全部应有对白/旁白配音齐备后，按分镜顺序组装成片任务。返回 taskId，用 drama_get_render_status 轮询直到完成。",
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
		name:        "drama_inject_image",
		description: "把本地图片（Qoder ImageGen 产物）注入到漫剧项目：target=character 注入为角色立绘候选（characterId 必填，可用 characterName 按名匹配；viewKey 可覆盖 front/side/back/threeQuarter；purge=true 会彻底替换旧图）。已确认角色资产不可变，未经用户明确要求禁止重做、裁切、purge 或覆盖。target=shotImage 注入为分镜图（shotId 必填），代码会先强制检查原文覆盖、逐镜连续性、全量资产确认与本镜文件选择；任一未通过均拒绝注入。注入前逐项比对人物身份、姿态接触、道具结构数量材质、场景空间与光色；同类不同造型或任一漂移均不得注入。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"file": {"type": "string", "minLength": 1, "description": "本地图片绝对路径（png / jpg / jpeg / webp）"},
				"target": {"type": "string", "enum": ["character", "shotImage"], "description": "注入目标：character=角色立绘候选，shotImage=分镜图"},
				"characterId": {"type": "string", "description": "目标角色 id（target=character 时，与 characterName 二选一）"},
				"characterName": {"type": "string", "description": "目标角色名（target=character 时，与 characterId 二选一，按名匹配）"},
				"shotId": {"type": "string", "description": "目标分镜 id（target=shotImage 时必填，取自 drama_get_project）"},
				"autoAssignView": {"type": "boolean", "description": "注入立绘后自动分配到首个空视图，缺省 true"},
				"viewKey": {"type": "string", "enum": ["front", "side", "back", "threeQuarter"], "description": "指定覆盖某个视图（替换旧立绘）；不传则走 autoAssignView 只填首个空视图"},
				"purge": {"type": "boolean", "description": "target=character 时先清空该角色旧候选与旧视图再写入新图（彻底替换，不留旧图堆积）"}
			},
			"required": ["file", "target"]
		}`,
	},
	{
		name:        "drama_asset_list",
		description: "查询项目资产清单（D 盘项目文件夹 资产清单.json 为唯一事实源，三区分离：store 工作区/清单发布区/history 历史区）：可按分类（角色/场景/道具/生物/特效/图形）、状态（待产出/制作中/待审核/需修改/已确认/已归档）、优先级（P0-P3）过滤；返回条目含版本、审核记录、锁定段、依赖、用于；并返回分集分镜（分集：季→集→镜头，含所需资产/推荐模型/产物）与季集结构。",
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
		description: "登记/更新清单条目（优先按编号、其次按稳定键合并，新条目自动编号）：同步规划时不会覆盖旧条目的已确认版本、文件、审核与历史。分类、名称、稳定键、层级、事实等级、依据、锁定段、规格、交付件、依赖和用于应完整；状态走六态机，不要直接跳已确认。",
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
		description: "开工前硬检查：原文覆盖台账、逐镜职责、原文证据、场景、叙事时点、显式出场角色、起止状态、连续性、首帧/动态提示词、质检标准、资产引用、明确文件选择、当前版本文件与依赖必须全部通过；未确认资产会令可开工=false。",
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
		name:        "drama_episode_update_shots",
		description: "按镜号局部更新分集制作表中的精确资产引用与质检标准；多文件资产通过资产引用.文件选择本镜文件。不重建整集、不改镜头 ID、不清空或替换任何媒体。",
		inputSchema: `{
			"type": "object",
			"properties": {
				"project": {"type": "string", "description": "项目名，缺省取活跃项目名"},
				"episode": {"type": "string", "minLength": 1, "description": "集号，如 ep01"},
				"shots": {"type": "array", "minItems": 1, "items": {"type": "object", "properties": {"镜号": {"type": "integer", "minimum": 1}, "所需资产": {"type": "array", "items": {"type": "string"}}, "资产引用": {"type": "array", "items": {"type": "object", "properties": {"编号": {"type": "string", "minLength": 1}, "用途": {"type": "string", "minLength": 1}, "变体": {"type": "string"}, "文件": {"type": "array", "items": {"type": "string"}}, "参考职责": {"type": "string", "enum": ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"]}, "参考优先级": {"type": "string", "enum": ["主参考", "辅助参考"]}}, "required": ["编号", "用途"]}}, "质检标准": {"type": "string"}}, "required": ["镜号"]}}
			},
			"required": ["episode", "shots"]
		}`,
	},
	{
		name:        "drama_episode_export",
		description: "把浏览器项目发布为分集制作包：合并资产圣经且不覆盖已确认版本，写入原文覆盖台账、逐镜职责、起止状态、精确资产引用、提示词与质检文件，并归档已有分镜图。",
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
