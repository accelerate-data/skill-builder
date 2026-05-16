import { create } from "zustand";
import type { EditableSkill } from "@/lib/types";

interface SkillState {
  activeSkillId: string | null;
  lockedSkills: Set<number>;
  latestVersion: string | null;
  selectedSkill: EditableSkill | null;
  conversationId: string | null;
  availableAgents: string[];
  activeAgentId: string | null;
  setActiveSkill: (skillId: string | null) => void;
  setLockedSkills: (ids: Set<number>) => void;
  setLatestVersion: (version: string) => void;
  selectSkill: (skill: EditableSkill | null) => void;
  setConversationId: (conversationId: string | null) => void;
  setAvailableAgents: (agents: string[]) => void;
  setActiveAgentId: (agentId: string | null) => void;
  clearSelectedSkillSession: () => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  activeSkillId: null,
  lockedSkills: new Set(),
  latestVersion: null,
  selectedSkill: null,
  conversationId: null,
  availableAgents: [],
  activeAgentId: null,
  setActiveSkill: (skillId) => set({ activeSkillId: skillId }),
  setLockedSkills: (ids) => set({ lockedSkills: ids }),
  setLatestVersion: (version) => set({ latestVersion: version }),
  selectSkill: (skill) =>
    set({
      selectedSkill: skill,
      conversationId: null,
      availableAgents: [],
      activeAgentId: null,
    }),
  setConversationId: (conversationId) => set({ conversationId }),
  setAvailableAgents: (availableAgents) => set({ availableAgents }),
  setActiveAgentId: (activeAgentId) => set({ activeAgentId }),
  clearSelectedSkillSession: () =>
    set({
      selectedSkill: null,
      conversationId: null,
      availableAgents: [],
      activeAgentId: null,
    }),
}));

/** Returns true when the given skill ID is locked by another app instance. */
export function useIsSkillLocked(skillId: number | null | undefined): boolean {
  const lockedSkills = useSkillStore((s) => s.lockedSkills);
  return skillId != null && lockedSkills.has(skillId);
}
