// 漫剧生产线 → 画布实时同步：把剧本、角色立绘、分镜、分镜图、视频、配音落成画布节点，
// 用连线还原「剧本 → 分镜 → 分镜图 → 视频 / 配音」的工作流，让生产过程在画布上一目了然。
// 节点 id 由漫剧实体 id 稳定派生，重复同步原地更新而不重复建节点；用户在画布中自建的其他节点不受影响。
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/app/(user)/canvas/types";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useDirectorStore, type DirectorTask } from "@/stores/use-director-store";
import { useDramaStore, type DramaMedia, type DramaProject } from "@/stores/use-drama-store";
import { comfyStatusSignature, getComfyStatusSnapshot, initComfyStatusWatcher, subscribeComfyStatus, type ComfyStatusSnapshot } from "./comfy-status";

// 漫剧同步节点统一前缀：既用于识别旧节点做原地重建，也用于连线归属
const syncPrefix = (projectId: string) => `drama-sync:${projectId}:`;

// 分镜列布局常量：每个镜头一列，列内自上而下为 文本→分镜图→视频→配音
const SHOT_BASE_X = 560;
const COL_WIDTH = 470;
const ROW_TEXT_Y = 0;
const ROW_IMAGE_Y = 260;
const ROW_VIDEO_Y = 540;
const ROW_DIALOGUE_Y = 820;
const ROW_NARRATION_Y = 990;

// 生产键（角色/分镜图/分镜视频/配音键）的忙碌态：忙碌登记或导演台任务在途时为生成中
type GenerationBusy = { startedAt: number; progress?: number };

// 参与画布忙碌推导的导演台任务类型（剧本/审查/成片不落媒体节点，不参与）
const mediaTaskKinds = ["character", "shotImage", "shotVideo", "audio"];
const isMediaTask = (task: DirectorTask) => mediaTaskKinds.includes(task.kind);

function imageMeta(media: DramaMedia): CanvasNodeMetadata {
    return { content: media.url, storageKey: media.storageKey, status: "success", naturalWidth: media.width, naturalHeight: media.height, bytes: media.bytes, mimeType: media.mimeType };
}

function videoMeta(media: DramaMedia): CanvasNodeMetadata {
    return { content: media.url, storageKey: media.storageKey, status: "success", naturalWidth: media.width, naturalHeight: media.height, bytes: media.bytes, mimeType: media.mimeType || "video/mp4", durationMs: media.durationMs };
}

function audioMeta(media: DramaMedia): CanvasNodeMetadata {
    return { content: media.url, storageKey: media.storageKey, status: "success", bytes: media.bytes, mimeType: media.mimeType || "audio/mpeg", durationMs: media.durationMs };
}

// 算力状态节点文案：运行中任务数 + 累计完成/失败 + 当前工作流与桶化进度；空闲/失联也给明确提示便于用户感知连接
function comfyStatusContent(snapshot: ComfyStatusSnapshot | null): string {
    if (!snapshot) return "算力服务器未连接（打开工作流弹窗或启动生产后自动刷新）";
    if (!snapshot.reachable) return "算力服务器暂不可达，稍后自动重试";
    if (snapshot.running.length === 0) return `算力服务器空闲\n累计完成 ${snapshot.completed} · 失败 ${snapshot.failed}`;
    const lines = [
        `运行中任务 ${snapshot.running.length} 个 · 累计完成 ${snapshot.completed} · 失败 ${snapshot.failed}`,
        ...snapshot.running.slice(0, 3).map((job) => {
            const name = job.workflow || job.kind || job.jobId;
            const node = job.currentNode ? ` · 节点 ${job.currentNode}` : "";
            return `${job.status === "queued" ? "排队" : "执行"} ${name} ${Math.floor(job.progress / 10) * 10}%${node}`;
        }),
    ];
    if (snapshot.running.length > 3) lines.push(`其余 ${snapshot.running.length - 3} 个任务省略`);
    return lines.join("\n");
}

// 「生成中」占位节点 metadata：进度无则省略，渲染侧统一走 status === "loading" 分支
function loadingMeta(busy: GenerationBusy): CanvasNodeMetadata {
    return { status: "loading", startedAt: busy.startedAt, ...(busy.progress !== undefined ? { progress: busy.progress } : {}) };
}

