// /drama 提示词方法论内置：参考开源项目 zenstory-ai/drama-skills
// （https://github.com/zenstory-ai/drama-skills ，MIT License，基线 commit 3ab6b8550bbccef71001d2187e2b2ac9a74ab917）
// 的 AI 漫剧创作方法论，已按本项目 JSON 数据结构与浏览器直连生成场景用自己的话改写，并裁剪 CLI 工程流程相关内容。
// 本轮深化新增依据的仓库文件：
// - skills/short-drama-develop/references/genre-cards/*.md（18 张题材卡，GENRE_CARDS）
// - skills/short-drama-storyboard/references/comic-keyframe-lexicon.md（镜头级可读性词表，FRAME_LEXICON）
// - skills/short-drama-video-prompts/SKILL.md、references/motion-recipe.md、references/camera-audio-continuity.md（buildShotVideoPrompt）
// - skills/short-drama-write/SKILL.md（[VO]/[OS] 生产标签，旁白字段）、references/dialogue-craft.md、references/scene-sound-dramaturgy.md（对白手艺）
// - skills/short-drama-assets/references/voice-direction.md（VOICE_DIRECTION_GUIDE）
// 本轮扩充依据：番茄/红果短剧榜单热门题材调研（新增 6 张题材卡）、场景/世界观预设（SCENE_PRESETS）与题材推荐场景映射、3D 系画风三条

// 剧本结构化系统提示词：输出 JSON schema 保持兼容（新增可选旁白字段），内容质量规则含
// 对白即行动、每场必有变化、一镜一职责、角色身份锚点、对白手艺与旁白规则
export const SCRIPT_STRUCTURE_SYSTEM_PROMPT =
    "你是漫剧分镜编剧助手。用户会给你一段剧本文本，你需要把它结构化为漫剧分镜数据。内容质量规则：" +
    "一、对白即行动：每句对白都要有戏剧目的（争取、回避、试探、逼迫或重新定义关系），禁止让角色把剧情资料读给观众听。" +
    "二、每场必须至少改变一项：信息、权力、关系、情绪、物理状态或风险；没有变化的场次并入相邻场；每场结尾留下悬念或未决事项，把压力传给下一场。" +
    "三、分镜规则：一镜只承担一个职责，每次切镜必须带来信息、权力、情绪、空间或节奏之一的变化；开场镜比工作景别宽一档，第二镜落到人物工作景别；地理信息通过人物动作在画面内部交代，不用空镜全景开场；每镜描述只写镜头起点时刻可见的人物、道具与状态。" +
    "四、角色规则：为每个角色写身份锚点，即可见、可生成、可比较的具体事实（发型、发色、服饰件数与材质、标志物），不使用“气质出众”这类空泛词。" +
    "五、对白手艺：先定这句话想对对方做什么再写字面表达；潜台词来自不能或不愿直说的理由，并给观众留下可推断的线索；背景信息通过争夺、交换、回避进入冲突，不让角色一口气复述彼此都知道的事实；停顿与打断要有对象和后果，不做节奏填充；不同角色的语言用目标、证明方式与压力下的变化区分，不靠口头禅。" +
    "六、旁白规则：narration 是可选的画外音（VO），用于内心独白、时间过渡或画面无法呈现的信息；没有旁白就写空字符串；旁白不重复对白与画面已呈现的内容。" +
    "严格按以下 JSON 格式输出，不要输出任何其他文字、注释或代码块标记：" +
    "{\"title\":\"作品标题\",\"characters\":[{\"name\":\"角色名\",\"description\":\"角色外貌与服装描述，用于生成立绘\"}],\"shots\":[{\"description\":\"画面描述（场景、人物动作、构图），用于生成分镜图\",\"dialogue\":\"该分镜的对白，没有则为空字符串\",\"narration\":\"该分镜的旁白画外音，没有则为空字符串\",\"seconds\":5}]}";

export type DramaGenreCard = { id: string; label: string; points: string[] };

