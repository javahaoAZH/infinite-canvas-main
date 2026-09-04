import type { DramaProject, DramaShot } from "@/stores/use-drama-store";

export type ProductionStage = {
    id: "source" | "assets" | "shots" | "masters" | "keyframes" | "storyboards" | "videos" | "finish";
    code: string;
    label: string;
    detail: string;
    ready: boolean;
    step: number;
};

const CONTACT_PATTERN = /握|持|拿|扶|抱|碰|撞|跌|落|翻|拔|挥|斩|刺|穿|托|抓|接/;
const EFFECT_PATTERN = /光|雾|符|阵|火|雷|冰|月华|流光|破碎|倒影|水下|梦|幻/;
const ANGLE_PATTERN = /俯|仰|侧|背|极近|特写|环绕|旋转/;

function shotRisk(shot: DramaShot): number {
    const text = `${shot.description} ${shot.action || ""} ${shot.camera || ""} ${shot.imagePrompt || ""}`;
    return (shot.assetRefs?.length || 0) * 2
        + ((shot.characters?.length || 0) > 1 ? 4 : 0)
        + (CONTACT_PATTERN.test(text) ? 4 : 0)
        + (EFFECT_PATTERN.test(text) ? 3 : 0)
        + (ANGLE_PATTERN.test(text) ? 2 : 0);
}

export function representativeShotIds(project: DramaProject): string[] {
    if (!project.shots.length) return [];
    const count = Math.min(4, project.shots.length, Math.max(2, Math.ceil(project.shots.length * 0.1)));
    return project.shots
        .map((shot, index) => ({ id: shot.id, index, risk: shotRisk(shot) }))
        .sort((a, b) => b.risk - a.risk || a.index - b.index)
        .slice(0, count)
        .map((item) => item.id);
}

export function approvedRepresentativeIds(project: DramaProject): string[] {
    const required = new Set(representativeShotIds(project));
    return (project.keyframeApprovals || []).filter((id) => required.has(id) && Boolean(project.shotImages[id]));
}

export function productionStages(project: DramaProject): ProductionStage[] {
    const sourceReady = Boolean(project.sourceCoverage?.length)
        && project.sourceCoverage!.every((item) => item.quote.trim() && item.disposition && (item.disposition === "暂不采用" ? item.note?.trim() : item.shotNumbers.length));
    const plannedKeys = new Set((project.plannedAssets || []).map((asset) => asset.key));
    const assetReady = Boolean(project.plannedAssets?.length)
        && plannedKeys.size === project.plannedAssets!.length
        && project.plannedAssets!.every((asset) => asset.key.trim() && asset.name.trim() && asset.sourceEvidence.trim() && asset.specification.trim() && asset.lock.trim() && asset.deliverables.length
            && asset.dependencies.every((dependency) => dependency !== asset.key && plannedKeys.has(dependency)));
    const assetKeys = plannedKeys;
    const shotReady = Boolean(project.shots.length)
        && project.shots.every((shot) => shot.sourceEvidence?.trim() && shot.location?.trim() && shot.storyTime?.trim() && shot.shotPurpose?.trim() && shot.startState?.trim() && shot.endState?.trim() && shot.continuity?.trim()
            && Array.isArray(shot.characters) && shot.imagePrompt?.trim() && shot.videoPrompt?.trim() && shot.qualityCriteria?.trim()
            && shot.assetRefs?.length && shot.assetRefs.every((ref) => assetKeys.has(ref.key) && ref.purpose.trim()));
    const usedCharacters = project.characters.filter((character) => project.shots.some((shot) => shot.characters?.includes(character.name)));
    const mastersReady = Boolean(project.plannedAssets?.length) && usedCharacters.every((character) => Object.values(character.views).some(Boolean));
    const representatives = representativeShotIds(project);
    const approved = approvedRepresentativeIds(project);
    const keyframesReady = Boolean(representatives.length) && approved.length === representatives.length;
    const storyboardsReady = Boolean(project.shots.length) && project.shots.every((shot) => Boolean(project.shotImages[shot.id]));
    const videosReady = Boolean(project.shots.length) && project.shots.every((shot) => Boolean(project.shotVideos[shot.id]));
    const voicedShots = project.shots.filter((shot) => shot.dialogue.trim() || (shot.narration || "").trim());
    const finishReady = videosReady && voicedShots.every((shot) => (
        (!shot.dialogue.trim() || Boolean(project.shotAudios[shot.id]))
        && (!(shot.narration || "").trim() || Boolean(project.shotAudios[`${shot.id}:narration`]))
    ));
    return [
        { id: "source", code: "G0", label: "原文覆盖", detail: sourceReady ? `${project.sourceCoverage!.length} 条信息有去向` : "先完成全文拆解与事实分级", ready: sourceReady, step: 0 },
        { id: "assets", code: "G1", label: "资产规划", detail: assetReady ? `${project.plannedAssets!.length} 项生产资产` : "补齐母版、状态、姿态和交付件", ready: assetReady, step: 1 },
        { id: "masters", code: "G2", label: "资产确认", detail: mastersReady ? "角色身份参考已就绪" : "到资产清单完成版本确认", ready: mastersReady, step: 2 },
        { id: "shots", code: "G3", label: "连续性分镜", detail: shotReady ? `${project.shots.length} 镜起止状态完整` : "补齐职责、起止态和逐镜引用", ready: shotReady, step: 1 },
        { id: "keyframes", code: "G4", label: "代表关键帧", detail: `${approved.length}/${representatives.length} 镜确认`, ready: keyframesReady, step: 3 },
        { id: "storyboards", code: "G5", label: "分镜批产", detail: `${project.shots.filter((shot) => project.shotImages[shot.id]).length}/${project.shots.length} 张`, ready: storyboardsReady, step: 3 },
        { id: "videos", code: "G5", label: "动态镜头", detail: `${project.shots.filter((shot) => project.shotVideos[shot.id]).length}/${project.shots.length} 条`, ready: videosReady, step: 4 },
        { id: "finish", code: "G5", label: "配音成片", detail: finishReady ? "素材已齐，可合成" : "等待视频与配音", ready: finishReady, step: 5 },
    ];
}
