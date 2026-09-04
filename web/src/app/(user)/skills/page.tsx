"use client";

// 技能库页（台账批次 A #19）：展示 .agents/skills 下的 Agent 技能；漫剧前期技能详情来自仓库 SKILL.md
import { BookOpen, Cpu, Drama, FileText } from "lucide-react";
import Link from "next/link";

type SkillCard = {
    key: string;
    icon: React.ReactNode;
    name: string;
    source: string;
    desc: string;
    triggers: string;
    href?: string;
};

const SKILLS: SkillCard[] = [
    {
        key: "ai-drama-preproduction",
        icon: <Drama className="size-4" />,
        name: "ai-drama-preproduction",
        source: "项目内置 · .agents/skills/ai-drama-preproduction",
        desc: "将小说、剧本或章节拆成可生产的 AI 漫剧资产圣经、连续性分镜、首帧和图生视频提示词；覆盖长篇漫剧前期、资产补全、人物一致性和分镜漏项审查。规范正文由漫剧页 prompts.ts 单一事实来源下发，Qoder/ChatGPT 连接 MCP 后调用 drama_get_skills 即得。",
        triggers: "漫剧前期 · 资产补全 · 人物一致性 · 分镜审查（不用于绕过资产确认直接批量生图）",
    },
    {
        key: "frontend-design",
        icon: <BookOpen className="size-4" />,
        name: "frontend-design",
        source: "项目内置 · .agents/skills/frontend-design",
        desc: "创建有辨识度、可上生产的前端界面：网页、落地页、仪表盘、React 组件、HTML/CSS 布局，避免通用 AI 风格。",
        triggers: "前端界面 · 样式美化 · 组件设计",
    },
    {
        key: "vercel-react-best-practices",
        icon: <Cpu className="size-4" />,
        name: "vercel-react-best-practices",
        source: "项目内置 · .agents/skills/vercel-react-best-practices",
        desc: "Vercel 工程团队的 React/Next.js 性能优化守则：写代码、评审与重构时保证渲染与包体最优。",
        triggers: "React 性能 · Next.js 优化 · 代码评审",
    },
];

export default function SkillsPage() {
    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-6 py-10">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">技能库</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Agent 技能（.agents/skills）随仓库分发；MCP 客户端连接后亦可经 drama_get_skills 获取漫剧生产规范</p>
                </div>
                {SKILLS.map((skill) => (
                    <section key={skill.key} className="rounded-xl border border-border bg-card/40 p-5">
                        <div className="flex items-center gap-2.5">
                            <span className="text-muted-foreground">{skill.icon}</span>
                            <span className="font-mono text-sm font-medium text-foreground">{skill.name}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{skill.desc}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            <span className="text-foreground/70">触发：</span>
                            {skill.triggers}
                        </p>
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <FileText className="size-3.5" />
                            {skill.source}
                        </p>
                    </section>
                ))}
                <p className="text-xs leading-5 text-muted-foreground">
                    想新增技能？把 SKILL.md 与参考资料放入仓库 .agents/skills/&lt;slug&gt;/ 即可被所有会话识别；漫剧生产规范同时焊入{" "}
                    <Link href="/drama" className="underline underline-offset-2">
                        drama_get_skills
                    </Link>
                    。
                </p>
            </div>
        </main>
    );
}
