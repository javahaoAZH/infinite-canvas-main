"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Drawer, Empty, Image, Input, Modal, Progress, Segmented, Select, Space, Table, Tabs, Tag, Typography } from "antd";

import { ASSET_CATEGORIES, ASSET_PRIORITIES, ASSET_STATUSES, checkEpisodeAssets, entryCurrentFiles, fetchAssetManifest, listAssetProjects, loadAssetFileObjectUrl, reviewAssetEntry, upsertAssetEntry, upsertEpisodeBoard, writeAssetProjectFile, type AssetEntry, type AssetManifest, type EpisodeAssetCheck, type EpisodeBoard, type ShotRecord } from "@/services/api/drama-assets";
import { useDramaStore, type DramaShot } from "@/stores/use-drama-store";
import { useUserStore } from "@/stores/use-user-store";

const STATUS_COLOR: Record<string, string> = { 待产出: "default", 制作中: "processing", 待审核: "warning", 需修改: "error", 已确认: "success", 已归档: "default" };

// 逐镜推荐模型（按分镜剧情规则判定）：对白→对口型、打斗→Kling、特效→Seedance、氛围→Wan、默认通用
function recommendShotModel(shot: DramaShot): { kind: string; model: string; reason: string } {
    const text = `${shot.description || ""} ${shot.action || ""} ${shot.camera || ""} ${shot.transition || ""}`;
    if ((shot.dialogue || "").trim()) return { kind: "对白", model: "ComfyUI H3 对口型（备选 Veo 3.1）", reason: "含对白，音频驱动口型" };
    if (/(打|斗|斩|杀|冲|爆|崩|剑|刀|箭|追|逃|战|搏|狼)/.test(text)) return { kind: "打斗动作", model: "Kling 3.0（KIE）", reason: "命中动作关键词" };
    if (/(光|晕|符|阵|黑气|雾|月华|金光|雷|火|冰|影|幻|裂)/.test(text)) return { kind: "特效", model: "Seedance 2.0（备选 Wan 2.6）", reason: "命中特效关键词" };
    if (/(俯瞰|定场|全景|远景|空镜|晨|暮|夜色|黄昏)/.test(text)) return { kind: "氛围定场", model: "Wan 2.6（dashscope）", reason: "命中氛围/定场关键词" };
    return { kind: "通用叙事", model: "ComfyUI v5（高质备选 Seedance 2.0）", reason: "默认叙事镜" };
}

// 浏览器工作区镜头 → 清单分镜记录（导入/兜底展示用）：带上导演字段，与制作分镜表同口径
function storeShotToRecord(shot: DramaShot, index: number): ShotRecord {
    return {
        镜号: index + 1,
        描述: shot.description,
        对白: shot.dialogue,
        旁白: shot.narration,
        秒: shot.seconds,
        景别: shot.shotSize,
        运镜: shot.camera,
        转场: shot.transition,
        动作: shot.action,
        情绪: shot.emotion,
        出场角色: shot.characters,
        出图提示词: shot.imagePrompt,
        图生视频提示词: shot.videoPrompt,
        推荐模型: recommendShotModel(shot).model,
    };
}

// 集列表行（按季投产视图）：两个 render 共用同一行类型，否则 TS 从首个 render 推断行形状后与第二个冲突
type EpisodeRow = { 集: string; 幕: string; 分镜: number; 所需资产: number; 已确认: number };

// 缩略图（点击放大预览）
function Thumb({ url, name, size = 40 }: { url?: string; name: string; size?: number }) {
    if (!url) return <div className="rounded bg-stone-100 dark:bg-stone-800" style={{ width: size, height: size }} />;
    return <Image src={url} alt={name} width={size} height={size} className="rounded object-cover" />;
}

