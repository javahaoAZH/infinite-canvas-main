"use client";

import { Plus, Trash2 } from "lucide-react";
import { App, Button, Empty, Input, InputNumber } from "antd";

import { newDramaShot, useDramaStore, type DramaProject } from "@/stores/use-drama-store";

export function ShotsStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const updateProject = useDramaStore((state) => state.updateProject);
    const totalSeconds = project.shots.reduce((sum, shot) => sum + (shot.seconds || 0), 0);

    const patchShot = (id: string, patch: Partial<Omit<ReturnType<typeof newDramaShot>, "id">>) => {
        updateProject(project.id, { shots: project.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)) });
    };

    return (
        <div className="mx-auto w-full max-w-4xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-stone-500 dark:text-stone-400">
                    共 {project.shots.length} 个分镜，预计总时长 {totalSeconds} 秒。每条分镜包含画面描述、对白与时长，后续步骤都会基于这里的内容生成。
                </div>
                <Button
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                        updateProject(project.id, { shots: [...project.shots, newDramaShot()] });
                        message.success("已添加分镜");
                    }}
                >
                    添加分镜
                </Button>
            </div>

            {project.shots.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分镜，可回到上一步用 AI 结构化剧本，或点击右上角添加" className="py-16" />
            ) : (
                <div className="space-y-3">
                    {project.shots.map((shot, index) => (
                        <div key={shot.id} className="border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
                            <div className="mb-3 flex items-center gap-3">
                                <span className="flex size-7 items-center justify-center bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">
                                    {index + 1}
                                </span>
                                <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                                    时长
                                    <InputNumber
                                        size="small"
                                        min={1}
                                        max={30}
                                        value={shot.seconds}
                                        onChange={(value) => patchShot(shot.id, { seconds: Math.max(1, Math.min(30, Math.round(Number(value) || 5))) })}
                                    />
                                    秒
                                </div>
                                <Button
                                    type="text"
                                    danger
                                    size="small"
                                    className="ml-auto"
                                    icon={<Trash2 className="size-4" />}
                                    onClick={() => updateProject(project.id, { shots: project.shots.filter((item) => item.id !== shot.id) })}
                                >
                                    删除
                                </Button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <Input.TextArea
                                    rows={3}
                                    value={shot.description}
                                    placeholder="画面描述：场景、人物动作、构图，用于生成分镜图与视频"
                                    onChange={(event) => patchShot(shot.id, { description: event.target.value })}
                                />
                                <Input.TextArea
                                    rows={3}
                                    value={shot.dialogue}
                                    placeholder="对白：该分镜角色的台词，用于配音（可为空）"
                                    onChange={(event) => patchShot(shot.id, { dialogue: event.target.value })}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
