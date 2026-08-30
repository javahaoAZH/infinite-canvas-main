"use client";

import { WandSparkles } from "lucide-react";
import { useState } from "react";
import { Alert, App, Button, Input, Select } from "antd";
import { nanoid } from "nanoid";

import { buildScriptSystemPrompt, GENRE_CARDS } from "@/app/(user)/drama/prompts";
import { aiApiUrl, aiHeaders, refreshRemoteUser } from "@/services/api/image";
import { dramaTextConfig, newDramaShot, useDramaStore, type DramaCharacter, type DramaProject } from "@/stores/use-drama-store";
import { useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";

type StructuredShot = { description?: string; dialogue?: string; narration?: string; seconds?: number };
type StructuredCharacter = { name?: string; description?: string };
type StructuredScript = { title?: string; characters?: StructuredCharacter[]; shots?: StructuredShot[] };

export function ScriptStep({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateProject = useDramaStore((state) => state.updateProject);
    const genre = useDramaStore((state) => state.genre);
    const setGenre = useDramaStore((state) => state.setGenre);
    const [structuring, setStructuring] = useState(false);
    const [error, setError] = useState("");

    const structureScript = async () => {
        const script = project.script.trim();
        if (!script) return message.warning("请先输入或粘贴剧本内容");
        const textConfig = dramaTextConfig(effectiveConfig);
        if (!isAiConfigReady(textConfig, textConfig.model)) return message.warning("请先在设置中配置可用的文本模型渠道");
        setStructuring(true);
        setError("");
        try {
            const response = await fetch(aiApiUrl(textConfig, "/chat/completions"), {
                method: "POST",
                headers: aiHeaders(textConfig, "application/json"),
                body: JSON.stringify({
                    model: textConfig.model,
                    messages: [
                        { role: "system", content: buildScriptSystemPrompt(genre) },
                        { role: "user", content: script },
                    ],
                    stream: false,
                }),
            });
            const payload = (await response.json().catch(() => ({}))) as {
                code?: number;
                msg?: string;
                error?: { message?: string };
                choices?: Array<{ message?: { content?: string | null } }>;
                data?: { choices?: Array<{ message?: { content?: string | null } }> };
            };
            if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
                throw new Error(payload.msg || payload.error?.message || `文本接口请求失败：${response.status}`);
            }
            refreshRemoteUser(textConfig);
            const content = payload.choices?.[0]?.message?.content || payload.data?.choices?.[0]?.message?.content || "";
            const structured = parseStructuredScript(content);
            const characters = mergeCharacters(project.characters, structured.characters || []);
            const shots = structured.shots!.map((shot) => newDramaShot({ description: shot.description!, dialogue: shot.dialogue || "", narration: shot.narration || "", seconds: shot.seconds }));
            updateProject(project.id, {
                shots,
                characters,
                shotImages: {},
                shotVideos: {},
                shotAudios: {},
                ...(structured.title && !project.title.trim() ? { title: structured.title } : {}),
            });
            message.success(`已结构化出 ${shots.length} 个分镜、${characters.length} 个角色`);
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
                        onChange={(value) => setGenre(value)}
                    />
                    <Button type="primary" icon={<WandSparkles className="size-4" />} loading={structuring} onClick={() => void structureScript()}>
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

function parseStructuredScript(content: string): Required<Pick<StructuredScript, "shots">> & StructuredScript {
    const trimmed = content.replace(/```[a-zA-Z]*\n?/g, "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 没有返回有效的 JSON 数据");
    let parsed: StructuredScript;
    try {
        parsed = JSON.parse(trimmed.slice(start, end + 1)) as StructuredScript;
    } catch {
        throw new Error("AI 返回的 JSON 无法解析");
    }
    const shots = (Array.isArray(parsed.shots) ? parsed.shots : [])
        .map((shot) => ({
            description: typeof shot?.description === "string" ? shot.description.trim() : "",
            dialogue: typeof shot?.dialogue === "string" ? shot.dialogue.trim() : "",
            narration: typeof shot?.narration === "string" ? shot.narration.trim() : "",
            seconds: clampSeconds(shot?.seconds),
        }))
        .filter((shot) => shot.description || shot.dialogue);
    if (!shots.length) throw new Error("AI 没有返回任何有效分镜");
    return { ...parsed, shots };
}

function clampSeconds(value: unknown) {
    const seconds = Math.round(Number(value));
    if (!Number.isFinite(seconds)) return 5;
    return Math.max(1, Math.min(30, seconds));
}

// 同名角色保留已生成的立绘与视图分配，其余按 AI 结果重建
function mergeCharacters(existing: DramaCharacter[], incoming: StructuredCharacter[]): DramaCharacter[] {
    const merged: DramaCharacter[] = [];
    const used = new Set<string>();
    for (const item of incoming) {
        const name = (item.name || "").trim() || `角色 ${merged.length + 1}`;
        const previous = existing.find((character) => !used.has(character.id) && character.name === name);
        if (previous) {
            used.add(previous.id);
            merged.push({ ...previous, description: (item.description || "").trim() || previous.description });
        } else {
            merged.push({ id: nanoid(), name, description: (item.description || "").trim(), candidates: [], views: {} });
        }
    }
    return merged;
}
