import { create } from "zustand";

interface SkillState {
  activeSkill: string | null;
  lockedSkills: Set<string>;
  latestVersion: string | null;
  setActiveSkill: (name: string | null) => void;
  setLockedSkills: (names: Set<string>) => void;
  setLatestVersion: (version: string) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  activeSkill: null,
  lockedSkills: new Set(),
  latestVersion: null,
  setActiveSkill: (name) => set({ activeSkill: name }),
  setLockedSkills: (names) => set({ lockedSkills: names }),
  setLatestVersion: (version) => set({ latestVersion: version }),
}));
