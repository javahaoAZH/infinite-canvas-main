"use client";

import { Boxes, FileCheck2, ListChecks, PencilLine, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Image, Input, Modal, Select, Tabs, Tag } from "antd";

import { entryCurrentFiles, fetchAssetManifest, loadAssetFileObjectUrl, type AssetEntry } from "@/services/api/drama-assets";
import { useDramaStore, type DramaPlannedAsset, type DramaProject, type DramaSourceCoverage } from "@/stores/use-drama-store";
import { useUserStore } from "@/stores/use-user-store";
import { ShotsStep } from "./shots-step";

const DISPOSITIONS: DramaSourceCoverage["disposition"][] = ["画面", "对白", "旁白", "音效", "合并", "暂不采用"];
const CATEGORIES: DramaPlannedAsset["category"][] = ["角色", "场景", "道具", "生物", "特效", "图形", "声音", "风格"];
const LAYERS: DramaPlannedAsset["layer"][] = ["身份母版", "状态变体", "表演动作", "空间布局", "合成层"];
const FACT_LEVELS: DramaPlannedAsset["factLevel"][] = ["原文明确", "原文推断", "改编设计"];
const PRIORITIES: DramaPlannedAsset["priority"][] = ["P0", "P1", "P2", "P3"];
const REFERENCE_ROLES: NonNullable<DramaPlannedAsset["referenceRole"]>[] = ["身份", "结构", "姿态构图", "场景空间", "道具结构", "风格", "特效合成", "声音"];

const emptyAsset = (): DramaPlannedAsset => ({
    key: "",
    category: "角色",
    name: "",
    layer: "身份母版",
    factLevel: "原文明确",
    sourceEvidence: "",
    specification: "",
    lock: "",
    deliverables: [],
    dependencies: [],
    priority: "P1",
    reviewCriteria: [],
});

const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g|webp|gif)$/i;

function displayDeliverables(asset: DramaPlannedAsset, entry?: AssetEntry): string[] {
    const currentFiles = entryCurrentFiles(entry || { 编号: "", 分类: "", 名称: "" });
    return currentFiles.length ? currentFiles : asset.deliverables;
}

