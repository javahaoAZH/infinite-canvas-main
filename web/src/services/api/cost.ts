import { apiGet } from "@/services/api/request";

export type CostModelSummary = {
    model: string;
    calls: number;
    failedCalls: number;
    credits: number;
    lastCallAt: string;
};

export type CostDailySummary = {
    date: string;
    calls: number;
    credits: number;
};

export type UserCostSummary = {
    days: number;
    calls: number;
    successCalls: number;
    failedCalls: number;
    credits: number;
    durationMs: number;
    models: CostModelSummary[];
    daily: CostDailySummary[];
};

export async function getUserCostSummary(token: string, days?: number) {
    return apiGet<UserCostSummary>("/api/v1/cost/summary", days ? { days } : undefined, token);
}
