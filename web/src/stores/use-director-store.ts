"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { buildDirectorPlan } from "@/app/(user)/drama/services/director-planner";
import { localForageStorage } from "@/lib/localforage-storage";
import { useDramaStore } from "@/stores/use-drama-store";

export type DirectorTaskKind = "script" | "review" | "character" | "shotImage" | "shotVideo" | "audio" | "render";
export type DirectorTaskStatus = "pending" | "running" | "success" | "failed" | "skipped";

export type DirectorTask = {
    id: string; // nanoid
    kind: DirectorTaskKind;
    subjectId: string; // character.id / shot.id / 配音键(含 :narration) / projectId
    label: string; // 「分镜 7 · 分镜图」等展示文案
    deps: string[]; // 依赖的任务 id；dep 为 skipped 时按"软/硬依赖"决定是否连带跳过
    softDeps?: string[]; // 弱依赖（对白镜视频→配音）：只等执行完成，成功/跳过/失败均放行，不级联跳过
    hardDep: boolean; // true=依赖产物缺失即无法执行(视频依赖分镜图)；false=可降级执行(分镜图无角色参考)
    status: DirectorTaskStatus;
    attempts: number;
    maxAttempts: number; // 默认 3（首跑1+重试2）
    error?: string;
    startedAt?: number;
    finishedAt?: number;
};

export type DirectorPlanOptions = {
    includeReview: boolean; // 结构化后是否插入文本审查节点（增强期，MVP 不生效）
    characterCandidates: number; // 自动模式立绘候选数，默认 1（成本），可选手动模式 4
    autoAssignView: boolean; // 自动把首选立绘分配到 front 视图，默认 true
    includeAudio: boolean;
    includeRender: boolean; // 成片（需登录，增强期，MVP 不自动触发）
};

export type DirectorPlanEstimate = { text: number; image: number; video: number; audio: number; render: number };

export type DirectorPlan = {
    id: string;
    projectId: string;
    createdAt: string;
    status: "draft" | "confirmed" | "running" | "paused" | "done" | "aborted";
    options: DirectorPlanOptions;
    estimate: DirectorPlanEstimate;
    tasks: DirectorTask[];
};

type DirectorStore = {
    hydrated: boolean;
    plans: Record<string, DirectorPlan>; // key = projectId
    runningProjectId: string | null; // 单例执行器指向的项目
    progress: Record<string, number>; // taskId → 视频生成进度（不持久化）
    buildPlan: (projectId: string, options: DirectorPlanOptions) => DirectorPlan | null;
    confirmPlan: (projectId: string) => void;
    pauseRun: (projectId: string) => void;
    resumeRun: (projectId: string) => void;
    abortRun: (projectId: string) => void;
    skipTask: (projectId: string, taskId: string) => void;
    retryTask: (projectId: string, taskId: string) => void;
    discardPlan: (projectId: string) => void;
    addTasks: (projectId: string, tasks: DirectorTask[]) => void;
    cascadeSkip: (projectId: string) => void;
    setTask: (projectId: string, taskId: string, patch: Partial<DirectorTask>) => void;
    finishRun: (projectId: string) => void;
    setProgress: (taskId: string, value: number) => void;
};

const DIRECTOR_STORE_KEY = "infinite-canvas:director_store";

// 硬依赖的任务在其依赖被跳过时连带跳过，递归级联直到稳定
function cascadeSkippedTasks(tasks: DirectorTask[]): { tasks: DirectorTask[]; changed: boolean } {
    let changed = false;
    let list = tasks;
    let dirty = true;
    while (dirty) {
        dirty = false;
        const statusById = new Map(list.map((task) => [task.id, task.status]));
        list = list.map((task) => {
            if (task.status !== "pending") return task;
            const blocked = task.hardDep && task.deps.some((depId) => statusById.get(depId) === "skipped");
            if (!blocked) return task;
            changed = true;
            dirty = true;
            return { ...task, status: "skipped", error: "依赖任务被跳过", finishedAt: Date.now() };
        });
    }
    return { tasks: list, changed };
}

function patchTasks(plans: Record<string, DirectorPlan>, projectId: string, tasks: DirectorTask[]): Record<string, DirectorPlan> {
    const plan = plans[projectId];
    if (!plan) return plans;
    return { ...plans, [projectId]: { ...plan, tasks } };
}

function patchPlan(plans: Record<string, DirectorPlan>, projectId: string, patch: Partial<DirectorPlan>): Record<string, DirectorPlan> {
    const plan = plans[projectId];
    if (!plan) return plans;
    return { ...plans, [projectId]: { ...plan, ...patch } };
}