// 项目资产清单面板：D 盘项目文件夹为唯一事实源。
// 双视图：【按季投产】季→集→镜头（分镜稿+所需资产，生产导向，默认）／【资产库】六分类跨集母资产。
export function ProjectAssetsPanel({ initialProject = "" }: { initialProject?: string }) {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const projects = useDramaStore((state) => state.projects);
    const activeId = useDramaStore((state) => state.activeId);
    const updateProject = useDramaStore((state) => state.updateProject);
    const [project, setProject] = useState(initialProject);
    const [manifest, setManifest] = useState<AssetManifest | null>(null);
    const [view, setView] = useState<"produce" | "library">("produce");
    const [season, setSeason] = useState("第一季");
    const [category, setCategory] = useState("角色");
    const [reviewEntry, setReviewEntry] = useState<AssetEntry | null>(null);
    const [comment, setComment] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState<Record<string, string>>({ 分类: "角色", 优先级: "P0" });
    const [episode, setEpisode] = useState("ep01");
    const [check, setCheck] = useState<EpisodeAssetCheck | null>(null);
    const [boardMd, setBoardMd] = useState("");
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const [bindOpen, setBindOpen] = useState(false);
    const [folderOptions, setFolderOptions] = useState<string[]>([]);
    const [bindValue, setBindValue] = useState("");
    const [bindNew, setBindNew] = useState("");

    const projectOptions = useMemo(() => Array.from(new Set([...projects.map((item) => item.title), ...folderOptions].filter(Boolean))), [projects, folderOptions]);
    useEffect(() => {
        if (!project && projectOptions.length) {
            const activeTitle = projects.find((item) => item.id === activeId)?.title;
            setProject(activeTitle && projectOptions.includes(activeTitle) ? activeTitle : projectOptions[0]);
        }
    }, [project, projectOptions, projects, activeId]);
    useEffect(() => {
        if (!token) return;
        listAssetProjects(token)
            .then((data) => setFolderOptions(data.projects || []))
            .catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const selectedDrama = projects.find((item) => item.title === project);
    const manifestKey = selectedDrama?.assetProject || project;

    const reload = async () => {
        if (!token || !manifestKey) return;
        try {
            setManifest(await fetchAssetManifest(token, manifestKey));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "清单读取失败");
        }
    };
    useEffect(() => {
        setThumbs({});
        setCheck(null);
        setBoardMd("");
        void reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manifestKey, token]);

    const entries = manifest?.条目 || [];
    const boards = manifest?.分集 || [];
    const seasons = manifest?.季集 || [];
    useEffect(() => {
        if (!token || !project) return;
        entries.forEach((entry) => {
            const first = entryCurrentFiles(entry)[0];
            if (!first || thumbs[entry.编号]) return;
            loadAssetFileObjectUrl(token, manifestKey, first)
                .then((url) => setThumbs((prev) => (prev[entry.编号] ? prev : { ...prev, [entry.编号]: url })))
                .catch(() => undefined);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manifest, manifestKey, token]);

    const entryByID = useMemo(() => {
        const map: Record<string, AssetEntry> = {};
        entries.forEach((entry) => {
            map[entry.编号] = entry;
        });
        return map;
    }, [entries]);

    // 集列表＝清单分集 ∪ 条目用于（按我们实际投产的集展示，不铺满全季集数）
    const episodes = useMemo(() => {
        const set = new Set<string>();
        boards.forEach((board) => set.add(board.集));
        entries.forEach((entry) => (entry.用于 || []).forEach((used) => set.add(String(used).split(".")[0])));
        return Array.from(set).sort();
    }, [boards, entries]);
    useEffect(() => {
        if (episodes.length && !episodes.includes(episode)) setEpisode(episodes[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [episodes]);

    const activeProject = selectedDrama;
    const storeShots = activeProject?.shots || [];
    const currentBoard = boards.find((board) => board.集 === episode);
    // 集详情镜头：优先浏览器工作区实时分镜（与 /drama、画布同源，杜绝三方漂移）；清单侧策划字段（场景/音效/音乐/帧类型/情绪强度/所属节拍/质检标准/所需资产）先铺底再由工作区字段覆盖
    const boardByNo = new Map((currentBoard?.镜头 || []).map((shot) => [shot.镜号, shot]));
    const displayedShots: ShotRecord[] = storeShots.length
        ? storeShots.map((shot, index) => {
              const persisted = boardByNo.get(index + 1);
              const media = activeProject?.shotImages?.[shot.id];
              return { ...persisted, ...storeShotToRecord(shot, index), 所需资产: persisted?.所需资产 || [], 产物: media ? { 分镜图: media.url } : persisted?.产物 };
          })
        : currentBoard?.镜头 || [];
    const episodeAssets = entries.filter((entry) => (entry.用于 || []).some((used) => String(used).split(".")[0] === episode));
    const seasonInfo = seasons.find((item) => item.季 === season);
    const seasonEpisodes = season === "第一季" ? episodes : [];

    const exportBoard = async () => {
        if (!token || !project || !activeProject) return message.error("当前项目不存在，无法导出分镜稿");
        const lines = [
            "# " + activeProject.title + " " + episode + " 分镜稿",
            "",
            "| 镜号 | 场景 | 出场角色 | 景别 | 运镜 | 转场 | 秒 | 画面描述 | 动作 | 情绪 | 对白 | 旁白 | 分镜图 |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ];
        displayedShots.forEach((shot) => {
            lines.push(
                `| ${shot.镜号} | ${shot.场景 || ""} | ${(shot.出场角色 || []).join("、")} | ${shot.景别 || ""} | ${shot.运镜 || ""} | ${shot.转场 || ""} | ${shot.秒 ?? ""} | ${shot.描述 || ""} | ${shot.动作 || ""} | ${shot.情绪 || ""} | ${shot.对白 || ""} | ${shot.旁白 || ""} | ${shot.产物?.分镜图 ? "有" : "无"} |`,
            );
        });
        const md = lines.join("\n") + "\n";
        try {
            await writeAssetProjectFile(token, manifestKey, `分集/${episode}/分镜稿.md`, md);
            setBoardMd(md);
            message.success("分镜稿已导出到项目文件夹");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        }
    };

    const runCheck = async () => {
        if (!token || !project) return;
        try {
            setCheck(await checkEpisodeAssets(token, manifestKey, episode));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "开工检查失败");
        }
    };

    // 把当前集分镜沉淀进清单 分集（生产数据落盘，不依赖浏览器工作区）
    const saveBoard = async () => {
        if (!token || !project) return;
        const board: EpisodeBoard = { 集: episode, 季: currentBoard?.季, 幕: currentBoard?.幕, 标题: currentBoard?.标题, 镜头: displayedShots };
        try {
            await upsertEpisodeBoard(token, manifestKey, board);
            message.success(`已保存 ${episode} 分镜到清单`);
            void reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存分镜失败");
        }
    };

    const doReview = async (conclusion: "已确认" | "需修改") => {
        if (!token || !project || !reviewEntry) return;
        try {
            const updated = await reviewAssetEntry(token, manifestKey, reviewEntry.编号, "用户", conclusion, comment.trim());
            setReviewEntry(updated);
            setComment("");
            message.success(conclusion === "已确认" ? "已确认归档为可用资产" : "已退回待产出");
            void reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "审核失败");
        }
    };

    const openBind = async () => {
        if (!token) return;
        try {
            const data = await listAssetProjects(token);
            setFolderOptions(data.projects || []);
        } catch {
            setFolderOptions([]);
        }
        setBindValue(selectedDrama?.assetProject || "");
        setBindNew("");
        setBindOpen(true);
    };

    const confirmBind = () => {
        if (!selectedDrama) return;
        const target = bindNew.trim() || bindValue;
        updateProject(selectedDrama.id, { assetProject: target || undefined });
        setBindOpen(false);
        message.success(target ? `已绑定资产项目：${target}` : "已解绑");
    };

    const doCreate = async () => {
        if (!token || !project) return;
        if (!form.名称?.trim()) return message.error("名称必填");
        try {
            await upsertAssetEntry(token, manifestKey, {
                分类: form.分类,
                名称: form.名称.trim(),
                优先级: form.优先级,
                依据: form.依据 || "",
                锁定段: form.锁定段 || "",
                规格: form.规格 || "",
                依赖: (form.依赖 || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                用于: (form.用于 || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
            });
            setCreateOpen(false);
            setForm({ 分类: "角色", 优先级: "P0" });
            message.success("条目已登记");
            void reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登记失败");
        }
    };

    const categoryEntries = entries.filter((entry) => entry.分类 === category);

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Space wrap>
                    <span className="text-sm text-stone-500 dark:text-stone-400">项目</span>
                    <Select className="min-w-56" value={project || undefined} placeholder="选择漫剧项目" options={projectOptions.map((title) => ({ label: title, value: title }))} onChange={setProject} />
                    <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void reload()}>
                        刷新
                    </Button>
                    {selectedDrama ? (
                        <>
                            <Tag color={selectedDrama.assetProject ? "blue" : "default"} className="m-0">
                                资产项目：{manifestKey}
                            </Tag>
                            <Button onClick={() => void openBind()}>绑定</Button>
                        </>
                    ) : null}
                </Space>
                <Space>
                    <Segmented value={view} onChange={(value) => setView(value as "produce" | "library")} options={[{ label: "按季投产", value: "produce" }, { label: "资产库", value: "library" }]} />
                    <Button type="primary" onClick={() => setCreateOpen(true)}>
                        登记条目
                    </Button>
                </Space>
            </div>

            {entries.length ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <Progress className="min-w-40 flex-1" size="small" percent={Math.round((entries.filter((e) => e.状态 === "已确认").length / entries.length) * 100)} />
                    <Tag className="m-0">总 {entries.length}</Tag>
                    <Tag color="success" className="m-0">已完成 {entries.filter((e) => e.状态 === "已确认").length}</Tag>
                    <Tag color="processing" className="m-0">已产出 {entries.filter((e) => e.当前版本).length}</Tag>
                    <Tag className="m-0">未完成 {entries.filter((e) => e.状态 !== "已确认").length}</Tag>
                </div>
            ) : (
                <Alert
                    type="info"
                    showIcon
                    message="当前项目还没有资产清单"
                    description={
                        <Space>
                            <span>绑定已有资产项目（如 照古长明）或直接登记条目。</span>
                            <Button size="small" onClick={() => void openBind()}>
                                绑定资产项目
                            </Button>
                        </Space>
                    }
                />
            )}

            {manifest?.模型策略 && Object.keys(manifest.模型策略).length ? (
                <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">模型策略（2026-09 调研定案：按镜头类型切模型）</div>
                    <div className="grid gap-1.5 text-xs sm:grid-cols-2">
                        {Object.entries(manifest.模型策略).map(([key, value]) => (
                            <div key={key} className="flex items-start gap-1.5">
                                <Tag className="m-0 shrink-0">{key}</Tag>
                                <span className="text-stone-500 dark:text-stone-400">{value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {view === "produce" ? (
                <div className="flex flex-col gap-4">
                    <Space wrap>
                        <span className="text-sm text-stone-500 dark:text-stone-400">投产季</span>
                        <Select className="min-w-32" value={season} options={(seasons.length ? seasons : [{ 季: "第一季" }]).map((item) => ({ label: item.季, value: item.季 }))} onChange={setSeason} />
                        {seasonInfo ? (
                            <>
                                <Tag className="m-0">章节 {seasonInfo.章节}</Tag>
                                <Tag className="m-0">{seasonInfo.集数} 集</Tag>
                                {(seasonInfo.幕 || []).map((act) => (
                                    <Tag key={act.幕} className="m-0">
                                        {act.幕} {act.集数}集
                                    </Tag>
                                ))}
                            </>
                        ) : null}
                    </Space>

                    {seasonEpisodes.length ? (
                        <>
                            <Table
                                rowKey="集"
                                size="small"
                                pagination={false}
                                dataSource={seasonEpisodes.map((ep) => {
                                    const board = boards.find((item) => item.集 === ep);
                                    const assets = entries.filter((entry) => (entry.用于 || []).some((used) => String(used).split(".")[0] === ep));
                                    return { 集: ep, 幕: board?.幕 || "—", 分镜: ep === episode && storeShots.length ? storeShots.length : board?.镜头?.length || 0, 所需资产: assets.length, 已确认: assets.filter((entry) => entry.状态 === "已确认").length };
                                })}
                                columns={[
                                    { title: "集", dataIndex: "集", width: 80 },
                                    { title: "幕", dataIndex: "幕", width: 140 },
                                    { title: "分镜数", dataIndex: "分镜", width: 80 },
                                    { title: "所需资产", dataIndex: "所需资产", width: 90 },
                                    {
                                        title: "资产齐备",
                                        width: 110,
                                        render: (_, row: EpisodeRow) => (
                                            <span className="text-xs">
                                                {row.已确认}/{row.所需资产}
                                            </span>
                                        ),
                                    },
                                    {
                                        title: "操作",
                                        width: 90,
                                        render: (_, row: EpisodeRow) => (
                                            <Button size="small" type={row.集 === episode ? "primary" : "default"} onClick={() => setEpisode(row.集)}>
                                                查看
                                            </Button>
                                        ),
                                    },
                                ]}
                            />

                            <div className="flex flex-col gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                <Space wrap>
                                    <Tag color="blue" className="m-0">
                                        {episode} 分镜与所需资产
                                    </Tag>
                                    <Button size="small" onClick={() => void exportBoard()}>
                                        导出分镜稿
                                    </Button>
                                    <Button size="small" onClick={() => void runCheck()}>
                                        开工前检查
                                    </Button>
                                    <Button size="small" type="primary" onClick={() => void saveBoard()}>
                                        保存分镜到清单
                                    </Button>
                                </Space>

                                {check ? (
                                    <Alert
                                        type={check.可开工 ? "success" : "warning"}
                                        showIcon
                                        message={`${check.集} 开工检查：${check.可开工 ? "依赖资产齐备，可开工" : "存在未就绪资产"}`}
                                        description={`缺产出 ${check.缺产出.length} 项、未确认 ${check.未确认.length} 项、依赖阻塞 ${check.依赖阻塞.length} 项${check.缺产出.length || check.未确认.length ? "：" + [...check.缺产出, ...check.未确认].map((entry) => `${entry.名称}(${entry.状态})`).join("、") : ""}`}
                                    />
                                ) : null}

                                <Table
                                    rowKey="镜号"
                                    size="small"
                                    pagination={false}
                                    dataSource={displayedShots}
                                    columns={[
                                        { title: "镜号", dataIndex: "镜号", width: 60 },
                                        { title: "分镜图", width: 64, render: (_, shot: ShotRecord) => (shot.产物?.分镜图 ? <img src={shot.产物.分镜图} alt={`分镜${shot.镜号}`} className="size-10 rounded object-cover" /> : <div className="size-10 rounded bg-stone-100 dark:bg-stone-800" />) },
                                        { title: "场景", dataIndex: "场景", width: 110, ellipsis: true, render: (value: string, shot: ShotRecord) => value || shot.场 || "—" },
                                        { title: "出场角色", width: 110, ellipsis: true, render: (_, shot: ShotRecord) => (shot.出场角色 || []).join("、") || "—" },
                                        { title: "画面描述", ellipsis: true, dataIndex: "描述" },
                                        { title: "动作/情绪", width: 170, ellipsis: true, render: (_, shot: ShotRecord) => <span className="text-xs text-stone-500">{[shot.动作, shot.情绪].filter(Boolean).join(" / ") || "—"}</span> },
                                        { title: "秒", dataIndex: "秒", width: 50, render: (value: number) => value ?? "—" },
                                        { title: "景别/运镜", width: 130, render: (_, shot: ShotRecord) => <span className="text-xs text-stone-500">{[shot.景别, shot.运镜].filter(Boolean).join(" / ") || "—"}</span> },
                                        { title: "推荐模型", width: 200, ellipsis: true, dataIndex: "推荐模型", render: (value: string) => value || "—" },
                                        {
                                            title: "所需资产",
                                            width: 150,
                                            render: (_, shot: ShotRecord) =>
                                                (shot.所需资产 || []).length ? (
                                                    <Space size={4} wrap>
                                                        {(shot.所需资产 || []).map((id) => (
                                                            <Thumb key={id} url={thumbs[id]} name={entryByID[id]?.名称 || id} size={32} />
                                                        ))}
                                                    </Space>
                                                ) : (
                                                    <span className="text-xs text-stone-400">—</span>
                                                ),
                                        },
                                        { title: "状态", dataIndex: "状态", width: 80, render: (value: string) => (value ? <Tag color={STATUS_COLOR[value] || "default"} className="m-0">{value}</Tag> : "—") },
                                    ]}
                                    scroll={{ x: 1200 }}
                                    expandable={{
                                        // 长字段（节奏与生成依据）收进展开行，不挤宽表格
                                        rowExpandable: (shot: ShotRecord) => Boolean(shot.出图提示词 || shot.图生视频提示词 || shot.音效 || shot.音乐 || shot.质检标准 || shot.帧类型 || shot.所属节拍),
                                        expandedRowRender: (shot: ShotRecord) => (
                                            <div className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
                                                <div>帧类型：{shot.帧类型 || "—"}｜情绪强度：{shot.情绪强度 || "—"}｜所属节拍：{shot.所属节拍 || "—"}｜转场：{shot.转场 || "—"}</div>
                                                <div>音效：{shot.音效 || "—"}</div>
                                                <div>音乐：{shot.音乐 || "—"}</div>
                                                <div>对白：{shot.对白 || "—"}｜旁白：{shot.旁白 || "—"}</div>
                                                <div>出图提示词：{shot.出图提示词 || "（未写，生成时回落为画面描述＋动作）"}</div>
                                                <div>图生视频提示词：{shot.图生视频提示词 || "（未写，生成时回落为画面描述＋动作）"}</div>
                                                <div>质检标准：{shot.质检标准 || "—"}</div>
                                            </div>
                                        ),
                                    }}
                                />

                                <div>
                                    <div className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">本集所需资产（{episode} · 去重汇总）</div>
                                    <Table
                                        rowKey="编号"
                                        size="small"
                                        pagination={false}
                                        dataSource={episodeAssets}
                                        columns={[
                                            { title: "缩略", width: 56, render: (_, entry: AssetEntry) => <Thumb url={thumbs[entry.编号]} name={entry.名称} /> },
                                            { title: "名称", dataIndex: "名称", width: 140 },
                                            { title: "分类", dataIndex: "分类", width: 70 },
                                            { title: "状态", dataIndex: "状态", width: 90, render: (value: string) => <Tag color={STATUS_COLOR[value] || "default"} className="m-0">{value}</Tag> },
                                            { title: "优先级", dataIndex: "优先级", width: 70 },
                                            { title: "模型", ellipsis: true, dataIndex: "模型" },
                                        ]}
                                    />
                                </div>

                                {boardMd ? <Typography.Paragraph className="whitespace-pre-wrap rounded-lg border border-stone-200 p-4 text-xs dark:border-stone-800">{boardMd}</Typography.Paragraph> : null}
                            </div>
                        </>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${season} 尚未投产/未播种分集，切回第一季或先播种分集分镜`} />
                    )}
                </div>
            ) : (
                <Tabs
                    activeKey={category}
                    onChange={setCategory}
                    items={ASSET_CATEGORIES.map((item) => ({
                        key: item,
                        label: (
                            <span className="whitespace-nowrap">
                                {item}（{entries.filter((entry) => entry.分类 === item).length} · 已完成 {entries.filter((entry) => entry.分类 === item && entry.状态 === "已确认").length}）
                            </span>
                        ),
                        children: (
                            <Table
                                rowKey="编号"
                                size="small"
                                dataSource={categoryEntries}
                                pagination={false}
                                columns={[
                                    { title: "缩略", width: 56, render: (_, entry: AssetEntry) => <Thumb url={thumbs[entry.编号]} name={entry.名称} /> },
                                    { title: "名称", dataIndex: "名称", width: 140 },
                                    { title: "规格", render: (_, entry: AssetEntry) => <span className="text-xs text-stone-500">{typeof entry.规格 === "string" ? entry.规格 : entry.规格 ? JSON.stringify(entry.规格) : "—"}</span> },
                                    { title: "模型", dataIndex: "模型", width: 150, ellipsis: true, render: (value: string) => value || "—" },
                                    { title: "优先级", dataIndex: "优先级", width: 80, render: (value: string) => <Tag className="m-0">{value || "—"}</Tag> },
                                    { title: "状态", dataIndex: "状态", width: 90, render: (value: string) => <Tag color={STATUS_COLOR[value] || "default"} className="m-0">{value}</Tag> },
                                    { title: "版本", dataIndex: "当前版本", width: 80, render: (value: string) => value || "—" },
                                    { title: "用于", width: 140, render: (_, entry: AssetEntry) => <span className="text-xs text-stone-500">{(entry.用于 || []).join("、") || "—"}</span> },
                                    { title: "依据", dataIndex: "依据", ellipsis: true },
                                    {
                                        title: "操作",
                                        width: 90,
                                        render: (_, entry: AssetEntry) => (
                                            <Button
                                                size="small"
                                                onClick={() => {
                                                    setReviewEntry(entry);
                                                    setComment("");
                                                }}
                                            >
                                                审核/详情
                                            </Button>
                                        ),
                                    },
                                ]}
                            />
                        ),
                    }))}
                />
            )}

            <Drawer title={`审核 / 详情 · ${reviewEntry?.名称 || ""}`} open={Boolean(reviewEntry)} size="large" onClose={() => setReviewEntry(null)}>
                {reviewEntry ? (
                    <div className="space-y-5">
                        <Space wrap>
                            <Tag>{reviewEntry.分类}</Tag>
                            <Tag>{reviewEntry.优先级 || "—"}</Tag>
                            <Tag color={STATUS_COLOR[reviewEntry.状态 || ""] || "default"}>{reviewEntry.状态}</Tag>
                            <Tag>当前 {reviewEntry.当前版本 || "无版本"}</Tag>
                        </Space>
                        {reviewEntry.依据 ? <Typography.Paragraph className="text-sm">依据：{reviewEntry.依据}</Typography.Paragraph> : null}
                        {reviewEntry.锁定段 ? (
                            <div>
                                <Typography.Text type="secondary" className="text-xs">锁定段（生图一字不改）</Typography.Text>
                                <Typography.Paragraph className="mt-1 whitespace-pre-wrap rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">{reviewEntry.锁定段}</Typography.Paragraph>
                            </div>
                        ) : null}
                        <div>
                            <Typography.Text type="secondary" className="text-xs">版本历史（旧版在 history/ 子目录）</Typography.Text>
                            <div className="mt-2 space-y-2">
                                {(reviewEntry.版本 || []).slice().reverse().map((version) => (
                                    <div key={version.版本} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
                                        <Space wrap>
                                            <Tag>{version.版本}</Tag>
                                            <Tag color={version.状态 === "当前" ? "processing" : "default"}>{version.状态 || "—"}</Tag>
                                            <span className="text-xs text-stone-500">{version.时间}</span>
                                        </Space>
                                        <div className="mt-1 flex flex-wrap gap-2">
                                            {(version.文件 || []).map((file) => (
                                                <Tag key={file} className="m-0 text-[11px]">{file.split("/").pop()}</Tag>
                                            ))}
                                        </div>
                                        {version.备注 ? <div className="mt-1 text-xs text-stone-500">备注：{version.备注}</div> : null}
                                    </div>
                                ))}
                                {!(reviewEntry.版本 || []).length ? <Typography.Text type="secondary" className="text-xs">尚无版本（待产出）</Typography.Text> : null}
                            </div>
                        </div>
                        <div>
                            <Typography.Text type="secondary" className="text-xs">审核记录</Typography.Text>
                            <div className="mt-2 space-y-2">
                                {(reviewEntry.审核 || []).slice().reverse().map((review) => (
                                    <div key={review.轮次} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
                                        第 {review.轮次} 轮 · {review.审核人 || "—"} · <Tag color={review.结论 === "已确认" ? "success" : "error"} className="m-0">{review.结论}</Tag> · <span className="text-xs text-stone-500">{review.时间}</span>
                                        {review.意见 ? <div className="mt-1 text-xs text-stone-600 dark:text-stone-300">意见：{review.意见}</div> : null}
                                    </div>
                                ))}
                                {!(reviewEntry.审核 || []).length ? <Typography.Text type="secondary" className="text-xs">尚无审核记录</Typography.Text> : null}
                            </div>
                        </div>
                        <div>
                            <Input.TextArea rows={3} value={comment} placeholder="审核意见（需修改时必填原因）" onChange={(event) => setComment(event.target.value)} />
                            <Space className="mt-3">
                                <Button type="primary" onClick={() => void doReview("已确认")}>确认</Button>
                                <Button danger onClick={() => void doReview("需修改")}>需修改</Button>
                            </Space>
                        </div>
                    </div>
                ) : null}
            </Drawer>

            <Modal title="登记资产条目" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void doCreate()} okText="登记" cancelText="取消">
                <div className="space-y-3">
                    <Space wrap>
                        <Select className="min-w-28" value={form.分类} options={ASSET_CATEGORIES.map((item) => ({ label: item, value: item }))} onChange={(value) => setForm({ ...form, 分类: value })} />
                        <Select className="min-w-24" value={form.优先级} options={ASSET_PRIORITIES.map((item) => ({ label: item, value: item }))} onChange={(value) => setForm({ ...form, 优先级: value })} />
                    </Space>
                    <Input value={form.名称 || ""} placeholder="名称（如 楚拾安 / 芦雾村 / 玄鉴）" onChange={(event) => setForm({ ...form, 名称: event.target.value })} />
                    <Input value={form.规格 || ""} placeholder="规格（如 五视图×2造型 / 全景2:1 / 碎裂态）" onChange={(event) => setForm({ ...form, 规格: event.target.value })} />
                    <Input value={form.依据 || ""} placeholder="依据（如 第2章·卡§9）" onChange={(event) => setForm({ ...form, 依据: event.target.value })} />
                    <Input.TextArea rows={3} value={form.锁定段 || ""} placeholder="锁定段（角色卡生图提示词原文，一字不改）" onChange={(event) => setForm({ ...form, 锁定段: event.target.value })} />
                    <Input value={form.依赖 || ""} placeholder="依赖条目编号，逗号分隔" onChange={(event) => setForm({ ...form, 依赖: event.target.value })} />
                    <Input value={form.用于 || ""} placeholder="用于集/镜，逗号分隔（如 ep01.镜头3）" onChange={(event) => setForm({ ...form, 用于: event.target.value })} />
                    <Typography.Text type="secondary" className="text-xs">状态枚举：{ASSET_STATUSES.join(" / ")}</Typography.Text>
                </div>
            </Modal>

            <Modal title="绑定资产项目" open={bindOpen} onCancel={() => setBindOpen(false)} onOk={confirmBind} okText="绑定" cancelText="取消">
                <div className="space-y-3">
                    <Select
                        allowClear
                        className="w-full"
                        placeholder="选择已有项目文件夹（D:/InfiniteCanvas/…）"
                        value={bindValue || undefined}
                        options={folderOptions.map((name) => ({ label: name, value: name }))}
                        onChange={(value) => setBindValue(value || "")}
                    />
                    <Input value={bindNew} placeholder="或输入新资产项目名（新建文件夹并绑定）" onChange={(event) => setBindNew(event.target.value)} />
                    <Button
                        size="small"
                        danger
                        disabled={!selectedDrama?.assetProject}
                        onClick={() => {
                            if (!selectedDrama) return;
                            updateProject(selectedDrama.id, { assetProject: undefined });
                            setBindOpen(false);
                            message.info("已解绑，回退项目标题");
                        }}
                    >
                        解绑（回退项目标题）
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
