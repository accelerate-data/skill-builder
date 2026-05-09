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
  // setActiveSkill is the "full activation" action: it sets both the runtime
  // session identity (activeSkill) and the routing intent (selectedSkillName).
  // This coupling is intentional — a user selecting a skill from the list
  // should both route to it and establish it as the active session.
  // Use setSelectedSkillName alone when only routing intent should change
  // (e.g. sidebar navigation to an already-active skill).
  setActiveSkill: (name) => set({ activeSkill: name, selectedSkillName: name }),
  setSelectedSkillName: (name) => set({ selectedSkillName: name }),
  setActiveSessionSkillName: (name) => set({ activeSessionSkillName: name }),
  setLockedSkills: (names) => set({ lockedSkills: names }),
  setLatestVersion: (version) => set({ latestVersion: version }),
}));
