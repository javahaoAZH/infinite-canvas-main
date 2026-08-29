---
title: TODO
description: 当前项目后续值得处理的事项
---

# TODO

本文档用来记录当前项目后续比较值得处理的事项。

- 桌面 exe 依赖系统已安装 WebView2 Runtime，后续可评估随包提供 Evergreen Bootstrapper 或在缺运行时给出下载引导。
- 桌面构建流程（前端导出 → 复制到 `webui/out` → `go build -tags desktop`）目前是手工三步，后续可整理为单一构建脚本。