// 18 张题材卡：每张压缩为 5-8 条核心条目（压力来源、人物策略与信息权限、观众回报落点、钩子取向、禁止漂移），
// 作为剧本系统提示词的校准参考而非硬规则，与用户输入冲突时以用户输入为准
export const GENRE_CARDS: DramaGenreCard[] = [
    {
        id: "revenge",
        label: "复仇打脸",
        points: [
            "压力来源：对手必须握有可执行手段（权限、资金、把柄、规则解释权），主角每前进一步都要付出成本",
            "人物策略：主角藏底牌换观察时间、用对手自己的规则反制、先取证再动手；信息分三层——谁知底牌、谁有证据不敢说、谁只看表面而站错队",
            "对手要会学习：被反制后改口径、换渠道、切割替罪者，只会加大恶意的对手撑不过中段",
            "观众回报落在可核对的权力变化：签字被驳回、门禁失效、名册划名；压抑期尽早给一次小额兑付",
            "钩子从本集已发生的结果往下长：对手封住一条路径、兑付产生新债、沉默者开口；不重复放大声的威胁",
            "禁止漂移：不让对手只有辱骂没有手段；不用报出头衔代替证据；不只受辱不产生变化；不把反转建立在观众无从看见的新事实上",
        ],
    },
    {
        id: "palace-intrigue",
        label: "古装权谋",
        points: [
            "压力来源：礼法与位分限制可做之事，上位者意志可改写规则解释，证据要走对渠道才生效，牵连让退出成本极高",
            "人物策略：借他人之口发难、抢先给事件定性、用规矩逼对方自证；信息权限看谁掌握上位者真实意图、谁能通传消息",
            "反派要有政治理性：保的是位置与后路，被逼急会弃卒、改口径、换审",
            "观众回报是裁决落地：一道命令、一次当众改口、名册增删；克制的胜利同样成立",
            "钩子取向：上位者态度出现可观察偏移、文书出现第二种解释、证人被调走或改口",
            "禁止漂移：不堆古风辞藻代替权力变化；不让全员降智争吵；不让主角无视规矩成本随意越界；不用突然报出头衔替代行为与证据",
        ],
    },
    {
        id: "suspense-rules",
        label: "悬疑规则",
        points: [
            "压力来源：规则、时限、空间、人数都是可数资源，每次试探消耗一样；恐惧来自规则之间互相冲突",
            "人物策略：观察—试探—记录—复用；严格区分谁亲眼看见、谁只是听说、谁在撒谎；懂行者只有半张地图，不一次讲透",
            "观众与人物的信息差（多知一条或少知一条）选定后不要中途更换",
            "观众回报：规则被摸清一格或一次代价被躲过，让恐惧变得更具体",
            "钩子取向：安全线被移动、规则出现例外、同伴行为与规则矛盾；当集先完成一次发现或验证",
            "禁止漂移：不用黑暗与音效充当升级；不随剧情需要临时改写规则；不用旁白替代可见的验证；不让人物做观众都知道不该做的事",
        ],
    },
    {
        id: "family",
        label: "家庭关系",
        points: [
            "压力来源：经济依赖、照护义务、住处、监护与赡养都是可执行筹码，血缘让退出成本极高",
            "人物策略：忍、算账、留证、断绝、公开；加害一方要有自己的合理化叙事，真心认为当年是为了这个家",
            "信息权限：谁知道旧事的完整版本、谁在替谁保守秘密、谁一直以为自己是受益者",
            "观众回报是边界真的移动：一次拒绝没有被撤回、证据到了能拍板的人手里、有人搬了出去；不预设团圆或原谅才是正确结局",
            "钩子取向：照护义务突然到期、旧版本故事被第三方证伪、一直沉默的人开口；不是全家再吵一次什么都没变",
            "禁止漂移：不用更响的责骂代替后果；不让全家合唱同一种谴责；不让哭戏替代选择；不把长辈写成没有诉求的功能人物",
        ],
    },
    {
        id: "child-secret",
        label: "亲子隐秘",
        points: [
            "压力来源：监护权、户口、入学与就医签字都是可执行筹码；血缘可检验，悬念随时可变事实；孩子身体与学业构成硬期限",
            "信息权限开局写死四层：孩子知道多少、隐瞒方、被瞒方、周围人以为的版本；孩子全知/半知/误信中途不改层",
            "孩子必须有自己的具体目标（想留在某所学校、想弄懂某件事），不只是卖萌撮合的道具",
            "观众回报是名分或责任真的落地：签下的字、改掉的紧急联系人、当众被承认的称呼；血缘确认本身不是回报，确认后有人改变行动才是",
            "钩子取向：孩子当众说出大人回避的话、硬期限提前、隐瞒方发现对方其实早知道",
            "禁止漂移：不让孩子说不符合其认知的成人式台词；不用“孩子生病”反复制造同一种压力；不让血缘结果自动等于情感结果；不预设相认才是正确结局",
        ],
    },
    {
        id: "workplace-comedy",
        label: "职场喜剧",
        points: [
            "压力来源：流程、权限、时限、责任归属与背锅链；主角能修问题，但修它要越过一条不该越的权限线",
            "人物策略：先修好再解释、按流程留痕、让别人当场核对；对手常是“程序上正确、实质上推责”的人，不是纯粹的坏人",
            "信息权限：谁能看到系统与文件、谁被隔离在流程之外、谁在伪造进度",
            "观众回报是结果能被第三方当场核对：设备恢复、单据通过、数字对上；地位变化发生在结果之后",
            "钩子取向：修复带来新的责任归属、被跳过的步骤在别处爆开、核对结果逼某人重新站队",
            "禁止漂移：不让同事先夸“天才”；不用飞速滚动的代码代替可核对的操作链；不让能力揭示后没有任何权限变化",
        ],
    },
    {
        id: "identity-swap",
        label: "身份错位",
        points: [
            "压力来源：当前身份限制可做之事，任务有真实时限与后果，暴露的代价具体可算",
            "信息权限是核心资产：谁占用哪个身份、谁知道、谁误信、谁已掌握怀疑的依据；这些变化要记录，不靠对白反复提醒",
            "人物策略：模仿、回避、借他人之口、抢先设定别人的预期",
            "观众回报：任务先推进一格，身份误读随后产生关系余波——有人因误认作出了新的决定",
            "钩子取向：一种识别方式即将失效、怀疑者拿到可验证依据、任务成功却留下必须由本人解释的痕迹",
            "禁止漂移：不让设定梗的重复充当情节；不让误认永远没有代价；删去身份设定后若故事仍成立，说明设定没有代替故事",
        ],
    },
    {
        id: "slice-of-life",
        label: "生活流",
        points: [
            "压力来源：匮乏、时间、面子、误会与照料义务，低烈度但持续；小目标被现实成本卡住，不能放弃也不能硬来",
            "人物策略：将就、请托、攒钱、绕路、终于开口求助；消费能力与说话习惯贴近现实本身就是可信度",
            "观众回报是小事被完成、被放弃或被重新理解：修好了、等到了、还上了；落点可以是安定、遗憾或释然，不要求打脸翻盘",
            "钩子可以温和：一条新消息、一个上门的人、一句没说出口的请求、下一次见面的约定",
            "禁止漂移：不写吃饭睡觉的流水账；不让普通人突然获得巨额资源；不用温馨总结代替细节；不连续多集没有任何目标变化",
        ],
    },
    {
        id: "xianxia",
        label: "仙侠修真",
        points: [
            "压力来源：力量有代价（寿元、根基、反噬、材料稀缺），等级制度决定资源分配，对手同样在修炼、差距会自己变化",
            "人物策略：以巧破力、借势、隐瞒真正底牌、把私怨挂到门规上处理",
            "观众回报是力量差被具体改写：一次越阶、法器易主、禁制被破；长生尺度下的告别比爽点更耐用",
            "钩子取向：代价开始生效、信物出现在不该在的人手里、对手突破或获得外援",
            "禁止漂移：不用设定名词堆代替冲突；不让境界数字自动等于胜负；不为救场临时改写规则；不把突破渡劫变成不需要选择的万能解法",
        ],
    },
    {
        id: "rich-romance",
        label: "豪门婚恋",
        points: [
            "压力来源：婚约、股权、监护、舆论都是可执行约束；经济依赖让离开的成本具体可算",
            "强势一方必须有自己的约束（董事会、长辈、旧承诺），否则只是任性；弱势一方必须有自己的筹码，否则只是受害",
            "观众回报是不对等被具体撬动一格：条款被改、一次公开承认、第一次自己签字；甜的落点要有前置的具体代价",
            "钩子取向：一份条款被行使、家族作出可执行决定（断供、召回、公开）、沉默的人开始提条件",
            "禁止漂移：断供改密码这类手段可同时是关切与控制，不能只留一种解释；不用羞辱升级代替权力变化；不用“其实一直爱你”抹掉已发生的伤害",
        ],
    },
    {
        id: "reunion",
        label: "破镜重圆",
        points: [
            "发动机三件同时成立：当年断裂的真实原因、此刻不能立刻说清的理由（说清就会失去正在争取的东西）、关系之外迫使两人共处的现实压力",
            "先定谁误会了谁：无过失分离、一方误会、双向误会、一方不认识对方，各支打法不同",
            "信息权限分层：谁握完整真相、谁只有一半、谁有理由不说；让第三方握住关键事实是最有效的延迟",
            "观众回报落在当年那件事的具体对应物上：当年没接到的电话以新方式被接起；不默认大团圆，没有任何证明就复合不成立",
            "钩子取向：从刚发生的证明或伤害往下长——可以说清的时机刚错过、知情的第三方决定开口",
            "禁止漂移：不在没有任何证明时让关系恢复；不用失忆同时取消动机与代价；不让“当年”的时空数量随剧情需要无限增长",
        ],
    },
    {
        id: "action-mission",
        label: "动作任务",
        points: [
            "压力来源：地理、时限、体能、工具消耗、暴露程度与对手的学习能力共同施压；每一次前进都要换掉一样东西（时间、隐蔽、退路）",
            "任务要具体到能画在纸上：把谁带出来、把什么送到哪、在几点前打开哪扇门",
            "信息权限决定紧张感：谁有地图、谁的情报已过期、谁不知道队伍少了一个人；观众比人物多知或少知一条，选定后贯穿",
            "观众回报是阶段目标达成同时留下损耗：人被带出来了，但有人受伤、暴露或掉队；纯胜利不产生下一轮压力",
            "钩子取向：路线被封、伤势开始改变行动能力、交接对象没出现、对手依据刚暴露的手法作出预判",
            "禁止漂移：不让动作更大而任务状态不变；不让主角能力上限随剧情浮动；不用剪辑加速代替可追踪的空间关系",
        ],
    },
    {
        id: "system-flow",
        label: "系统流",
        points: [
            "压力来源：任务面板倒计时、积分负债、升级惩罚；系统发布任务带条件与代价，不是白给",
            "人物策略：算计规则漏洞与性价比、藏面板藏身份、用低级权限办高级事",
            "观众回报是数值当场兑现：属性跳涨、任务结算、权限解锁等可见变化",
            "钩子取向：面板弹出新任务指向下一集场景、系统来源成谜逐步揭底",
            "禁止漂移：系统不能万能兜底消除危机、不给无代价奖励、不用面板字幕替代画面动作",
        ],
    },
    {
        id: "apocalypse-survive",
        label: "末世诡异求生",
        points: [
            "压力来源：物资按集数递减、规则类怪物（违反即死）、人比怪物更危险",
            "人物策略：先摸规则再行动、囤物资立据点、用规则反杀诡异",
            "观众回报是废墟中安全屋与充足物资的反差爽感、怪物被规则反噬",
            "钩子取向：新规则纸条或新怪物轮廓在集末出现、据点外传来敲门声",
            "禁止漂移：不写无逻辑血浆屠杀、怪物要有可观察的行为规则、废土灰绿低饱和色调不漂成明亮都市",
        ],
    },
    {
        id: "cute-baby",
        label: "萌宝团宠",
        points: [
            "压力来源：幼童主角资质被低估或身世被弃、资源匮乏的集体（最穷宗门/落魄家庭）",
            "人物策略：萌宝以童言与天赋无心破局、周围强者主动护短层层加码宠爱",
            "观众回报是被集体温柔接住的情绪抚慰、成长速度碾压预期",
            "钩子取向：新成员加入团宠阵营、萌宝无意间触发更大机缘",
            "禁止漂移：萌宝受虐卖惨不超过一集、不让成人阴谋压过治愈基调、团宠要有代价与成长不只被宠",
        ],
    },
    {
        id: "farming-era",
        label: "种田经营",
        points: [
            "压力来源：粮草断绝或家徒四壁的硬生存指标、天灾与人性双重考验",
            "人物策略：用现代知识做生产微创新、逐项解锁开荒→囤粮→集市→商路",
            "观众回报是可视化资产积累：粮仓变满、茅屋换瓦房、账本数字增长",
            "钩子取向：新作物或新手艺在集末露苗头、外来势力盯上产业",
            "禁止漂移：不跳过经营过程直接暴富、年代道具不出穿帮（军大衣、搪瓷缸、二八大杠）、致富线始终压过感情线",
        ],
    },
    {
        id: "war-god",
        label: "战神归来",
        points: [
            "压力来源：主角身份被当众贬损（赘婿/退伍归来受辱）、羞辱者掌握当下话语权",
            "人物策略：隐忍亮牌节奏可控、每次只揭一层身份、用旧部与功绩降维打击",
            "观众回报是身份揭晓瞬间全场态度反转、排场逐级抬升（车队、勋章、大佬行礼）",
            "钩子取向：更高层级旧部在集末现身、新反派不信邪继续挑衅",
            "禁止漂移：不一集亮完全部底牌、不靠头衔口播代替可见信物、受辱必须产生具体后果",
        ],
    },
    {
        id: "big-female-lead",
        label: "大女主事业流",
        points: [
            "压力来源：女主面对结构性压迫（家族获罪/行业排挤/朝堂倾轧）、不靠婚姻关系解困",
            "人物策略：女主全程主动决策、男性角色仅承担对手或下属功能、感情线不占主线",
            "观众回报是每集一个可量化事业进展：夺权、开张、平冤、扩土",
            "钩子取向：更大的局在集末展开、新对手带着新规则登场",
            "禁止漂移：不插入三角恋与雌竞拉扯、不让男主救场、事业目标全剧贯穿不随感情线收束",
        ],
    },
];