function AssetPreviewStrip({ token, projectName, asset, entry }: { token: string; projectName: string; asset: DramaPlannedAsset; entry?: AssetEntry }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [urls, setUrls] = useState<Array<{ file: string; url: string }>>([]);
    const files = useMemo(() => displayDeliverables(asset, entry).filter((file) => IMAGE_FILE_PATTERN.test(file)), [asset.deliverables, entry]);

    useEffect(() => {
        const node = rootRef.current;
        if (!node || visible) return;
        const observer = new IntersectionObserver(([item]) => {
            if (!item.isIntersecting) return;
            setVisible(true);
            observer.disconnect();
        }, { rootMargin: "240px" });
        observer.observe(node);
        return () => observer.disconnect();
    }, [visible]);

    useEffect(() => {
        if (!visible || !token || !files.length) return;
        let alive = true;
        const created: string[] = [];
        void Promise.all(files.map(async (file) => {
            try {
                const url = await loadAssetFileObjectUrl(token, projectName, file);
                created.push(url);
                return { file, url };
            } catch {
                return null;
            }
        })).then((items) => {
            if (alive) setUrls(items.filter((item): item is { file: string; url: string } => Boolean(item)));
        });
        return () => {
            alive = false;
            created.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [files, projectName, token, visible]);

    return (
        <div ref={rootRef} className="mt-3 border-t border-border/70 pt-3 [contain-intrinsic-size:0_132px] [content-visibility:auto]">
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>资产参考图</span>
                <span>{files.length ? `${urls.length}/${files.length} 张可预览` : "尚无图片文件"}</span>
            </div>
            {files.length ? (
                <Image.PreviewGroup>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
                        {urls.map(({ file, url }) => (
                            <figure key={file} className="group/preview min-w-0 overflow-hidden border border-border bg-background">
                                <Image src={url} alt={`${asset.name} · ${file.split(/[\\/]/).pop()}`} width="100%" height={92} className="cursor-zoom-in object-contain" />
                                <figcaption className="truncate border-t border-border px-1.5 py-1 font-mono text-[9px] text-muted-foreground" title={file}>{file.split(/[\\/]/).pop()}</figcaption>
                            </figure>
                        ))}
                    </div>
                </Image.PreviewGroup>
            ) : <div className="flex h-16 items-center justify-center border border-dashed border-border text-[11px] text-muted-foreground">该资产还没有可展示的图片</div>}
        </div>
    );
}

export function ProductionPlanStep({ project, activeView, onViewChange }: { project: DramaProject; activeView: "coverage" | "assets" | "shots"; onViewChange: (view: "coverage" | "assets" | "shots") => void }) {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const updateProject = useDramaStore((state) => state.updateProject);
    const [assetEditor, setAssetEditor] = useState<number | "new" | null>(null);
    const [assetDraft, setAssetDraft] = useState<DramaPlannedAsset>(emptyAsset);
    const [manifestEntries, setManifestEntries] = useState<AssetEntry[]>([]);
    const coverage = project.sourceCoverage || [];
    const assets = project.plannedAssets || [];
    const manifestProject = project.assetProject || project.title;
    useEffect(() => {
        if (!token) return setManifestEntries([]);
        let alive = true;
        void fetchAssetManifest(token, manifestProject)
            .then((manifest) => { if (alive) setManifestEntries(manifest.条目 || []); })
            .catch(() => { if (alive) setManifestEntries([]); });
        return () => { alive = false; };
    }, [manifestProject, project.assetRevision, token]);
    const manifestByKey = useMemo(() => new Map(manifestEntries.filter((entry) => entry.键).map((entry) => [entry.键!, entry])), [manifestEntries]);
    const referencedKeys = new Set([
        ...project.shots.flatMap((shot) => shot.assetRefs?.map((ref) => ref.key) || []),
        ...assets.flatMap((asset) => asset.dependencies),
    ]);

    const patchCoverage = (index: number, patch: Partial<DramaSourceCoverage>) => {
        updateProject(project.id, { sourceCoverage: coverage.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item), keyframeApprovals: [] });
    };

    const openAsset = (index: number | null) => {
        setAssetEditor(index === null ? "new" : index);
        setAssetDraft(index === null ? emptyAsset() : { ...assets[index], deliverables: [...assets[index].deliverables], dependencies: [...assets[index].dependencies], reviewCriteria: [...(assets[index].reviewCriteria || [])] });
    };

    const saveAsset = () => {
        const key = assetDraft.key.trim();
        const name = assetDraft.name.trim();
        if (!key || !name || !assetDraft.sourceEvidence.trim() || !assetDraft.specification.trim() || !assetDraft.lock.trim() || !assetDraft.deliverables.length) {
            return message.warning("请补齐 key、名称、证据、规格、锁定段和至少一个交付件");
        }
        if (assets.some((asset, index) => asset.key === key && index !== assetEditor)) return message.warning("资产 key 必须全项目唯一");
        if (typeof assetEditor === "number" && assets[assetEditor].key !== key && referencedKeys.has(assets[assetEditor].key)) return message.warning("该稳定 key 已被镜头或其他资产引用，不能直接改名");
        const invalidDependencies = assetDraft.dependencies.filter((dependency) => dependency === key || !assets.some((asset, index) => asset.key === dependency && index !== assetEditor));
        if (invalidDependencies.length) return message.warning(`依赖 key 不存在或指向自身：${invalidDependencies.join("、")}`);
        const next = assetEditor === "new" ? [...assets, { ...assetDraft, key, name }] : assets.map((asset, index) => index === assetEditor ? { ...assetDraft, key, name } : asset);
        updateProject(project.id, { plannedAssets: next, keyframeApprovals: [] });
        setAssetEditor(null);
        setAssetDraft(emptyAsset());
    };

    const coveragePanel = coverage.length ? (
        <div className="space-y-2">
            {coverage.map((item, index) => (
                <div key={`${item.quote}-${index}`} className="grid gap-2 border-b border-border py-3 last:border-0 lg:grid-cols-[minmax(260px,1fr)_120px_150px_minmax(180px,.7fr)_32px]">
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} value={item.quote} placeholder="可逐字定位的原文短引文" onChange={(event) => patchCoverage(index, { quote: event.target.value })} />
                    <Select value={item.disposition} options={DISPOSITIONS.map((value) => ({ value, label: value }))} onChange={(disposition) => patchCoverage(index, { disposition })} />
                    <Input value={item.shotNumbers.join("、")} placeholder="镜号，如 1、2" onChange={(event) => patchCoverage(index, { shotNumbers: [...new Set(event.target.value.split(/[,，、\s]+/).map(Number).filter((number) => Number.isInteger(number) && number > 0))] })} />
                    <Input value={item.note || ""} placeholder={item.disposition === "暂不采用" ? "必须说明原因" : "合并/改编说明"} onChange={(event) => patchCoverage(index, { note: event.target.value })} />
                    <Button type="text" danger icon={<Trash2 className="size-4" />} aria-label="删除覆盖项" onClick={() => updateProject(project.id, { sourceCoverage: coverage.filter((_, itemIndex) => itemIndex !== index), keyframeApprovals: [] })} />
                </div>
            ))}
        </div>
    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有原文覆盖台账，请先回到原文拆解" />;

    const assetPanel = assets.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
            {assets.map((asset, index) => (
                <article key={asset.key} className="group border border-border bg-card/50 p-4 transition-colors hover:bg-foreground/[.025]">
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium text-foreground">{asset.name}</span>
                                <Tag className="m-0">{asset.category}</Tag>
                                <Tag className="m-0">{asset.layer}</Tag>
                                <Tag color={asset.factLevel === "改编设计" ? "gold" : asset.factLevel === "原文推断" ? "blue" : "green"} className="m-0">{asset.factLevel}</Tag>
                            </div>
                            <code className="mt-1 block text-[11px] text-muted-foreground">{asset.key}</code>
                        </div>
                        <Button type="text" icon={<PencilLine className="size-4" />} onClick={() => openAsset(index)}>编辑</Button>
                        <Button type="text" danger disabled={referencedKeys.has(asset.key)} icon={<Trash2 className="size-4" />} aria-label="删除资产" onClick={() => updateProject(project.id, { plannedAssets: assets.filter((_, itemIndex) => itemIndex !== index), keyframeApprovals: [] })} />
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">证据：{asset.sourceEvidence}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {displayDeliverables(asset, manifestByKey.get(asset.key)).map((deliverable) => <span key={deliverable} className="border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">{deliverable}</span>)}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{asset.dependencies.length ? `依赖 ${asset.dependencies.join("、")}` : "无前置依赖"}</span>
                        <span>{asset.priority} · 被 {project.shots.filter((shot) => shot.assetRefs?.some((ref) => ref.key === asset.key)).length} 镜引用</span>
                    </div>
                    {asset.referenceRole ? <div className="mt-2 text-[11px] text-muted-foreground">参考职责：{asset.referenceRole}{asset.reviewCriteria?.length ? ` · ${asset.reviewCriteria.length} 项目视验收` : ""}</div> : null}
                    {token ? <AssetPreviewStrip token={token} projectName={manifestProject} asset={asset} entry={manifestByKey.get(asset.key)} /> : <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">登录后显示资产图片</div>}
                </article>
            ))}
        </div>
    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="资产圣经为空，不能进入资产生产" />;

    return (
        <div className="space-y-5">
            <div className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
                <PlanMetric icon={FileCheck2} label="原文有去向" value={String(coverage.length)} hint="画面 / 声音 / 合并 / 暂不采用" />
                <PlanMetric icon={Boxes} label="待生产资产" value={String(assets.length)} hint={`${assets.filter((asset) => asset.layer === "身份母版").length} 个身份母版 · ${assets.filter((asset) => asset.layer !== "身份母版").length} 个派生资产`} />
                <PlanMetric icon={ListChecks} label="连续性分镜" value={String(project.shots.length)} hint={`${project.shots.filter((shot) => shot.assetRefs?.length).length} 镜已绑定资产`} />
            </div>

            <Tabs
                activeKey={activeView}
                onChange={(key) => onViewChange(key as "coverage" | "assets" | "shots")}
                items={[
                    { key: "coverage", label: "01 原文覆盖", children: <section className="border border-border bg-card/35 p-4"><div className="mb-3 flex items-center justify-between"><p className="text-sm text-muted-foreground">每条重要信息必须有去向，暂不采用必须说明原因。</p><Button size="small" icon={<Plus className="size-4" />} onClick={() => updateProject(project.id, { sourceCoverage: [...coverage, { quote: "", disposition: "画面", shotNumbers: [] }], keyframeApprovals: [] })}>补一条</Button></div>{coveragePanel}</section> },
                    { key: "assets", label: "02 资产圣经", children: <section className="space-y-3"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">一个条目只对应一个可寻址主体；状态、姿态和接触动作独立建档。</p><Button size="small" icon={<Plus className="size-4" />} onClick={() => openAsset(null)}>新增资产</Button></div>{assetPanel}</section> },
                    { key: "shots", label: "03 逐镜生产包", children: <ShotsStep project={project} /> },
                ]}
            />

            <Modal title={assetEditor === "new" ? "新增生产资产" : `编辑资产 · ${typeof assetEditor === "number" ? assets[assetEditor]?.name || "" : ""}`} open={assetEditor !== null} onCancel={() => { setAssetEditor(null); setAssetDraft(emptyAsset()); }} onOk={saveAsset} okText="保存资产" cancelText="取消" width={760}>
                <div className="grid gap-3 md:grid-cols-2">
                    <Input value={assetDraft.key} placeholder="稳定 key，如 character_lujiangxian_identity" onChange={(event) => setAssetDraft({ ...assetDraft, key: event.target.value })} />
                    <Input value={assetDraft.name} placeholder="资产名称" onChange={(event) => setAssetDraft({ ...assetDraft, name: event.target.value })} />
                    <Select value={assetDraft.category} options={CATEGORIES.map((value) => ({ value, label: value }))} onChange={(category) => setAssetDraft({ ...assetDraft, category })} />
                    <Select value={assetDraft.layer} options={LAYERS.map((value) => ({ value, label: value }))} onChange={(layer) => setAssetDraft({ ...assetDraft, layer })} />
                    <Select value={assetDraft.factLevel} options={FACT_LEVELS.map((value) => ({ value, label: value }))} onChange={(factLevel) => setAssetDraft({ ...assetDraft, factLevel })} />
                    <Select value={assetDraft.priority} options={PRIORITIES.map((value) => ({ value, label: value }))} onChange={(priority) => setAssetDraft({ ...assetDraft, priority })} />
                    <Select className="md:col-span-2" allowClear value={assetDraft.referenceRole} placeholder="参考图职责" options={REFERENCE_ROLES.map((value) => ({ value, label: value }))} onChange={(referenceRole) => setAssetDraft({ ...assetDraft, referenceRole })} />
                    <Input.TextArea className="md:col-span-2" rows={2} value={assetDraft.sourceEvidence} placeholder="原文短引文；改编设计填写必要性说明" onChange={(event) => setAssetDraft({ ...assetDraft, sourceEvidence: event.target.value })} />
                    <Input.TextArea className="md:col-span-2" rows={2} value={assetDraft.specification} placeholder="生产规格：需要哪些角度、状态、透明层或结构细节" onChange={(event) => setAssetDraft({ ...assetDraft, specification: event.target.value })} />
                    <Input.TextArea className="md:col-span-2" rows={3} value={assetDraft.lock} placeholder="跨镜逐字复用的可观察锁定段" onChange={(event) => setAssetDraft({ ...assetDraft, lock: event.target.value })} />
                    <Input.TextArea className="md:col-span-2" rows={4} value={assetDraft.generationPrompt || ""} placeholder="该资产的专业生图提示词：主体→构图→动作/状态→光线材质→风格；明确每张参考图的职责" onChange={(event) => setAssetDraft({ ...assetDraft, generationPrompt: event.target.value })} />
                    <Input.TextArea className="md:col-span-2" rows={2} value={assetDraft.avoidPrompt || ""} placeholder="禁止变化：身份骨相、数量、结构、穿模、错误文字等；不要用否定词代替结构控制" onChange={(event) => setAssetDraft({ ...assetDraft, avoidPrompt: event.target.value })} />
                    <Input.TextArea rows={3} value={assetDraft.deliverables.join("\n")} placeholder="交付件，一行一个；组合板和逐镜独立文件分别写" onChange={(event) => setAssetDraft({ ...assetDraft, deliverables: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} />
                    <Input.TextArea rows={3} value={assetDraft.dependencies.join("\n")} placeholder="依赖资产 key，一行一个" onChange={(event) => setAssetDraft({ ...assetDraft, dependencies: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} />
                    <Input.TextArea className="md:col-span-2" rows={3} value={(assetDraft.reviewCriteria || []).join("\n")} placeholder="逐图验收项，一行一个：身份几何、表情肌肉、姿态受力、手部接触、服装道具、背景与清晰度" onChange={(event) => setAssetDraft({ ...assetDraft, reviewCriteria: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} />
                </div>
            </Modal>
        </div>
    );
}

function PlanMetric({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint: string }) {
    return (
        <div className="flex items-center gap-3 bg-card px-4 py-3">
            <Icon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1"><div className="text-xs text-muted-foreground">{label}</div><div className="truncate text-[11px] text-muted-foreground/75">{hint}</div></div>
            <strong className="font-mono text-xl font-medium text-foreground">{value}</strong>
        </div>
    );
}
