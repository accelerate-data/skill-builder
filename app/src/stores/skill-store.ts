import { create } from "zustand";

interface SkillState {
  activeSkillId: string | null;
  lockedSkills: Set<string>;
  latestVersion: string | null;
  setActiveSkill: (skillId: string | null) => void;
  setLockedSkills: (names: Set<string>) => void;
  setLatestVersion: (version: string) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  activeSkillId: null,
  lockedSkills: new Set(),
  latestVersion: null,
  setActiveSkill: (skillId) => set({ activeSkillId: skillId }),
  setLockedSkills: (names) => set({ lockedSkills: names }),
  setLatestVersion: (version) => set({ latestVersion: version }),
}));