// 由漫剧项目构建目标节点与连线（全部使用稳定 id，可重复调用）
function buildDramaCanvasGraph(project: DramaProject): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const prefix = syncPrefix(project.id);
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    const conn = (fromNodeId: string, toNodeId: string) => connections.push({ id: `${prefix}c:${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId });

    // 忙碌/失败推导：优先生成函数的忙碌登记（手动步骤与导演台共用），其次导演台任务状态；进度取导演台视频进度并按 10 桶化
    const directorState = useDirectorStore.getState();
    const directorTasks = (directorState.plans[project.id]?.tasks || []).filter(isMediaTask);
    const busyMedia = useDramaStore.getState().busyMedia;
    const failedMedia = useDramaStore.getState().failedMedia;
    const generationBusy = (kind: string, subjectId: string): GenerationBusy | null => {
        const busy = busyMedia[`${project.id}:${kind}:${subjectId}`];
        const tasks = directorTasks.filter((task) => task.kind === kind && task.subjectId === subjectId);
        const activeTask = tasks.find((task) => task.status === "running" || task.status === "pending");
        if (!busy && !activeTask) return null;
        let progress: number | undefined;
        for (const task of tasks) {
            const value = directorState.progress[task.id];
            if (typeof value === "number") progress = Math.floor(value / 10) * 10;
        }
        return { startedAt: busy?.startedAt || activeTask?.startedAt || Date.now(), ...(progress !== undefined ? { progress } : {}) };
    };
    const generationError = (kind: string, subjectId: string): string | undefined => {
        const key = `${project.id}:${kind}:${subjectId}`;
        if (busyMedia[key]) return undefined;
        // 手动失败登记优先（生成函数 catch 写入的真实错误），再回退导演台任务状态（B9）
        const manualFailed = failedMedia[key];
        if (manualFailed) return manualFailed.error || "生成失败";
        const failed = directorTasks.filter((task) => task.kind === kind && task.subjectId === subjectId).find((task) => task.status === "failed");
        return failed?.error || (failed ? "生成失败" : undefined);
    };

    const scriptId = `${prefix}script`;
    const hasScript = Boolean(project.script.trim());
    if (hasScript) {
        nodes.push({ id: scriptId, type: CanvasNodeType.Text, title: `${project.title} · 剧本`, position: { x: 0, y: 0 }, width: 420, height: 320, metadata: { content: project.script.trim(), status: "success" } });
    }

    // 3D 场景与导演台节点 id 先行定义：角色立绘 / 分镜图成功后连入导演台，把资产喂给 3D 导演台
    const panoramaId = `${prefix}pano`;
    const directorId = `${prefix}director`;

    // 角色立绘：放在最左列（剧本下方），每个角色一张首选立绘；无产物但忙碌/失败时输出占位节点
    project.characters.forEach((character, index) => {
        const id = `${prefix}char:${character.id}`;
        const position = { x: 0, y: 380 + index * 270 };
        const media = character.views.front || character.candidates[0];
        const title = `角色 · ${character.name || index + 1}`;
        if (media) {
            nodes.push({ id, type: CanvasNodeType.Image, title, position, width: 300, height: 230, metadata: imageMeta(media) });
            conn(id, directorId);
        } else {
            const busy = generationBusy("character", character.id);
            const error = busy ? undefined : generationError("character", character.id);
            if (!busy && !error) return;
            nodes.push({ id, type: CanvasNodeType.Image, title: busy ? `${title} · 生成中` : title, position, width: 300, height: 230, metadata: busy ? loadingMeta(busy) : { status: "error", errorDetails: error } });
        }
        if (hasScript) conn(scriptId, id);
    });

    // 3D 场景与导演台：场景全景节点用于生成等距柱状全景，连到 3D 导演台作环境背景，把 3D 能力接入生产工作流
    const characterCount = project.characters.filter((character) => character.views.front || character.candidates[0]).length;
    const sceneY = 380 + characterCount * 270 + 40;
    const sceneHint = project.shots[0]?.description.trim() || project.title;
    nodes.push({ id: panoramaId, type: CanvasNodeType.Panorama, title: "场景全景 · 供 3D 导演台", position: { x: 0, y: sceneY }, width: 340, height: 170, metadata: { content: "", status: "idle", size: "2:1", panoramaSourcePrompt: sceneHint } });
    nodes.push({ id: directorId, type: CanvasNodeType.Director, title: "3D 导演台", position: { x: 380, y: sceneY - 60 }, width: 360, height: 320, metadata: { status: "idle" } });
    if (hasScript) conn(scriptId, panoramaId);
    conn(panoramaId, directorId);

    // 算力状态节点：放在导演台右侧，展示算力服务器 ComfyUI 队列实时摘要（快照变化经签名触发防抖重建）
    nodes.push({ id: `${prefix}comfy`, type: CanvasNodeType.Text, title: "算力状态", position: { x: 780, y: sceneY - 60 }, width: 340, height: 190, metadata: { content: comfyStatusContent(getComfyStatusSnapshot()), status: "success" } });

    // 分镜：每个镜头一列
    project.shots.forEach((shot, index) => {
        const x = SHOT_BASE_X + index * COL_WIDTH;
        const textId = `${prefix}shot:${shot.id}`;
        const content = [`镜头 ${index + 1}（约 ${shot.seconds}s）`, shot.description.trim(), shot.dialogue.trim() ? `对白：${shot.dialogue.trim()}` : "", (shot.narration || "").trim() ? `旁白：${(shot.narration || "").trim()}` : ""].filter(Boolean).join("\n");
        nodes.push({ id: textId, type: CanvasNodeType.Text, title: `分镜 ${index + 1}`, position: { x, y: ROW_TEXT_Y }, width: 360, height: 220, metadata: { content, status: "success" } });
        if (hasScript) conn(scriptId, textId);

        const image = project.shotImages[shot.id];
        const video = project.shotVideos[shot.id];
        const imageId = `${prefix}img:${shot.id}`;
        const videoId = `${prefix}vid:${shot.id}`;
        const imageBusy = image ? null : generationBusy("shotImage", shot.id);
        const imageError = image || imageBusy ? undefined : generationError("shotImage", shot.id);
        const hasImageNode = Boolean(image || imageBusy || imageError);
        if (image) {
            nodes.push({ id: imageId, type: CanvasNodeType.Image, title: `分镜图 ${index + 1}`, position: { x, y: ROW_IMAGE_Y }, width: 360, height: 250, metadata: imageMeta(image) });
            conn(imageId, directorId);
        } else if (imageBusy || imageError) {
            nodes.push({ id: imageId, type: CanvasNodeType.Image, title: imageBusy ? `分镜图 ${index + 1} · 生成中` : `分镜图 ${index + 1}`, position: { x, y: ROW_IMAGE_Y }, width: 360, height: 250, metadata: imageBusy ? loadingMeta(imageBusy) : { status: "error", errorDetails: imageError } });
        }
        if (hasImageNode) conn(textId, imageId);

        const videoBusy = video ? null : generationBusy("shotVideo", shot.id);
        const videoError = video || videoBusy ? undefined : generationError("shotVideo", shot.id);
        if (video || videoBusy || videoError) {
            nodes.push({
                id: videoId,
                type: CanvasNodeType.Video,
                title: videoBusy ? `视频 ${index + 1} · 生成中` : `视频 ${index + 1}`,
                position: { x, y: hasImageNode ? ROW_VIDEO_Y : ROW_IMAGE_Y },
                width: 420,
                height: 236,
                metadata: video ? videoMeta(video) : videoBusy ? loadingMeta(videoBusy) : { status: "error", errorDetails: videoError },
            });
            conn(hasImageNode ? imageId : textId, videoId);
        }

        const dialogue = project.shotAudios[shot.id];
        const dialogueBusy = dialogue ? null : generationBusy("audio", shot.id);
        const dialogueError = dialogue || dialogueBusy ? undefined : generationError("audio", shot.id);
        if (dialogue || dialogueBusy || dialogueError) {
            const audioId = `${prefix}aud:${shot.id}`;
            nodes.push({ id: audioId, type: CanvasNodeType.Audio, title: dialogueBusy ? `对白配音 ${index + 1} · 生成中` : `对白配音 ${index + 1}`, position: { x, y: ROW_DIALOGUE_Y }, width: 360, height: 150, metadata: dialogue ? audioMeta(dialogue) : dialogueBusy ? loadingMeta(dialogueBusy) : { status: "error", errorDetails: dialogueError } });
            conn(textId, audioId);
        }
        const narration = project.shotAudios[`${shot.id}:narration`];
        const narrationBusy = narration ? null : generationBusy("audio", `${shot.id}:narration`);
        const narrationError = narration || narrationBusy ? undefined : generationError("audio", `${shot.id}:narration`);
        if (narration || narrationBusy || narrationError) {
            const audioId = `${prefix}audn:${shot.id}`;
            nodes.push({ id: audioId, type: CanvasNodeType.Audio, title: narrationBusy ? `旁白配音 ${index + 1} · 生成中` : `旁白配音 ${index + 1}`, position: { x, y: ROW_NARRATION_Y }, width: 360, height: 150, metadata: narration ? audioMeta(narration) : narrationBusy ? loadingMeta(narrationBusy) : { status: "error", errorDetails: narrationError } });
            conn(textId, audioId);
        }
    });

    return { nodes, connections };
}

// 同步单个漫剧项目到其关联画布：无关联则创建并回填，随后原地重建漫剧节点（保留用户自建内容）
export function syncDramaProjectToCanvas(projectId: string): string | null {
    const project = useDramaStore.getState().projects.find((item) => item.id === projectId);
    if (!project) return null;
    if (!useCanvasStore.getState().hydrated) return null;

    let canvasProjectId = project.canvasProjectId || "";
    let target = canvasProjectId ? useCanvasStore.getState().projects.find((item) => item.id === canvasProjectId) : undefined;
    if (!target) {
        canvasProjectId = useCanvasStore.getState().createProject(`${project.title} · 生产线`);
        useDramaStore.getState().updateProject(projectId, { canvasProjectId });
        target = useCanvasStore.getState().projects.find((item) => item.id === canvasProjectId);
    }
    if (!target) return null;

    const prefix = syncPrefix(projectId);
    const { nodes: dramaNodes, connections: dramaConnections } = buildDramaCanvasGraph(project);
    const dramaNodeIds = new Set(dramaNodes.map((node) => node.id));

    // 保留用户自建节点；剔除旧的漫剧同步节点后重建，避免重复
    const keepNodes = target.nodes.filter((node) => !node.id.startsWith(prefix));
    const finalNodeIds = new Set([...keepNodes.map((node) => node.id), ...dramaNodeIds]);
    const keepConnections = target.connections.filter((connection) => !connection.id.startsWith(prefix) && finalNodeIds.has(connection.fromNodeId) && finalNodeIds.has(connection.toNodeId));

    useCanvasStore.getState().updateProject(canvasProjectId, {
        nodes: [...keepNodes, ...dramaNodes],
        connections: [...keepConnections, ...dramaConnections],
    });
    return canvasProjectId;
}

// 自动同步签名：只有脚本/分镜/媒体表/忙碌登记/导演台任务状态/桶化进度真正变化才重新同步，避免频繁空转与每次进度回调重建
let lastSignature = "";
function projectSignature(project: DramaProject): string {
    const busyKeys = Object.keys(useDramaStore.getState().busyMedia)
        .filter((key) => key.startsWith(`${project.id}:`))
        .sort()
        .join(",");
    const tasks = (useDirectorStore.getState().plans[project.id]?.tasks || []).filter(isMediaTask);
    const taskDigest = tasks.map((task) => `${task.kind}|${task.subjectId}|${task.status}`).join(";");
    const progress = useDirectorStore.getState().progress;
    const progressDigest = tasks
        .map((task) => {
            const value = progress[task.id];
            return typeof value === "number" ? `${task.subjectId}:${Math.floor(value / 10) * 10}` : "";
        })
        .filter(Boolean)
        .join(";");
    return [
        project.script,
        project.shots.map((shot) => `${shot.id}|${shot.description}|${shot.dialogue}|${shot.narration || ""}|${shot.seconds}`).join(";"),
        Object.keys(project.shotImages).join(","),
        Object.keys(project.shotVideos).join(","),
        Object.keys(project.shotAudios).join(","),
        project.characters.map((character) => `${character.id}:${character.candidates.length}:${Object.keys(character.views).length}`).join(";"),
        busyKeys,
        taskDigest,
        progressDigest,
        comfyStatusSignature(),
    ].join("\u0001");
}

let autoSyncInitialized = false;
// 按 projectId 各自持一个防抖定时器：切换项目时旧项目的待发同步不丢（B11）
const autoSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

// 签名变化时统一走同一防抖触发；导演台订阅与漫剧订阅共用
function scheduleAutoSync(projectId: string) {
    const previous = autoSyncTimers.get(projectId);
    if (previous) clearTimeout(previous);
    autoSyncTimers.set(projectId, setTimeout(() => {
        autoSyncTimers.delete(projectId);
        const current = useDramaStore.getState().projects.find((item) => item.id === projectId);
        if (!current) return;
        const hasPlan = Boolean(useDirectorStore.getState().plans[current.id]);
        if (!current.canvasProjectId && !hasPlan) return;
        syncDramaProjectToCanvas(current.id);
    }, 300));
}

function autoSyncOnChange(projectId: string | null) {
    if (!projectId) return;
    const project = useDramaStore.getState().projects.find((item) => item.id === projectId);
    if (!project) return;
    // 仅在生产中或已关联画布时自动同步，避免给从未使用画布的项目凭空建档
    const signature = projectSignature(project);
    if (signature === lastSignature) return;
    lastSignature = signature;
    scheduleAutoSync(project.id);
}

// 初始化自动同步：监听漫剧与导演台两个 store，活跃项目在「生产中」或「已关联画布」时实时同步。幂等，可重复调用。
export function initDramaCanvasAutoSync() {
    if (autoSyncInitialized) return;
    autoSyncInitialized = true;
    useDramaStore.subscribe((state) => autoSyncOnChange(state.activeId));
    useDirectorStore.subscribe(() => autoSyncOnChange(useDramaStore.getState().activeId));
    // 算力状态轮询器：生产期间自动启停；快照变化复用同一防抖入口触发重建（内部已并入签名比对）
    initComfyStatusWatcher();
    subscribeComfyStatus(() => autoSyncOnChange(useDramaStore.getState().activeId));
}
