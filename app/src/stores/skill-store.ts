import { create } from "zustand";

interface SkillState {
  activeSkill: string | null;
  selectedSkillName: string | null;
  activeSessionSkillName: string | null;
  lockedSkills: Set<string>;
  latestVersion: string | null;
  setActiveSkill: (name: string | null) => void;
  setSelectedSkillName: (name: string | null) => void;
  setActiveSessionSkillName: (name: string | null) => void;
  setLockedSkills: (names: Set<string>) => void;
  setLatestVersion: (version: string) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  activeSkill: null,
  selectedSkillName: null,
  activeSessionSkillName: null,
  lockedSkills: new Set(),
  latestVersion: null,
  setActiveSkill: (name) => set({ activeSkill: name, selectedSkillName: name }),
  setSelectedSkillName: (name) => set({ selectedSkillName: name }),
  setActiveSessionSkillName: (name) => set({ activeSessionSkillName: name }),
  setLockedSkills: (names) => set({ lockedSkills: names }),
  setLatestVersion: (version) => set({ latestVersion: version }),
}));