// 题材系统提示词组装：卡是校准参考不是硬规则，条目短、可被用户输入覆盖
export function buildScriptSystemPrompt(genreId: string): string {
    const card = GENRE_CARDS.find((item) => item.id === genreId);
    if (!card) return SCRIPT_STRUCTURE_SYSTEM_PROMPT;
    return `${SCRIPT_STRUCTURE_SYSTEM_PROMPT}\n题材校准参考（${card.label}）：以下条目只是校准参考，不是硬规则，与用户剧本内容冲突时以用户剧本为准。${card.points.join("。")}`;
}

export type DramaArtStyle = { id: string; label: string; promptBase: string };

// 十二种画面风格：默认不追加风格段；其余十一种的 promptBase 是可直接拼进提示词的可观察写法，
// 只描述线条、上色、光影、质感特征，不使用“高质量/精美”类空泛词
export const ART_STYLES: DramaArtStyle[] = [
    { id: "default", label: "默认", promptBase: "" },
    { id: "cel", label: "赛璐璐", promptBase: "清晰封闭描边，大色块平涂上色，明暗两档分层，高光边缘锐利，动画胶片质感" },
    { id: "impasto", label: "厚涂", promptBase: "厚重笔刷堆叠上色，边缘柔和过渡，多层光影渐变，油彩肌理可见，体积感强" },
    { id: "flat", label: "平涂", promptBase: "色块均匀填充，细线勾边，无渐变，阴影压成单色剪影，画面干净利落" },
    { id: "guofeng", label: "国风条漫", promptBase: "工笔细线勾形，水墨晕染背景，淡彩罩染上色，构图大量留白，服饰带古典纹样" },
    { id: "anime", label: "日系二次元", promptBase: "线条细腻流畅，柔和渐变上色，人物大眼比例，脸颊红晕，光感明亮通透" },
    { id: "hk-retro", label: "复古港漫", promptBase: "粗黑外轮廓线，硬朗方折衣纹，网点排线阴影，浓烈撞色，笔触粗犷" },
    { id: "watercolor", label: "水彩", promptBase: "水彩湿画晕染，颜色边缘自然渗化，浅色多层叠涂，保留纸纹颗粒" },
    { id: "minimal", label: "极简", promptBase: "几何简化造型，粗细一致的单一勾勒线，三到五色限定配色，大面积留白" },
    { id: "pixar-3d", label: "3D卡通", promptBase: "圆润饱满的3D立体造型，柔和体积光照明，色彩明亮饱和，皮肤带半透明质感，毛发绒感细腻，背景浅景深虚化" },
    { id: "cel-3d", label: "三渲二", promptBase: "3D建模体积感，平涂两档色块上色，细密轮廓描边，阴影边缘硬切，高光锐利集中，整体呈2D动画画面质感" },
    { id: "game-cg", label: "游戏CG", promptBase: "写实倾向的3D渲染，金属皮革布料材质分明，电影级布光，冷暖色温对比，面部光影层次细腻，景深层次清晰" },
];

