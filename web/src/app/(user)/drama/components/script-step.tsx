"use client";

import { WandSparkles } from "lucide-react";
import { useState } from "react";
import { Alert, App, Button, Input, Select } from "antd";

import { GENRE_CARDS, GENRE_SCENE_HINTS } from "@/app/(user)/drama/prompts";
import { structureScript } from "@/app/(user)/drama/services/drama-generation";
import { dramaTextConfig, useDramaStore, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";

export function ScriptStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateProject = useDramaStore((state) => state.updateProject);
    const genre = useDramaStore((state) => state.genre);
    const setGenre = useDramaStore((state) => state.setGenre);
    const scene = useDramaStore((state) => state.scene);
    const setScene = useDramaStore((state) => state.setScene);
    const [structuring, setStructuring] = useState(false);
    const [error, setError] = useState("");

    const runStructure = async () => {
        const script = project.script.trim();
        if (!script) return message.warning("请先输入或粘贴剧本内容");
        const textConfig = dramaTextConfig(effectiveConfig);
        if (!isAiConfigReady(textConfig, textConfig.model)) return message.warning("请先在设置中配置可用的文本模型渠道");
        setStructuring(true);
        setError("");
        try {
            const { shotsCount, charactersCount } = await structureScript(project.id, effectiveConfig);
            message.success(`已结构化出 ${shotsCount} 个分镜、${charactersCount} 个角色`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "结构化剧本失败，可重试");
        } finally {
            setStructuring(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-4xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-stone-500 dark:text-stone-400">输入或粘贴完整剧本，可调用文本模型结构化为分镜；也可以跳过 AI，在下一步手动填写分镜。</div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-stone-500 dark:text-stone-400">题材</span>
                    <Select
                        className="min-w-36"
                        value={genre}
                        options={[{ value: "", label: "不指定" }, ...GENRE_CARDS.map((card) => ({ value: card.id, label: card.label }))]}
                        onChange={(value) => {
                            setGenre(value);
                            // 题材联动推荐场景：仅在用户未手动改过场景（为空或仍是旧题材的推荐值）时覆盖
                            const hint = GENRE_SCENE_HINTS[value];
                            if (hint && (!scene || scene === GENRE_SCENE_HINTS[genre])) setScene(hint);
                        }}
                    />
                    <Button type="primary" icon={<WandSparkles className="size-4" />} loading={structuring} onClick={() => void runStructure()}>
                        AI 结构化剧本
                    </Button>
                </div>
            </div>
            {error ? <Alert type="error" showIcon message={error} description="文本模型返回内容无法解析或请求失败，可重试，或直接在下一步手动填写分镜。" /> : null}
            <Input.TextArea
                rows={16}
                value={project.script}
                placeholder="在此粘贴剧本，例如：第一幕 雨夜，少女站在便利店门口躲雨……"
                onChange={(event) => updateProject(project.id, { script: event.target.value })}
            />
        </div>
    );
}
