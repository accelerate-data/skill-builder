import { create } from "zustand";
import type { UsageSummary, WorkflowSessionRecord, UsageByStep, UsageByModel, UsageByDay, AgentRunRecord } from "@/lib/types";
import { getUsageSummary, getRecentWorkflowSessions, getUsageByStep, getUsageByModel, getUsageByDay, resetUsage, getWorkflowSkillNames, getAgentRuns } from "@/lib/tauri";

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
  agentRuns: AgentRunRecord[];
  byStep: UsageByStep[];
  byModel: UsageByModel[];
  byDay: UsageByDay[];
  loading: boolean;
  error: string | null;
  hideCancelled: boolean;
  dateRange: DateRange;
  skillFilter: string | null;
  modelFamilyFilter: string | null;
  skillNames: string[];
  loadGeneration: number;

  fetchUsage: () => Promise<void>;
  fetchSkillNames: () => Promise<void>;
  resetCounter: () => Promise<void>;
  toggleHideCancelled: () => void;
  setDateRange: (range: DateRange) => void;
  setSkillFilter: (skill: string | null) => void;
  setModelFamilyFilter: (family: string | null) => void;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  summary: null,
  recentSessions: [],
  agentRuns: [],
  byStep: [],
  byModel: [],
  byDay: [],
  loading: false,
  error: null,
  hideCancelled: false,
  dateRange: "all",
  skillFilter: null,
  modelFamilyFilter: null,
  skillNames: [],
  loadGeneration: 0,

  fetchUsage: async () => {
    const { hideCancelled, dateRange, skillFilter, modelFamilyFilter } = get();
    const startDate = toStartDate(dateRange);
    const generation = get().loadGeneration + 1;
    set({ loading: true, error: null, loadGeneration: generation });
    try {
      const [summary, recentSessions, agentRuns, byStep, byModel, byDay] = await Promise.all([
        getUsageSummary(hideCancelled, startDate, skillFilter),
        getRecentWorkflowSessions(50, hideCancelled, startDate, skillFilter),
        getAgentRuns(hideCancelled, startDate, skillFilter, modelFamilyFilter),
        getUsageByStep(hideCancelled, startDate, skillFilter),
        getUsageByModel(hideCancelled, startDate, skillFilter),
        getUsageByDay(hideCancelled, startDate, skillFilter),
      ]);
      if (get().loadGeneration !== generation) return;
      set({ summary, recentSessions, agentRuns, byStep, byModel, byDay, loading: false });
    } catch (err) {
      if (get().loadGeneration !== generation) return;
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
    const { hideCancelled, dateRange } = get();
    const startDate = toStartDate(dateRange);
    set({ loading: true, error: null });
    try {
      await resetUsage();
      const [summary, recentSessions, agentRuns, byStep, byModel, byDay] = await Promise.all([
        getUsageSummary(hideCancelled, startDate, null),
        getRecentWorkflowSessions(50, hideCancelled, startDate, null),
        getAgentRuns(hideCancelled, startDate, null, null),
        getUsageByStep(hideCancelled, startDate, null),
        getUsageByModel(hideCancelled, startDate, null),
        getUsageByDay(hideCancelled, startDate, null),
      ]);
      set({ summary, recentSessions, agentRuns, byStep, byModel, byDay, loading: false, skillFilter: null, modelFamilyFilter: null, skillNames: [] });
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

  setModelFamilyFilter: (family: string | null) => {
    set({ modelFamilyFilter: family });
    get().fetchUsage();
  },
}));