export type DramaScenePreset = { id: string; label: string; atmosphere: string; excludes: string };

// 场景/世界观预设：atmosphere 为可观察写法的场景陈设/服化道/光色基调，excludes 为单句排除项；
// 在角色四视图 / 分镜图 / 图生视频三个视觉步骤拼入提示词，空选（""）表示不指定场景
export const SCENE_PRESETS: DramaScenePreset[] = [
    { id: "modern-urban", label: "现代都市", atmosphere: "玻璃幕墙写字楼与夜景霓虹，西装晚礼服与都市便装，冷灰金色调", excludes: "画面不出现古装陈设" },
    { id: "ancient-palace", label: "古代宫廷", atmosphere: "深宫宅院红墙金瓦，簪钗罗裙与烛影帷幔，沉郁暖金色调", excludes: "画面不出现现代物件与电器" },
    { id: "ancient-rural", label: "古代乡野边关", atmosphere: "茅屋农田与炊烟集市，粗布麻衣，土黄暖调质朴光", excludes: "画面不出现现代建筑与车辆" },
    { id: "xianxia-cloud", label: "仙侠云海", atmosphere: "悬浮仙山云海与发光法阵流光，汉服广袖与玉簪法器，青金高饱和仙气光效", excludes: "画面不出现现代服饰与电器" },
    { id: "era-80s", label: "八零年代小镇", atmosphere: "供销社老街与二八大杠自行车，军大衣搪瓷缸缝纫机，暖黄胶片颗粒感", excludes: "画面不出现智能手机等当代物件" },
    { id: "apocalypse-waste", label: "末世废土", atmosphere: "城市废墟藤蔓侵蚀，防毒面具与破旧装备，灰绿低饱和色调", excludes: "画面不出现明亮整洁的现代都市陈设" },
    { id: "eerie-city", label: "诡异暗都", atmosphere: "昏暗走廊与白纸灯笼，冷青色调中突兀的暖光", excludes: "画面不出现明亮欢快的配色" },
    { id: "cyber-night", label: "赛博雨夜", atmosphere: "霓虹雨夜与全息广告牌，机械义体，湿滑街面反光，青紫高对比霓虹", excludes: "画面不出现古风与自然田园元素" },
    { id: "campus-day", label: "校园日常", atmosphere: "教室课桌走廊与操场校服，樱花树，明亮清透色调", excludes: "画面不出现社会职场场景陈设" },
];

