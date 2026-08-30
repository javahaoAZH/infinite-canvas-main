import { nanoid } from "nanoid";

import type { DramaProject } from "@/stores/use-drama-store";
import type { DirectorPlan, DirectorPlanOptions, DirectorTask, DirectorTaskStatus } from "@/stores/use-director-store";

export const DEFAULT_DIRECTOR_OPTIONS: DirectorPlanOptions = {
    includeReview: false,
    characterCandidates: 1,
    autoAssignView: true,
    includeAudio: true,
    includeRender: false,
};

const taskKey = (task: Pick<DirectorTask, "kind" | "subjectId">) => `${task.kind}:${task.subjectId}`;

function newTask(kind: DirectorTask["kind"], subjectId: string, label: string, deps: string[] = [], hardDep = false, status: DirectorTaskStatus = "pending"): DirectorTask {
    return { id: nanoid(), kind, subjectId, label, deps, hardDep, status, attempts: 0, maxAttempts: 3 };
}

// 任务分解 + 成本预估；已有产物直接标 success（幂等：重跑只补缺口）
export function buildDirectorPlan(project: DramaProject, options: DirectorPlanOptions): DirectorPlan {
    const tasks: DirectorTask[] = [];
    // 分镜为空时含剧本结构化任务（会重置分镜与已生成媒体）；已有分镜则跳过
    const scriptDeps: string[] = [];
    if (!project.shots.length) {
        const scriptTask = newTask("script", project.id, "剧本结构化", []);
        tasks.push(scriptTask);
        scriptDeps.push(scriptTask.id);
    }
    // 立绘：每角色一个任务，软依赖剧本（无角色参考时分镜图可降级执行）
    const characterTaskIds: string[] = [];
    project.characters.forEach((character) => {
        // 幂等跳过需「候选 + 视图分配」均已就绪；只有候选未分配视图时保持 pending，走自动分配路径（执行时不重复生成候选）
        const ready = character.candidates.length > 0 && Object.keys(character.views).length > 0;
        const task = newTask("character", character.id, `立绘 · ${character.name || "未命名角色"}`, [...scriptDeps], false, ready ? "success" : "pending");
        tasks.push(task);
        characterTaskIds.push(task.id);
    });
    project.shots.forEach((shot, index) => {
        const label = `分镜 ${index + 1}`;
        const imageTask = newTask("shotImage", shot.id, `${label} · 分镜图`, [...scriptDeps, ...characterTaskIds], false, project.shotImages[shot.id] ? "success" : "pending");
        tasks.push(imageTask);
        // 视频硬依赖本镜分镜图：分镜图被跳过时连带跳过
        tasks.push(newTask("shotVideo", shot.id, `${label} · 视频`, [imageTask.id], true, project.shotVideos[shot.id] ? "success" : "pending"));
        if (options.includeAudio) {
            if (shot.dialogue.trim()) tasks.push(newTask("audio", shot.id, `${label} · 对白`, [...scriptDeps], false, project.shotAudios[shot.id] ? "success" : "pending"));
            if ((shot.narration || "").trim()) tasks.push(newTask("audio", `${shot.id}:narration`, `${label} · 旁白`, [...scriptDeps], false, project.shotAudios[`${shot.id}:narration`] ? "success" : "pending"));
        }
    });
    return {
        id: nanoid(),
        projectId: project.id,
        createdAt: new Date().toISOString(),
        status: "draft",
        options,
        estimate: estimatePlan(tasks, options),
        tasks,
    };
}

// 预估公式：文本=结构化(可选)；图像=角色数×候选数+缺图分镜数；视频=待生成视频数；配音=对白+旁白条数；成片 MVP 不自动触发
function estimatePlan(tasks: DirectorTask[], options: DirectorPlanOptions) {
    const pending = (kind: DirectorTask["kind"]) => tasks.filter((task) => task.kind === kind && task.status === "pending").length;
    return {
        text: pending("script"),
        image: pending("character") * options.characterCandidates + pending("shotImage"),
        video: pending("shotVideo"),
        audio: pending("audio"),
        render: 0,
    };
}

// 剧本结构化后项目结构变化（新分镜/角色），按当前项目补齐缺失任务；依赖 id 映射到已有任务，无新增返回 null
export function expandDirectorTasks(plan: DirectorPlan, project: DramaProject): DirectorTask[] | null {
    const fresh = buildDirectorPlan(project, plan.options);
    const existingByKey = new Map(plan.tasks.map((task) => [taskKey(task), task]));
    const freshById = new Map(fresh.tasks.map((task) => [task.id, task]));
    const added: DirectorTask[] = [];
    for (const task of fresh.tasks) {
        if (existingByKey.has(taskKey(task))) continue;
        added.push({
            ...task,
            deps: task.deps.map((depId) => {
                const dep = freshById.get(depId);
                const existingDep = dep ? existingByKey.get(taskKey(dep)) : undefined;
                return existingDep?.id || depId;
            }),
        });
    }
    return added.length ? added : null;
}
