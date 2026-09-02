"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Drawer, Input, Modal, Select, Space, Table, Tabs, Tag, Typography } from "antd";

import { ASSET_CATEGORIES, ASSET_PRIORITIES, ASSET_STATUSES, checkEpisodeAssets, entryCurrentFiles, fetchAssetManifest, loadAssetFileObjectUrl, reviewAssetEntry, upsertAssetEntry, writeAssetProjectFile, type AssetEntry, type AssetManifest, type EpisodeAssetCheck } from "@/services/api/drama-assets";
import { useDramaStore } from "@/stores/use-drama-store";
import { useUserStore } from "@/stores/use-user-store";

const STATUS_COLOR: Record<string, string> = { 待产出: "default", 制作中: "processing", 待审核: "warning", 需修改: "error", 已确认: "success", 已归档: "default" };

// 项目资产清单面板：D 盘项目文件夹为唯一事实源；六分类页签 + 审核/版本抽屉 + 分集分镜页签
export function ProjectAssetsPanel({ initialProject = "" }: { initialProject?: string }) {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const projects = useDramaStore((state) => state.projects);
    const [project, setProject] = useState(initialProject);
    const [manifest, setManifest] = useState<AssetManifest | null>(null);
    const [category, setCategory] = useState("角色");
    const [reviewEntry, setReviewEntry] = useState<AssetEntry | null>(null);
    const [comment, setComment] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState<Record<string, string>>({ 分类: "角色", 优先级: "P0" });
    const [episode, setEpisode] = useState("ep01");
    const [check, setCheck] = useState<EpisodeAssetCheck | null>(null);
    const [boardMd, setBoardMd] = useState("");
    const [thumbs, setThumbs] = useState<Record<string, string>>({});

    const projectOptions = useMemo(() => Array.from(new Set(projects.map((item) => item.title).filter(Boolean))), [projects]);
    useEffect(() => {
        if (!project && projectOptions.length) setProject(projectOptions[0]);
    }, [project, projectOptions]);

    const reload = async () => {
        if (!token || !project) return;
        try {
            setManifest(await fetchAssetManifest(token, project));
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
    }, [project, token]);

    const entries = manifest?.条目 || [];
    useEffect(() => {
        if (!token || !project) return;
        entries.forEach((entry) => {
            const first = entryCurrentFiles(entry)[0];
            if (!first || thumbs[entry.编号]) return;
            loadAssetFileObjectUrl(token, project, first)
                .then((url) => setThumbs((prev) => (prev[entry.编号] ? prev : { ...prev, [entry.编号]: url })))
                .catch(() => undefined);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manifest, project, token]);

    const categoryEntries = entries.filter((entry) => entry.分类 === category);
    const episodeOptions = useMemo(() => {
        const set = new Set(entries.flatMap((entry) => (entry.用于 || []).map((used) => String(used).split(".")[0])));
        set.add(episode);
        return Array.from(set).sort();
    }, [entries, episode]);
    const activeProject = projects.find((item) => item.title === project);

    const exportBoard = async () => {
        if (!token || !project || !activeProject) return message.error("当前项目不存在，无法导出分镜稿");
        const lines = ["# " + activeProject.title + " " + episode + " 分镜稿", "", "| 镜号 | 画面描述 | 对白 | 旁白 | 秒数 | 景别 | 运镜 | 转场 | 分镜图 |", "|---|---|---|---|---|---|---|---|---|"];
        activeProject.shots.forEach((shot, index) => {
            lines.push(`| ${index + 1} | ${shot.description} | ${shot.dialogue || ""} | ${shot.narration || ""} | ${shot.seconds} | ${shot.shotSize || ""} | ${shot.camera || ""} | ${shot.transition || ""} | ${activeProject.shotImages[shot.id] ? "有" : "无"} |`);
        });
        const md = lines.join("\n") + "\n";
        try {
            await writeAssetProjectFile(token, project, `分集/${episode}/分镜稿.md`, md);
            setBoardMd(md);
            message.success("分镜稿已导出到项目文件夹");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        }
    };

    const runCheck = async () => {
        if (!token || !project) return;
        try {
            setCheck(await checkEpisodeAssets(token, project, episode));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "开工检查失败");
        }
    };

    const doReview = async (conclusion: "已确认" | "需修改") => {
        if (!token || !project || !reviewEntry) return;
        try {
            const updated = await reviewAssetEntry(token, project, reviewEntry.编号, "用户", conclusion, comment.trim());
            setReviewEntry(updated);
            setComment("");
            message.success(conclusion === "已确认" ? "已确认归档为可用资产" : "已退回待产出");
            void reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "审核失败");
        }
    };

    const doCreate = async () => {
        if (!token || !project) return;
        if (!form.名称?.trim()) return message.error("名称必填");
        try {
            await upsertAssetEntry(token, project, {
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

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Space wrap>
                    <span className="text-sm text-stone-500 dark:text-stone-400">项目</span>
                    <Select className="min-w-56" value={project || undefined} placeholder="选择漫剧项目" options={projectOptions.map((title) => ({ label: title, value: title }))} onChange={setProject} />
                    <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void reload()}>
                        刷新
                    </Button>
                </Space>
                <Button type="primary" onClick={() => setCreateOpen(true)}>
                    登记条目
                </Button>
            </div>

            <Tabs
                activeKey={category}
                onChange={setCategory}
                items={[
                    ...ASSET_CATEGORIES.map((item) => ({
                        key: item,
                        label: `${item}（${entries.filter((entry) => entry.分类 === item).length}）`,
                        children: (
                            <Table
                                rowKey="编号"
                                size="small"
                                dataSource={categoryEntries}
                                pagination={false}
                                columns={[
                                    {
                                        title: "缩略",
                                        width: 64,
                                        render: (_, entry) => (thumbs[entry.编号] ? <img src={thumbs[entry.编号]} alt={entry.名称} className="size-10 rounded object-cover" /> : <div className="size-10 rounded bg-stone-100 dark:bg-stone-800" />),
                                    },
                                    { title: "名称", dataIndex: "名称", width: 140 },
                                    { title: "规格", render: (_, entry) => <span className="text-xs text-stone-500">{typeof entry.规格 === "string" ? entry.规格 : entry.规格 ? JSON.stringify(entry.规格) : "—"}</span> },
                                    { title: "优先级", dataIndex: "优先级", width: 80, render: (value: string) => <Tag className="m-0">{value || "—"}</Tag> },
                                    { title: "状态", dataIndex: "状态", width: 90, render: (value: string) => <Tag color={STATUS_COLOR[value] || "default"} className="m-0">{value}</Tag> },
                                    { title: "版本", dataIndex: "当前版本", width: 80, render: (value: string) => value || "—" },
                                    { title: "依据", dataIndex: "依据", ellipsis: true },
                                    {
                                        title: "操作",
                                        width: 90,
                                        render: (_, entry) => (
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
                    })),
                    {
                        key: "__episode__",
                        label: "分集分镜",
                        children: (
                            <div className="flex flex-col gap-4">
                                <Space wrap>
                                    <Select className="min-w-32" value={episode} options={episodeOptions.map((item) => ({ label: item, value: item }))} onChange={setEpisode} />
                                    <Button onClick={() => void exportBoard()}>导出当前项目分镜稿</Button>
                                    <Button onClick={() => void runCheck()}>开工前检查</Button>
                                </Space>
                                {check ? (
                                    <Alert
                                        type={check.可开工 ? "success" : "warning"}
                                        showIcon
                                        message={`${check.集} 开工检查：${check.可开工 ? "依赖资产齐备，可开工" : "存在未就绪资产"}`}
                                        description={`缺产出 ${check.缺产出.length} 项、未确认 ${check.未确认.length} 项、依赖阻塞 ${check.依赖阻塞.length} 项${check.缺产出.length || check.未确认.length ? "：" + [...check.缺产出, ...check.未确认].map((entry) => `${entry.名称}(${entry.状态})`).join("、") : ""}`}
                                    />
                                ) : null}
                                {boardMd ? <Typography.Paragraph className="whitespace-pre-wrap rounded-lg border border-stone-200 p-4 text-xs dark:border-stone-800">{boardMd}</Typography.Paragraph> : null}
                                {activeProject ? (
                                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                                        {activeProject.shots.map((shot, index) => {
                                            const media = activeProject.shotImages[shot.id];
                                            return (
                                                <div key={shot.id} className="rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                                                    {media?.url ? <img src={media.url} alt={`分镜 ${index + 1}`} className="aspect-[9/16] w-full rounded object-cover" /> : <div className="flex aspect-[9/16] items-center justify-center rounded bg-stone-100 text-xs text-stone-400 dark:bg-stone-800">未生成</div>}
                                                    <div className="mt-1 truncate text-xs text-stone-500">分镜 {index + 1} · {shot.dialogue ? "对白镜" : shot.narration ? "旁白镜" : "叙事镜"}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <Alert type="info" showIcon message="当前项目不在浏览器工作区，仅展示清单与文件夹内容" />
                                )}
                            </div>
                        ),
                    },
                ]}
            />

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
        </div>
    );
}