// 场景 id → 场景预设；未知/空 id 返回 null（等价不追加场景段）
export function resolveScenePreset(sceneId: string): DramaScenePreset | null {
    return SCENE_PRESETS.find((scene) => scene.id === sceneId) || null;
}

// 题材 → 推荐场景映射：选择题材后若用户未手动改过场景则自动联动；键对应 GENRE_CARDS 的 id，无映射的题材不联动
export const GENRE_SCENE_HINTS: Record<string, string> = {
    "palace-intrigue": "ancient-palace",
    "xianxia": "xianxia-cloud",
    "apocalypse-survive": "apocalypse-waste",
    "suspense-rules": "eerie-city",
    "farming-era": "ancient-rural",
    "system-flow": "cyber-night",
    "revenge": "modern-urban",
    "rich-romance": "modern-urban",
    "reunion": "modern-urban",
    "workplace-comedy": "modern-urban",
    "war-god": "modern-urban",
    "big-female-lead": "ancient-palace",
    "cute-baby": "xianxia-cloud",
};

// 自定义画风：用户在第三步填写可观察写法的风格描述，替换画风基底位置
export const CUSTOM_ART_STYLE_ID = "custom";

// 画风 id → 画风对象；未知 id 回落默认（等价不追加风格段）
export function resolveArtStyle(artStyleId: string): DramaArtStyle {
    return ART_STYLES.find((style) => style.id === artStyleId) || ART_STYLES[0];
}

