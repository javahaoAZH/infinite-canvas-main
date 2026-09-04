import { autoAssignViews, generateCharacterCandidates, generateShotImage, generateVoiceAudio, generateShotVideo, structureScript } from "@/app/(user)/drama/services/drama-generation";
import { syncDramaProjectToCanvas } from "@/app/(user)/drama/services/drama-canvas-sync";
import { expandDirectorTasks } from "@/app/(user)/drama/services/director-planner";
import { getEffectiveConfig } from "@/stores/use-config-store";
import { useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useDirectorStore, type DirectorTask, type DirectorTaskKind } from "@/stores/use-director-store";

// 按 kind 的并发上限：文本 1 / 立绘 1 / 分镜图 2 / 视频 2 / 配音 3；速度档 fast（设置-生产）时加倍
const BASE_CONCURRENCY_CAP: Record<DirectorTaskKind, number> = { script: 1, review: 1, character: 1, shotImage: 2, shotVideo: 2, audio: 3, render: 1 };
const concurrencyCap = (kind: DirectorTaskKind) => (getEffectiveConfig().renderSpeed === "fast" ? BASE_CONCURRENCY_CAP[kind] * 2 : BASE_CONCURRENCY_CAP[kind]);

// 自动重试退避：2s / 5s
const BACKOFF_MS = [2000, 5000];

const TICK_MS = 500;

const activeLoops = new Set<string>();
const cooldownUntil: Record<string, number> = {};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 模块级单例调度入口：同一项目的循环去重；执行器已被其他项目占用时拒绝启动（全局单跑一个项目）
export function startDirector(projectId: string) {
    const runningProjectId = useDirectorStore.getState().runningProjectId;
    if (runningProjectId && runningProjectId !== projectId) return;
    if (activeLoops.has(projectId)) return;
    activeLoops.add(projectId);
    // 生产开始即在画布建立生产线可视化（后续产物由自动同步增量更新）
    syncDramaProjectToCanvas(projectId);
    void directorLoop(projectId).finally(() => activeLoops.delete(projectId));
}

// 用户操作（重试/跳过）后按需重启调度：循环空闲/已退出且仍有 pending 任务时恢复执行；暂停态一并恢复（续跑语义）
export function maybeRestartDirector(projectId: string) {
    const state = useDirectorStore.getState();
    const plan = state.plans[projectId];
    if (!plan) return;
    if (state.runningProjectId && state.runningProjectId !== projectId) return;
    if ((plan.status === "running" || plan.status === "paused") && plan.tasks.some((task) => task.status === "pending")) {
        if (plan.status === "paused") state.resumeRun(projectId);
        startDirector(projectId);
    }
}

