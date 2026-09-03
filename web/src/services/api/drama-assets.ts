import { apiGet, apiPost } from "./request";

// 项目资产清单（D 盘项目文件夹为唯一事实源）：三区分离＝浏览器 store 工作区 / 清单+文件夹发布区 / history 历史区
export type AssetVersion = { 版本: string; 状态?: string; 文件?: string[]; 预览?: string; 源?: string; 时间?: string; 备注?: string };
export type AssetReview = { 轮次: number; 审核人?: string; 结论: string; 意见?: string; 时间?: string };
export type AssetEntry = {
    编号: string;
    分类: string;
    名称: string;
    规格?: unknown;
    优先级?: string;
    状态?: string;
    当前版本?: string;
    版本?: AssetVersion[];
    审核?: AssetReview[];
    依据?: string;
    锁定段?: string;
    依赖?: string[];
    用于?: string[];
    模型?: string;
    更新?: string;
};
// 季集规划表：键名与清单 JSON 一致（中文），旧英文键名从未落盘，界面读不到值
export type SeasonAct = { 幕: string; 章节?: string; 集数?: number };
export type SeasonInfo = { 季: string; 章节?: string; 集数?: number; 幕?: SeasonAct[]; 备注?: string };
// 分集分镜（制作分镜表）：季→集→镜头。字段分两侧——
// 浏览器工作区侧（由 drama_episode_export 从实时分镜覆盖）：描述/对白/旁白/秒/景别/运镜/转场/动作/情绪/出场角色/出图提示词/图生视频提示词；
// 清单策划侧（导出时按镜号原样保留）：场景/音效/音乐/帧类型/情绪强度/所属节拍/质检标准/所需资产/产物
export type ShotRecord = {
    镜号: number;
    场?: string;
    场景?: string;
    描述?: string;
    对白?: string;
    旁白?: string;
    秒?: number;
    景别?: string;
    运镜?: string;
    转场?: string;
    动作?: string;
    情绪?: string;
    出场角色?: string[];
    出图提示词?: string;
    图生视频提示词?: string;
    音效?: string;
    音乐?: string;
    帧类型?: string;
    情绪强度?: string;
    所属节拍?: string;
    质检标准?: string;
    所需资产?: string[];
    推荐模型?: string;
    状态?: string;
    产物?: { 分镜图?: string; 视频?: string; 对白?: string; 旁白?: string };
};
export type EpisodeBoard = { 集: string; 季?: string; 幕?: string; 标题?: string; 镜头?: ShotRecord[] };
export type AssetManifest = { schema?: number; 项目?: string; 更新?: string; 条目?: AssetEntry[]; 模型策略?: Record<string, string>; 季集?: SeasonInfo[]; 分集?: EpisodeBoard[] };
export type EpisodeAssetCheck = {
    集: string;
    缺产出: AssetEntry[];
    未确认: AssetEntry[];
    依赖阻塞: Array<{ 条目: string; 依赖: string; 依赖状态: string }>;
    可开工: boolean;
};

export const ASSET_CATEGORIES = ["角色", "场景", "道具", "生物", "特效", "图形"];
export const ASSET_STATUSES = ["待产出", "制作中", "待审核", "需修改", "已确认", "已归档"];
export const ASSET_PRIORITIES = ["P0", "P1", "P2", "P3"];

export function fetchAssetManifest(token: string, project: string) {
    return apiGet<AssetManifest>("/api/v1/drama-assets/manifest", { project }, token);
}

// 本地媒体根目录下项目文件夹列表（资产绑定选择源）
export function listAssetProjects(token: string) {
    return apiGet<{ projects: string[] }>("/api/v1/drama-assets/projects", undefined, token);
}

export function upsertAssetEntry(token: string, project: string, entry: Partial<AssetEntry>) {
    return apiPost<AssetEntry>("/api/v1/drama-assets/entry", { project, entry }, token);
}

export function reviewAssetEntry(token: string, project: string, id: string, reviewer: string, conclusion: "已确认" | "需修改", comment: string) {
    return apiPost<AssetEntry>("/api/v1/drama-assets/review", { project, id, reviewer, conclusion, comment }, token);
}

export function writeAssetProjectFile(token: string, project: string, path: string, text: string) {
    return apiPost<{ written: boolean; path: string }>("/api/v1/drama-assets/file", { project, path, text }, token);
}

export function checkEpisodeAssets(token: string, project: string, episode: string) {
    return apiGet<EpisodeAssetCheck>("/api/v1/drama-assets/check", { project, episode }, token);
}

// 写入/更新某集分集分镜（按 集 合并进清单 分集）
export function upsertEpisodeBoard(token: string, project: string, board: EpisodeBoard) {
    return apiPost<EpisodeBoard>("/api/v1/drama-assets/episode", { project, board }, token);
}

// 绑定生成产物为新版本（multipart 直传后端落盘）
export async function bindAssetFiles(token: string, project: string, id: string, files: Array<{ blob: Blob; name: string }>, note: string, source?: string) {
    const formData = new FormData();
    formData.append("project", project);
    formData.append("id", id);
    formData.append("note", note);
    files.forEach((file) => formData.append("files", file.blob, file.name));
    if (source) formData.append("source", new Blob([source], { type: "application/json" }), "source.json");
    const response = await fetch("/api/v1/drama-assets/bind", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string; data?: AssetEntry } | null;
    if (!response.ok || payload?.code !== 0 || !payload.data) throw new Error(payload?.msg || "产物绑定失败");
    return payload.data;
}

// 受控路径文件拉取（鉴权在 header，img/video 标签无法带 header，统一 fetch 成 blob URL）
export async function loadAssetFileObjectUrl(token: string, project: string, path: string): Promise<string> {
    const response = await fetch(`/api/v1/drama-assets/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("资产文件读取失败");
    return URL.createObjectURL(await response.blob());
}

export function entryCurrentFiles(entry: AssetEntry): string[] {
    const current = (entry.版本 || []).find((version) => version.版本 === entry.当前版本);
    return current?.文件 || [];
}