// 画风基底解析：自定义画风取用户填写内容（未填写等价默认），其余按内置画风；
// 角色四视图 / 分镜图 / 图生视频三个视觉步骤统一走这里，保持一处切换三处生效
export function resolveArtStyleBase(artStyleId: string, customArtStyle: string): string {
    if (artStyleId === CUSTOM_ART_STYLE_ID) return customArtStyle.trim();
    return resolveArtStyle(artStyleId).promptBase;
}

export function resolveArtStyleLabel(artStyleId: string): string {
    return artStyleId === CUSTOM_ART_STYLE_ID ? "自定义" : resolveArtStyle(artStyleId).label;
}

export type ShotFrameKind = "narrative" | "dialogue" | "action";

// 镜头级可读性约束词表（按帧型）：只写该帧型最常见的真实可读性风险，不堆万能排除清单
export const FRAME_LEXICON: Record<ShotFrameKind, string[]> = {
    narrative: ["视觉重点清楚，不被氛围层遮挡，前中后景层级分明", "身份锚点清晰可辨，不被氛围层吞没"],
    dialogue: ["面部识别点与目光可辨，背景不争夺注意中心", "关键手势与持物不被画框裁掉"],
    action: ["特效起点与受力点可辨，人物轮廓与特效层次分离", "粒子与碎片不遮挡身份锚点"],
};

