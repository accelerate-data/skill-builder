import { create } from "zustand";

interface SkillState {
  activeSkillId: string | null;
  lockedSkills: Set<number>;
  latestVersion: string | null;
  setActiveSkill: (skillId: string | null) => void;
  setLockedSkills: (ids: Set<number>) => void;
  setLatestVersion: (version: string) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  activeSkillId: null,
  lockedSkills: new Set(),
  latestVersion: null,
  setActiveSkill: (skillId) => set({ activeSkillId: skillId }),
  setLockedSkills: (ids) => set({ lockedSkills: ids }),
  setLatestVersion: (version) => set({ latestVersion: version }),
}));
