# 质量闸门

## G0 原文覆盖

每个重要原文片段有明确去向；sourceEvidence 能逐字定位；原文推断与改编设计没有伪装成原文事实。

## G1 资产完整

每镜 assetRefs 非空、引用 key 存在；全部可见实体和复杂接触动作可反查资产；每项资产有交付件、默认参考职责、生成提示词、禁止变化、逐图验收项且依赖无缺失；多文件资产选择本镜文件或状态。人物、场景、核心道具、特效、风格和声音均有对应生产条目。

## G2 母版确认

所需资产均已确认并有当前版本文件；角色 on-model；核心道具的结构、数量、材质和配色可比较。出场角色除全身四视图外，还必须有已确认的正面身份特写、所需头部角度、面部结构控制参考和半身衔接母版；缺一项不得进入表情、剧情图或分镜生产。

## G3 连续性

每镜起止状态完整；相邻镜的姿势、方向、视线、持物、服装/伤势、道具位置和环境状态可衔接；动作与时长匹配，接触和受力合理。

## G4 代表关键帧

先选择最易失败的 2–4 镜：多角色、复杂场景、核心道具、手部接触、强特效或极端角度。人物镜逐项标明身份、结构/姿态、场景与风格参考的用途及主次；主身份参考必须实际进入生成请求。逐项对比参考后由用户确认，失败稿不得注入项目或成为后续参考。

## G5 批量与视频

只有 G0–G4 全部通过才批量生图。视频以确认首帧为基础；人物身份、道具结构和场景布局不交给运动提示词重新设计。

## 研究依据

- 角色模型表统一多角度、姿态和表情，并被分镜与动画共同引用：[ScreenSkills](https://www.screenskills.com/job-profiles/roles/character-designer/)、[Toon Boom](https://learn.toonboom.com/modules/character-design1/topic/character-model-sheets1)。
- 分镜把剧本转成连续画面并规划 staging、动作和镜头连续性：[ScreenSkills Storyboard](https://www.screenskills.com/job-profiles/browse/animation/pre-production/storyboard-artist/)、[Toon Boom Layout Posing](https://learn.toonboom.com/modules/layout-cleanup/topic/what-is-layout-posing)。
- 多参考用于锁定角色、场景、物体及主体交互：[Runway References](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References)、[Runway Advanced](https://help.runwayml.com/hc/en-us/articles/41170686463635-Advanced-References-Use-Cases)、[快手可灵](https://ir.kuaishou.com/zh-hans/news-releases/news-release-details/kuaishoukelingaituichuduotucankaogongneng/)。
- 视频提示明确摄影、主体、动作、环境和风格：[Google Veo](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide?hl=zh-CN)、[Veo 3.1](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1)。