// 帧型粗分（不改剧本 JSON schema）：有对白 = 对话镜头；含动作/特效关键词 = 动作帧；其余 = 叙事帧
const ACTION_FRAME_KEYWORDS = /打|击|追|逃|爆|炸|冲|扑|挥|劈|刺|施法|斗|拳|踢|撞|剑气|光刃|火焰|枪|碎|跳|翻滚|闪避|冲击|波|斩|奔/;

export function classifyShotFrame(shot: { description?: string; dialogue?: string }): ShotFrameKind {
    if ((shot.dialogue || "").trim()) return "dialogue";
    if (ACTION_FRAME_KEYWORDS.test(shot.description || "")) return "action";
    return "narrative";
}

// 角色立绘提示词：身份锚点（角色描述）在前 → 立绘构图与纯白背景 → 风格基底 → 场景氛围（可选）→ 四视图一致性
export function buildCharacterImagePrompt(description: string, artStylePromptBase: string, scenePreset?: DramaScenePreset | null): string {
    const style = artStylePromptBase.trim();
    return [
        `${description.trim()}，角色立绘，全身像，纯白背景`,
        ...(style ? [style] : []),
        ...(scenePreset ? [scenePreset.atmosphere] : []),
        "同一角色各视图保持同一时刻、同一造型与同一配色，发型服饰特征完全一致",
    ].join("，");
}

// 分镜图提示词：主体与身份锚点（含出场角色锚点）→ 构图视角 → 光色与材质 → 背景边界 → 风格基底 → 帧型可读性约束 → 场景氛围与排除 → 普适禁止项
export function buildShotImagePrompt(
    shotDescription: string,
    artStylePromptBase: string,
    frameKind: ShotFrameKind = "narrative",
    scenePreset?: DramaScenePreset | null,
    characterAnchors?: string[],
): string {
    const style = artStylePromptBase.trim();
    return [
        shotDescription.trim(),
        "画面主体突出，身份特征清晰可辨",
        ...(characterAnchors?.length ? [`出场角色：${characterAnchors.join("；")}`] : []),
        "构图与视角贴合本镜情绪",
        "光源方向明确，材质区分清晰",
        "画框内只呈现描述中出现的人和物，背景边界清楚",
        ...(style ? [style] : []),
        ...FRAME_LEXICON[frameKind],
        ...(scenePreset ? [scenePreset.atmosphere, scenePreset.excludes] : []),
        "画面无文字，无水印",
    ].join("，");
}

// 图生视频提示词：静态锚点 → 触发 → 主体动作 → 次级反应 → 时长约束 → 运镜 → 终点的因果链；
// 运镜不与人物动作争夺注意力；一条提示词只表达一个主导戏剧变化；不写“保持不变”类无效指令
export function buildShotVideoPrompt(shotDescription: string, artStylePromptBase: string, seconds?: number, scenePreset?: DramaScenePreset | null): string {
    const style = artStylePromptBase.trim();
    return [
        `以当前画面为静态起点，${shotDescription.trim()}`,
        "画面先保持起始状态，由画面内可见的事件触发后才开始动作",
        "主体动作与次级反应按因果先后衔接，不并列罗列",
        ...(seconds ? [`在${seconds}秒内完成全部动作，节奏匹配时长`] : []),
        "运镜要有动机，不与人物动作争夺注意力",
        "结尾停在明确可确认的画面状态，与描述终点一致",
        ...(style ? [style] : []),
        ...(scenePreset ? [scenePreset.atmosphere] : []),
    ].join("，");
}

// 分镜 AI 审查系统提示词：独立评审员视角（未参与当前版本创作，缓解自我偏好偏差），
// 审查清单提炼自本项目剧本规则；每条结论必须引用原文短句作证据；固定三档结论，不做数字打分
export const SHOTS_REVIEW_SYSTEM_PROMPT =
    "你是漫剧分镜的独立评审员，没有参与当前版本的创作，只依据用户提供的文本客观评估，不偏袒、不迁就既有写法。" +
    "审查清单：一对白即行动，每句对白有戏剧目的，没有角色向观众朗读剧情资料；二每场至少改变信息、权力、关系、情绪或风险之一，场尾留下悬念；三一镜一职责，每镜只承担一个主要功能、只有一个主导戏剧变化；四角色身份锚点可见、可生成、可比较，没有空泛词；五画面描述只写镜头起点时刻可见的物理事实（人物、道具与状态），不含心理活动、过程性叙述与不可生成的抽象描述。" +
    "每条结论必须引用原文短句作为证据，没有证据不下结论；只指出文本中真实存在的问题，不追加清单之外的要求。" +
    "严格按以下 JSON 输出，不要输出任何其他文字、注释或代码块标记：" +
    "{\"verdict\":\"pass 或 revise 或 rework\",\"findings\":[{\"severity\":\"blocker 或 major 或 minor 或 note\",\"location\":\"镜号或角色名\",\"evidence\":\"原文短引文\",\"impact\":\"影响\",\"suggestion\":\"修订建议\"}]}" +
    "，verdict 含义：pass 通过、revise 建议修改、rework 需修改；存在 blocker 时 verdict 必须是 rework。";