async function directorLoop(projectId: string) {
    while (true) {
        const plan = useDirectorStore.getState().plans[projectId];
        if (!plan || plan.status !== "running") return;
        const project = useDramaStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return;
        // 剧本结构化后补齐新增分镜/角色对应的任务
        const added = expandDirectorTasks(plan, project);
        if (added) {
            useDirectorStore.getState().addTasks(projectId, added);
            continue;
        }
        pruneStaleTasks(projectId, project);
        useDirectorStore.getState().cascadeSkip(projectId);
        const current = useDirectorStore.getState().plans[projectId];
        if (!current) return;
        const statusById = new Map(current.tasks.map((task) => [task.id, task.status]));
        // 本 tick 内的派发计数：新派发任务的 running 状态尚未进入快照，需并入并发统计，避免首波放出同类型全部任务
        const dispatched = new Map<DirectorTaskKind, number>();
        for (const task of current.tasks) {
            if (task.status !== "pending") continue;
            if ((cooldownUntil[task.id] || 0) > Date.now()) continue;
            // 依赖就绪：全部成功，或依赖被跳过且为软依赖可降级执行；弱依赖（对白镜配音）只等执行到达终态，成败均放行（A2）
            const ready =
                task.deps.every((depId) => statusById.get(depId) === "success" || (statusById.get(depId) === "skipped" && !task.hardDep)) &&
                (task.softDeps || []).every((depId) => statusById.get(depId) === "success" || statusById.get(depId) === "skipped" || statusById.get(depId) === "failed");
            if (!ready) continue;
            const runningCount = current.tasks.filter((item) => item.kind === task.kind && item.status === "running").length + (dispatched.get(task.kind) || 0);
            if (runningCount >= concurrencyCap(task.kind)) continue;
            dispatched.set(task.kind, (dispatched.get(task.kind) || 0) + 1);
            void runTask(projectId, task.id);
        }
        const latest = useDirectorStore.getState().plans[projectId];
        // 全部任务到达终态（成功/跳过/失败）即完成；失败不自动终止，等用户重试/跳过/终止
        if (latest && latest.status === "running" && latest.tasks.every((task) => task.status === "success" || task.status === "skipped" || task.status === "failed")) {
            useDirectorStore.getState().finishRun(projectId);
            return;
        }
        // 死锁退出：无可派发任务、无在途任务、也没有退避中的重试（如 pending 全被失败依赖阻塞）→ 退出循环，计划状态保持不变，由用户重试/跳过按需重启
        const coolingDown = latest?.tasks.some((task) => task.status === "pending" && (cooldownUntil[task.id] || 0) > Date.now());
        if (dispatched.size === 0 && !coolingDown && !latest?.tasks.some((task) => task.status === "running")) return;
        await sleep(TICK_MS);
    }
}

async function runTask(projectId: string, taskId: string) {
    const task = useDirectorStore.getState().plans[projectId]?.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "pending") return;
    useDirectorStore.getState().setTask(projectId, taskId, { status: "running", attempts: task.attempts + 1, startedAt: Date.now(), error: undefined });
    useDirectorStore.getState().setProgress(taskId, 0);
    try {
        // 每个任务执行时实时读取最新配置与项目状态（配置在 GENERATORS 内部经 getEffectiveConfig 获取）
        // 生成器返回 false = 主体实体已不存在：任务标 skipped，不计 success、不重试；返回 undefined 表示执行成功，继续产物落库质检
        const result = await GENERATORS[task.kind](projectId, task.subjectId, task.id);
        if (result === false) {
            useDirectorStore.getState().setTask(projectId, taskId, { status: "skipped", error: "主体已被删除或重建", finishedAt: Date.now() });
            return;
        }
        if (!verifyProduct(projectId, task)) throw new Error("生成结果为空，已按失败处理");
        useDirectorStore.getState().setTask(projectId, taskId, { status: "success", finishedAt: Date.now() });
    } catch (error) {
        const attempts = useDirectorStore.getState().plans[projectId]?.tasks.find((item) => item.id === taskId)?.attempts ?? task.attempts + 1;
        const errorMessage = error instanceof Error ? error.message : "任务执行失败";
        if (attempts < task.maxAttempts) {
            // 未耗尽重试次数：回到 pending 并按 2s/5s 退避后由循环重新派发
            cooldownUntil[taskId] = Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
            useDirectorStore.getState().setTask(projectId, taskId, { status: "pending", error: errorMessage });
        } else {
            // 失败不阻塞其他无依赖分支，用户可在面板重试/跳过/终止
            useDirectorStore.getState().setTask(projectId, taskId, { status: "failed", error: errorMessage, finishedAt: Date.now() });
        }
    }
}