const directorStorage: PersistStorage<DirectorStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<DirectorStore>;
        parsed.state.plans = parsed.state.plans || {};
        // 刷新恢复：运行中的任务重置为 pending，运行中的计划降级为暂停（可续跑），在途请求不可续接由重跑兜底
        for (const [projectId, plan] of Object.entries(parsed.state.plans)) {
            parsed.state.plans[projectId] = {
                ...plan,
                status: plan.status === "running" ? "paused" : plan.status,
                tasks: plan.tasks.map((task) => (task.status === "running" ? { ...task, status: "pending", startedAt: undefined } : task)),
            };
        }
        parsed.state.runningProjectId = null;
        parsed.state.progress = {};
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useDirectorStore = create<DirectorStore>()(
    persist(
        (set) => ({
            hydrated: false,
            plans: {},
            runningProjectId: null,
            progress: {},
            buildPlan: (projectId, options) => {
                // 计划基于 drama store 当前最新项目状态生成；已有产物在 planner 内直接标 success（幂等）
                const project = useDramaStore.getState().projects.find((item) => item.id === projectId);
                if (!project) return null;
                const created = buildDirectorPlan(project, options);
                set((state) => ({ plans: { ...state.plans, [projectId]: created } }));
                return created;
            },
            confirmPlan: (projectId) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan || plan.status !== "draft") return state;
                    return { plans: patchPlan(state.plans, projectId, { status: "running" }), runningProjectId: projectId };
                }),
            pauseRun: (projectId) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan || plan.status !== "running") return state;
                    return { plans: patchPlan(state.plans, projectId, { status: "paused" }) };
                }),
            resumeRun: (projectId) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan || plan.status !== "paused") return state;
                    return { plans: patchPlan(state.plans, projectId, { status: "running" }), runningProjectId: projectId };
                }),
            abortRun: (projectId) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan || (plan.status !== "running" && plan.status !== "paused")) return state;
                    return { plans: patchPlan(state.plans, projectId, { status: "aborted" }), runningProjectId: state.runningProjectId === projectId ? null : state.runningProjectId };
                }),
            skipTask: (projectId, taskId) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan) return state;
                    const tasks = plan.tasks.map((task): DirectorTask =>
                        task.id === taskId && (task.status === "failed" || task.status === "pending") ? { ...task, status: "skipped", error: "已手动跳过", finishedAt: Date.now() } : task,
                    );
                    return { plans: patchTasks(state.plans, projectId, cascadeSkippedTasks(tasks).tasks) };
                }),
            retryTask: (projectId, taskId) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan) return state;
                    const target = plan.tasks.find((task) => task.id === taskId);
                    if (!target || target.status !== "failed") return state;
                    const tasks = plan.tasks.map((task): DirectorTask => (task.id === taskId ? { ...task, status: "pending", attempts: 0, error: undefined, startedAt: undefined, finishedAt: undefined } : task));
                    // 已完成/终止的计划重试失败任务时回到 running，由组件侧按需拉起执行器
                    const resume = plan.status === "done" || plan.status === "aborted";
                    return {
                        plans: patchPlan(patchTasks(state.plans, projectId, tasks), projectId, resume ? { status: "running" } : {}),
                        runningProjectId: resume ? projectId : state.runningProjectId,
                    };
                }),
            discardPlan: (projectId) =>
                set((state) => {
                    const plans = { ...state.plans };
                    delete plans[projectId];
                    return { plans };
                }),
            addTasks: (projectId, tasks) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan || !tasks.length) return state;
                    return { plans: patchTasks(state.plans, projectId, [...plan.tasks, ...tasks]) };
                }),
            cascadeSkip: (projectId) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan) return state;
                    const { tasks, changed } = cascadeSkippedTasks(plan.tasks);
                    return changed ? { plans: patchTasks(state.plans, projectId, tasks) } : state;
                }),
            setTask: (projectId, taskId, patch) =>
                set((state) => {
                    const plan = state.plans[projectId];
                    if (!plan) return state;
                    return { plans: patchTasks(state.plans, projectId, plan.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task))) };
                }),
            finishRun: (projectId) =>
                set((state) => ({
                    plans: patchPlan(state.plans, projectId, { status: "done" }),
                    runningProjectId: state.runningProjectId === projectId ? null : state.runningProjectId,
                })),
            setProgress: (taskId, value) => set((state) => ({ progress: { ...state.progress, [taskId]: value } })),
        }),
        {
            name: DIRECTOR_STORE_KEY,
            storage: directorStorage,
            partialize: (state) => ({ plans: state.plans }) as StorageValue<DirectorStore>["state"],
            onRehydrateStorage: () => () => {
                useDirectorStore.setState({ hydrated: true });
            },
        },
    ),
);