// 分镜 AI 自动修改系统提示词：按审查 findings 的建议逐镜修改，保持镜头数量与顺序不变，严格输出与输入等长的 JSON
export const SHOTS_AUTOFIX_SYSTEM_PROMPT =
    "你是漫剧分镜的修改助手。用户会给你当前分镜 JSON 与审查结论（每条结论包含位置、证据与修订建议）。修改规则：" +
    "一、按每条结论的建议修改对应镜头；二、保持镜头数量与顺序完全不变；三、不修改结论未涉及的镜头；四、角色名与原文保持一致；五、画面描述保持只写可见特征的可观察写法，不添加“高质量/精美”类空泛词。" +
    "严格按以下 JSON 格式输出，shots 数组长度必须与输入一致，不要输出任何其他文字、注释或代码块标记：" +
    "{\"shots\":[{\"description\":\"\",\"dialogue\":\"\",\"narration\":\"\",\"seconds\":5}]}";

// 全局配音指引（仅作为设置界面的说明文案，不拼进对白文本，避免被 TTS 朗读）：
// 方法论来自 voice-direction.md——声音身份与表演分离、选型判据带反例、易混角色区分、专名发音唯一化
export const VOICE_DIRECTION_GUIDE =
    "配音指引：一、声音身份与表演分开——这里只写稳定的身份特征（音区、音色质感、语速与停顿习惯、口音范围），本场的情绪、气息、重音由对白文本自己承担，不要写进来；" +
    "二、判据要可听且带反例——例如“语速偏慢、句尾收住不拖长”，不写“愤怒、悲伤”这类情绪词；" +
    "三、注意易混角色——同剧中最容易混淆的两个声音，用一条可听差异区分（如一个句尾收住、一个句尾带下滑余音）；" +
    "四、专名发音唯一化——人名、地名只写一种读法，否则 TTS 会在不同条目间改口。";

// 配音说明：TTS 请求只接受对白文本（requestAudioGeneration 无逐条指令参数，instructions 为全局设置），
// 拼接音色方向文字会被多数 TTS 渠道朗读出来，因此不提供配音方向提示构建函数。

// Qoder 通道技能规范目录（MCP 工具 drama_get_skills 数据源）：复用本文件常量作单一来源，
// 供外部大脑（Qoder）在产出剧本 / 分镜 / 角色前拉取对齐，不在适配器或桥内重复维护
export const DRAMA_SHOT_RULES =
    "分镜写法规范：一、画面描述只写镜头起点时刻可见的物理事实（人物、道具与状态），不含心理活动、过程性叙述与不可生成的抽象描述；" +
    "二、一镜一职责，每镜只承担一个主要功能、只有一个主导戏剧变化，每次切镜必须带来信息、权力、情绪、空间或节奏之一的变化；" +
    "三、对白即行动，每句对白有戏剧目的，不让角色向观众朗读剧情资料；每场至少改变信息、权力、关系、情绪或风险之一，场尾留悬念；" +
    "四、每镜时长 seconds 取 1-30 秒；开场镜比工作景别宽一档，地理信息通过人物动作在画面内部交代，不用空镜全景开场；" +
    "五、相邻两镜画面描述不得完全相同；对白与旁白可为空字符串，旁白（画外音）不重复对白与画面已呈现的内容。";

export const DRAMA_CHARACTER_RULES =
    "角色描述规范：只写可观察的外貌特征——发型、发色、五官与体型、服饰件数与材质、标志物等身份锚点，要求可见、可生成、可比较，直接作为立绘提示词基底；" +
    "不写心理活动与性格标签，不使用「气质出众」类空泛词；同名角色沿用已有立绘与视图分配。";

export const DRAMA_SKILL_CATALOG = {
    genres: GENRE_CARDS,
    scenes: SCENE_PRESETS,
    artStyles: ART_STYLES,
    frameLexicon: FRAME_LEXICON,
    shotRules: DRAMA_SHOT_RULES,
    characterRules: DRAMA_CHARACTER_RULES,
};
