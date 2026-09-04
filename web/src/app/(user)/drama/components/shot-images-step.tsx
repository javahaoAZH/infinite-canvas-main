"use client";

import { BadgeCheck, ImagePlus, Images, LoaderCircle, ShieldCheck, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Empty, Image, Segmented, Tag } from "antd";

import { resolveArtStyleLabel } from "@/app/(user)/drama/prompts";
import { generateShotImage } from "@/app/(user)/drama/services/drama-generation";
import { approvedRepresentativeIds, representativeShotIds } from "@/app/(user)/drama/services/production-readiness";
import { collectCharacterReferences, useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { loadAssetFileBlob } from "@/services/api/drama-assets";
import { getImageBlob, setImageBlob, uploadImage } from "@/services/image-storage";

export function ShotImagesStep({ project, activeView, onViewChange }: { project: DramaProject; activeView: "keyframes" | "storyboards"; onViewChange: (view: "keyframes" | "storyboards") => void }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const token = useUserStore((state) => state.token);
    const artStyle = useDramaStore((state) => state.artStyle);
    const updateProject = useDramaStore((state) => state.updateProject);
    const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [batchRunning, setBatchRunning] = useState(false);
    // 批量停止开关：置 true 后不再派发新任务，在途请求自然结束（与导演台「终止」同语义）
    const batchCancelRef = useRef(false);
    const [mediaStatus, setMediaStatus] = useState<Record<string, "loading" | "ready" | "error">>({});
    const checkedMedia = useRef(new Set<string>());

    useEffect(() => {
        let alive = true;
        const projectName = project.assetProject || project.title;
        project.shots.forEach((shot, index) => {
            const media = project.shotImages[shot.id];
            if (!media) return;
            const mediaKey = media.storageKey || media.url;
            if (checkedMedia.current.has(mediaKey)) return;
            checkedMedia.current.add(mediaKey);
            setMediaStatus((current) => ({ ...current, [mediaKey]: "loading" }));
            void (async () => {
                try {
                    const stored = media.storageKey ? await getImageBlob(media.storageKey).catch(() => null) : null;
                    let repaired = media;
                    if (stored instanceof Blob && stored.size > 0 && stored.type.startsWith("image/")) {
                        repaired = { ...media, url: await setImageBlob(media.storageKey!, stored), bytes: stored.size, mimeType: stored.type };
                    } else {
                        if (!token) throw new Error("本地图片已失效且当前未登录，无法读取项目归档");
                        const path = `分集/${project.episode || "ep01"}/shots/镜头${String(index + 1).padStart(2, "0")}_分镜图.png`;
                        const uploaded = await uploadImage(await loadAssetFileBlob(token, projectName, path), { localOnly: true });
                        repaired = { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType };
                    }
                    if (!alive) return;
                    const currentProject = useDramaStore.getState().projects.find((item) => item.id === project.id);
                    if (currentProject) updateProject(project.id, { shotImages: { ...currentProject.shotImages, [shot.id]: repaired } });
                    setMediaStatus((current) => ({ ...current, [mediaKey]: "ready", [repaired.storageKey || repaired.url]: "ready" }));
                } catch {
                    if (alive) setMediaStatus((current) => ({ ...current, [mediaKey]: "error" }));
                }
            })();
        });
        return () => { alive = false; };
    }, [project.assetProject, project.episode, project.id, project.shotImages, project.shots, project.title, token, updateProject]);

    const runSingle = async (shotId: string) => {
        setBusyIds((current) => ({ ...current, [shotId]: true }));
        setErrors((current) => ({ ...current, [shotId]: "" }));
        try {
            await generateShotImage(project.id, shotId, effectiveConfig);
            maybeAutoApprove(shotId);
        } catch (error) {
            setErrors((current) => ({ ...current, [shotId]: error instanceof Error ? error.message : "分镜图生成失败，可重试" }));
        } finally {
            setBusyIds((current) => ({ ...current, [shotId]: false }));
        }
    };

    const representativeIds = representativeShotIds(project);
    const representativeSet = new Set(representativeIds);
    const approvedIds = approvedRepresentativeIds(project);
    const representativesReady = representativeIds.length > 0 && approvedIds.length === representativeIds.length;

    // 生产审批模式 = auto（设置-生产）时，代表帧生成成功后自动确认，免去逐张手动点击
    const maybeAutoApprove = (shotId: string) => {
        if (effectiveConfig.productionApprovalMode !== "auto" || !representativeSet.has(shotId)) return;
        const current = useDramaStore.getState().projects.find((item) => item.id === project.id);
        if (!current || (current.keyframeApprovals || []).includes(shotId) || !current.shotImages[shotId]) return;
        updateProject(project.id, { keyframeApprovals: [...(current.keyframeApprovals || []), shotId] });
    };

    const runBatch = async (mode: "representative" | "remaining") => {
        if (mode === "remaining" && !representativesReady) return message.warning("请先逐张确认代表关键帧，再批量生成剩余分镜");
        const pending = project.shots.filter((shot) => (mode === "representative" ? representativeSet.has(shot.id) : true) && !project.shotImages[shot.id]);
        if (!pending.length) return message.info(mode === "representative" ? "代表帧已生成，请逐张确认画风、人物和资产一致性" : "所有分镜图都已生成");
        batchCancelRef.current = false;
        setBatchRunning(true);
        let failed = 0;
        for (const shot of pending) {
            if (batchCancelRef.current) break;
            setBusyIds((current) => ({ ...current, [shot.id]: true }));
            setErrors((current) => ({ ...current, [shot.id]: "" }));
            try {
                await generateShotImage(project.id, shot.id, effectiveConfig);
                maybeAutoApprove(shot.id);
            } catch (error) {
                failed += 1;
                setErrors((current) => ({ ...current, [shot.id]: error instanceof Error ? error.message : "分镜图生成失败，可重试" }));
            } finally {
                setBusyIds((current) => ({ ...current, [shot.id]: false }));
            }
        }
        setBatchRunning(false);
        if (batchCancelRef.current) message.info("已停止批量生成：在途请求自然结束，剩余分镜可随时重新发起");
        else message[failed ? "warning" : "success"](failed ? `生成完成，${failed} 个分镜失败，可单独重试` : mode === "representative" ? "代表帧已生成，请逐张确认后再批量" : "全部分镜图生成完成");
    };

    const referenceCount = collectCharacterReferences(project.characters).length;
    const visibleShots = activeView === "keyframes" ? project.shots.filter((shot) => representativeSet.has(shot.id)) : project.shots;

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                    <span>
                        逐分镜生成画面，{referenceCount > 0 ? `已带上 ${referenceCount} 张角色视图；本镜清单中的已确认场景、道具与特效也会自动作为参考。` : "暂无角色视图参考，可回到上一步分配视图；清单资产仍会按镜头自动引用。"}
                    </span>
                    <span className="flex items-center gap-1">
                        画面风格
                        <Tag className="m-0">{resolveArtStyleLabel(artStyle)}</Tag>
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Segmented
                        value={activeView}
                        options={[{ label: `代表帧 ${representativeIds.length}`, value: "keyframes" }, { label: `全部分镜 ${project.shots.length}`, value: "storyboards" }]}
                        onChange={(value) => onViewChange(value as "keyframes" | "storyboards")}
                    />
                    <Button icon={<ShieldCheck className="size-4" />} loading={batchRunning} onClick={() => void runBatch("representative")}>生成代表帧</Button>
                    <Button type="primary" icon={<Images className="size-4" />} loading={batchRunning} disabled={!representativesReady} onClick={() => void runBatch("remaining")}>批量生成剩余</Button>
                    {batchRunning ? <Button danger icon={<Square className="size-4 fill-current" />} onClick={() => { batchCancelRef.current = true; }}>停止</Button> : null}
                </div>
            </div>

            <div className={`border p-3 text-sm ${representativesReady ? "border-emerald-500/35 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : "border-amber-500/35 bg-amber-500/5 text-amber-700 dark:text-amber-300"}`}>
                <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4" />代表帧成本门禁 · 已确认 {approvedIds.length}/{representativeIds.length}</div>
                <p className="mt-1 text-xs opacity-80">系统优先抽取多人、持物、特效和特殊机位镜头做小样。人物、服装、装备、空间关系与画风全部通过后，才开放批量生产。</p>
            </div>

            {project.shots.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分镜，请先完成分镜步骤" className="py-16" />
            ) : (
                <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleShots.map((shot) => {
                        const index = project.shots.findIndex((item) => item.id === shot.id);
                        const media = project.shotImages[shot.id];
                        const mediaState = media ? mediaStatus[media.storageKey || media.url] : undefined;
                        const busy = busyIds[shot.id];
                        const representative = representativeSet.has(shot.id);
                        const approved = approvedIds.includes(shot.id);
                        const imageAspectRatio = media?.width && media?.height ? `${media.width} / ${media.height}` : "16 / 9";
                        return (
                            <div key={shot.id} className={`flex flex-col border bg-card/65 [contain-intrinsic-size:0_460px] [content-visibility:auto] ${representative ? "border-amber-500/55" : "border-border"}`}>
                                <div className="flex w-full items-center justify-center overflow-hidden bg-stone-100 transition-[aspect-ratio] duration-200 dark:bg-stone-800" style={{ aspectRatio: imageAspectRatio }}>
                                    {busy || (media && mediaState !== "ready" && mediaState !== "error") ? (
                                        <LoaderCircle className="size-6 animate-spin text-stone-400" />
                                    ) : media && mediaState === "ready" ? (
                                        <Image key={media.url} src={media.url} alt={`分镜 ${index + 1}`} width="100%" height="100%" rootClassName="!block size-full" className="size-full cursor-zoom-in object-contain" />
                                    ) : mediaState === "error" ? (
                                        <span className="px-4 text-center text-xs text-red-500">归档图片读取失败，请检查项目文件</span>
                                    ) : (
                                        <span className="text-xs text-stone-400 dark:text-stone-500">分镜 {index + 1} · 未生成</span>
                                    )}
                                </div>
                                <div className="flex-1 space-y-2 p-3">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-mono text-[11px] text-muted-foreground">SHOT {String(index + 1).padStart(2, "0")}</span>
                                        {representative ? <Tag color="gold" className="m-0">代表帧</Tag> : null}
                                        {approved ? <Tag color="green" className="m-0" icon={<BadgeCheck className="size-3" />}>已确认</Tag> : null}
                                    </div>
                                    <p className="line-clamp-3 min-h-10 text-xs leading-5 text-stone-600 dark:text-stone-300">{shot.description || "（暂无画面描述）"}</p>
                                    {errors[shot.id] ? <p className="text-xs text-red-500">{errors[shot.id]}</p> : null}
                                    <Button size="small" block icon={<ImagePlus className="size-4" />} loading={busy} disabled={!representative && !representativesReady} onClick={() => void runSingle(shot.id)}>
                                        {media ? "重新生成" : "生成分镜图"}
                                    </Button>
                                    {representative && media ? (
                                        <Button size="small" block type={approved ? "default" : "primary"} icon={<BadgeCheck className="size-4" />} onClick={() => updateProject(project.id, { keyframeApprovals: approved ? (project.keyframeApprovals || []).filter((id) => id !== shot.id) : [...new Set([...(project.keyframeApprovals || []), shot.id])] })}>
                                            {approved ? "撤销确认" : "确认人物、资产与画风"}
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
