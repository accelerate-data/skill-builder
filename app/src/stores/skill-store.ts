import { create } from "zustand";
import type { SkillSummary } from "@/lib/tauri";

interface SkillState {
  skills: SkillSummary[];
  activeSkill: string | null;
  isLoading: boolean;
  setSkills: (skills: SkillSummary[]) => void;
  setActiveSkill: (name: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  skills: [],
  activeSkill: null,
  isLoading: false,
  setSkills: (skills) => set({ skills, isLoading: false }),
  setActiveSkill: (name) => set({ activeSkill: name }),
  setLoading: (loading) => set({ isLoading: loading }),
}));
