"use client";

import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Card, Empty, Segmented, Spin, Statistic, Table, Tag, Typography, type TableProps } from "antd";

import { getUserCostSummary, type CostDailySummary, type CostModelSummary } from "@/services/api/cost";
import { useUserStore } from "@/stores/use-user-store";

const DAY_OPTIONS = [
    { label: "近 7 天", value: 7 },
    { label: "近 30 天", value: 30 },
    { label: "近 90 天", value: 90 },
];

const modelColumns: TableProps<CostModelSummary>["columns"] = [
    { title: "模型", dataIndex: "model", key: "model", ellipsis: true },
    { title: "调用数", dataIndex: "calls", key: "calls", width: 100, sorter: (a, b) => a.calls - b.calls },
    {
        title: "失败数",
        dataIndex: "failedCalls",
        key: "failedCalls",
        width: 100,
        sorter: (a, b) => a.failedCalls - b.failedCalls,
        render: (value: number) => (value > 0 ? <Tag color="red">{value}</Tag> : <span className="text-stone-400 dark:text-stone-500">0</span>),
    },
    { title: "算力点", dataIndex: "credits", key: "credits", width: 110, defaultSortOrder: "descend", sorter: (a, b) => a.credits - b.credits },
    {
        title: "最近调用",
        dataIndex: "lastCallAt",
        key: "lastCallAt",
        width: 170,
        render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-"),
    },
];

const dailyColumns: TableProps<CostDailySummary>["columns"] = [
    { title: "日期", dataIndex: "date", key: "date" },
    { title: "调用数", dataIndex: "calls", key: "calls", width: 120 },
    { title: "算力点", dataIndex: "credits", key: "credits", width: 120 },
];

export default function CostPage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [days, setDays] = useState(30);

    const query = useQuery({
        queryKey: ["cost-summary", days],
        queryFn: () => getUserCostSummary(token as string, days),
        enabled: Boolean(token),
        retry: false,
    });

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : "获取成本统计失败");
        }
    }, [message, query.error, query.isError]);

    const summary = query.data;

    if (!summary) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spin />
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="pb-8 text-center">
                    <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">成本统计</h1>
                    <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">查看你的 AI 调用量、算力点消耗与各模型明细。</p>
                </div>

                <div className="mx-auto flex max-w-5xl flex-col gap-5">
                    <div className="flex justify-center">
                        <Segmented options={DAY_OPTIONS} value={days} onChange={(value) => setDays(Number(value))} />
                    </div>

                    <Spin spinning={query.isFetching}>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Card>
                                <Statistic title="总调用次数" value={summary.calls} suffix={<span className="text-sm text-stone-400 dark:text-stone-500">成功 {summary.successCalls}</span>} />
                            </Card>
                            <Card>
                                <Statistic title="算力点合计" value={summary.credits} />
                            </Card>
                            <Card>
                                <Statistic title="失败次数" value={summary.failedCalls} valueStyle={summary.failedCalls > 0 ? { color: "#dc2626" } : undefined} />
                            </Card>
                            <Card>
                                <Statistic title="总耗时" value={formatDuration(summary.durationMs)} />
                            </Card>
                        </div>

                        <Card className="mt-5">
                            <Typography.Title level={5} className="!mb-4">
                                按模型明细
                            </Typography.Title>
                            <Table
                                rowKey="model"
                                size="middle"
                                columns={modelColumns}
                                dataSource={summary.models}
                                pagination={false}
                                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" /> }}
                            />
                        </Card>

                        <Card className="mb-8">
                            <Typography.Title level={5} className="!mb-4">
                                按天趋势
                            </Typography.Title>
                            <Table
                                rowKey="date"
                                size="middle"
                                columns={dailyColumns}
                                dataSource={summary.daily}
                                pagination={false}
                                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" /> }}
                            />
                        </Card>
                    </Spin>
                </div>
            </main>
        </div>
    );
}

function formatDuration(ms: number) {
    if (ms < 1000) return `${ms} 毫秒`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${minutes.toFixed(1)} 分钟`;
    return `${(minutes / 60).toFixed(1)} 小时`;
}
