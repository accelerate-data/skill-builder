import { create } from "zustand";
import type { UsageSummary, WorkflowSessionRecord, UsageByStep, UsageByModel, UsageByDay } from "@/lib/types";
import { getUsageSummary, getRecentWorkflowSessions, getUsageByStep, getUsageByModel, getUsageByDay, resetUsage, getWorkflowSkillNames } from "@/lib/tauri";

export type DateRange = "7d" | "14d" | "30d" | "90d" | "all";

function toStartDate(range: DateRange): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 30 : 90;
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

interface UsageState {
  summary: UsageSummary | null;
  recentSessions: WorkflowSessionRecord[];
  byStep: UsageByStep[];
  byModel: UsageByModel[];
  byDay: UsageByDay[];
  loading: boolean;
  error: string | null;
  hideCancelled: boolean;
  dateRange: DateRange;
  skillFilter: string | null;
  skillNames: string[];

  fetchUsage: () => Promise<void>;
  fetchSkillNames: () => Promise<void>;
  resetCounter: () => Promise<void>;
  toggleHideCancelled: () => void;
  setDateRange: (range: DateRange) => void;
  setSkillFilter: (skill: string | null) => void;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  summary: null,
  recentSessions: [],
  byStep: [],
  byModel: [],
  byDay: [],
  loading: false,
  error: null,
  hideCancelled: false,
  dateRange: "all",
  skillFilter: null,
  skillNames: [],

  fetchUsage: async () => {
    const { hideCancelled, dateRange, skillFilter } = get();
    const startDate = toStartDate(dateRange);
    set({ loading: true, error: null });
    try {
      const [summary, recentSessions, byStep, byModel, byDay] = await Promise.all([
        getUsageSummary(hideCancelled, startDate, skillFilter),
        getRecentWorkflowSessions(50, hideCancelled, startDate, skillFilter),
        getUsageByStep(hideCancelled, startDate, skillFilter),
        getUsageByModel(hideCancelled, startDate, skillFilter),
        getUsageByDay(hideCancelled, startDate, skillFilter),
      ]);
      set({ summary, recentSessions, byStep, byModel, byDay, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchSkillNames: async () => {
    try {
      const skillNames = await getWorkflowSkillNames();
      set({ skillNames });
    } catch {
      // non-critical, silently ignore
    }
  },

  resetCounter: async () => {
    const { hideCancelled, dateRange, skillFilter } = get();
    const startDate = toStartDate(dateRange);
    set({ loading: true, error: null });
    try {
      await resetUsage();
      const [summary, recentSessions, byStep, byModel, byDay] = await Promise.all([
        getUsageSummary(hideCancelled, startDate, skillFilter),
        getRecentWorkflowSessions(50, hideCancelled, startDate, skillFilter),
        getUsageByStep(hideCancelled, startDate, skillFilter),
        getUsageByModel(hideCancelled, startDate, skillFilter),
        getUsageByDay(hideCancelled, startDate, skillFilter),
      ]);
      set({ summary, recentSessions, byStep, byModel, byDay, loading: false, skillFilter: null, skillNames: [] });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  toggleHideCancelled: () => {
    set({ hideCancelled: !get().hideCancelled });
    get().fetchUsage();
  },

  setDateRange: (range: DateRange) => {
    set({ dateRange: range });
    get().fetchUsage();
  },

  setSkillFilter: (skill: string | null) => {
    set({ skillFilter: skill });
    get().fetchUsage();
  },
}));