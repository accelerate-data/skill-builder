import { create } from "zustand";
import type { DateRange } from "@/lib/queries/usage";

export type { DateRange } from "@/lib/queries/usage";

interface UsageState {
  hideCancelled: boolean;
  dateRange: DateRange;
  skillFilter: string | null;
  modelFamilyFilter: string | null;
  toggleHideCancelled: () => void;
  setDateRange: (range: DateRange) => void;
  setSkillFilter: (skill: string | null) => void;
  setModelFamilyFilter: (family: string | null) => void;
  resetFilters: () => void;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  hideCancelled: false,
  dateRange: "all",
  skillFilter: null,
  modelFamilyFilter: null,
  toggleHideCancelled: () => set({ hideCancelled: !get().hideCancelled }),
  setDateRange: (range) => set({ dateRange: range }),
  setSkillFilter: (skill) => set({ skillFilter: skill }),
  setModelFamilyFilter: (family) => set({ modelFamilyFilter: family }),
  resetFilters: () => set({ skillFilter: null, modelFamilyFilter: null }),
}));