// 生成器分发表：产物统一写入 drama store 现有媒体表，director 只存任务状态；返回 false 表示主体实体已不存在（任务按跳过处理）
const GENERATORS: Record<DirectorTaskKind, (projectId: string, subjectId: string, taskId: string) => Promise<boolean | void>> = {
    script: async (projectId) => {
        await structureScript(projectId, getEffectiveConfig());
    },
    // 审查节点属增强期，MVP 不会生成该任务
    review: async () => {
        throw new Error("MVP 暂不支持审查任务");
    },
    character: async (projectId, characterId) => {
        const character = useDramaStore.getState().projects.find((item) => item.id === projectId)?.characters.find((item) => item.id === characterId);
        if (!character) return false;
        const options = useDirectorStore.getState().plans[projectId]?.options;
        // 已有候选时不重复生成（避免浪费调用），只补视图分配；幂等跳过以「候选 + 视图均已就绪」为准（见 planner）
        if (!character.candidates.length) {
            await generateCharacterCandidates(projectId, characterId, getEffectiveConfig(), options?.characterCandidates || 1);
        }
        if (options?.autoAssignView !== false) autoAssignViews(projectId, characterId);
    },
    shotImage: async (projectId, shotId) => {
        const shot = useDramaStore.getState().projects.find((item) => item.id === projectId)?.shots.find((item) => item.id === shotId);
        if (!shot) return false;
        await generateShotImage(projectId, shotId, getEffectiveConfig());
    },
    shotVideo: async (projectId, shotId, taskId) => {
        const shot = useDramaStore.getState().projects.find((item) => item.id === projectId)?.shots.find((item) => item.id === shotId);
        if (!shot) return false;
        await generateShotVideo(projectId, shotId, getEffectiveConfig(), (progress) => useDirectorStore.getState().setProgress(taskId, progress));
    },
    audio: async (projectId, audioKey) => {
        const shotId = audioKey.endsWith(":narration") ? audioKey.slice(0, -":narration".length) : audioKey;
        const shot = useDramaStore.getState().projects.find((item) => item.id === projectId)?.shots.find((item) => item.id === shotId);
        if (!shot) return false;
        await generateVoiceAudio(projectId, audioKey, getEffectiveConfig());
    },
    // 成片需登录且依赖手动确认，属增强期，MVP 完成后引导用户去第 6 步手动「一键成片」
    render: async () => {
        throw new Error("MVP 暂不自动合成成片，请到「配音成片」步骤手动一键成片");
    },
};

// 裁剪失效任务：主体（角色 / 分镜 / 配音键对应分镜）已不在项目中且任务仍 pending → 直接跳过，后续由既有硬依赖级联处理下游（不计失败、不空烧重试）
function pruneStaleTasks(projectId: string, project: DramaProject) {
    const plan = useDirectorStore.getState().plans[projectId];
    if (!plan) return;
    const shotIds = new Set(project.shots.map((shot) => shot.id));
    const characterIds = new Set(project.characters.map((character) => character.id));
    const subjectAlive = (task: DirectorTask) => {
        if (task.kind === "script" || task.kind === "review" || task.kind === "render") return true;
        if (task.kind === "character") return characterIds.has(task.subjectId);
        if (task.kind === "audio") return shotIds.has(task.subjectId.endsWith(":narration") ? task.subjectId.slice(0, -":narration".length) : task.subjectId);
        return shotIds.has(task.subjectId);
    };
    const staleIds = new Set(plan.tasks.filter((task) => task.status === "pending" && !subjectAlive(task)).map((task) => task.id));
    if (!staleIds.size) return;
    useDirectorStore.setState((state) => {
        const target = state.plans[projectId];
        if (!target) return state;
        const tasks = target.tasks.map((task): DirectorTask => (staleIds.has(task.id) ? { ...task, status: "skipped", error: "主体已被删除或重建", finishedAt: Date.now() } : task));
        return { plans: { ...state.plans, [projectId]: { ...target, tasks } } };
    });
}

// 质检：生成器未抛错时校验产物确实落库，空结果按失败走重试
function verifyProduct(projectId: string, task: DirectorTask): boolean {
    const project = useDramaStore.getState().projects.find((item) => item.id === projectId);
    if (!project) return false;
    switch (task.kind) {
        case "script":
            return project.shots.length > 0;
        case "character":
            return Boolean(project.characters.find((character) => character.id === task.subjectId)?.candidates.length);
        case "shotImage":
            return Boolean(project.shotImages[task.subjectId]);
        case "shotVideo":
            return Boolean(project.shotVideos[task.subjectId]);
        case "audio":
            return Boolean(project.shotAudios[task.subjectId]);
        default:
            return true;
    }
}
