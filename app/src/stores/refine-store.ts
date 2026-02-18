import { create } from "zustand";
import type { SkillSummary } from "@/lib/types";

export interface SkillFile {
  filename: string; // e.g. "SKILL.md", "references/domain-glossary.md"
  content: string;
}

export type RefineMessageRole = "user" | "agent";
export type RefineCommand = "rewrite" | "validate";

export interface RefineMessage {
  id: string;
  role: RefineMessageRole;
  agentId?: string; // set for "agent" role — links to agent-store run
  userText?: string; // set for "user" role
  targetFiles?: string[]; // files targeted with @mentions
  command?: RefineCommand; // slash command used (e.g., /rewrite, /validate)
  timestamp: number;
}

interface RefineState {
  // Skill picker
  selectedSkill: SkillSummary | null;
  refinableSkills: SkillSummary[];
  isLoadingSkills: boolean;

  // Skill file content (for preview panel)
  skillFiles: SkillFile[];
  isLoadingFiles: boolean;

  // Preview panel
  activeFileTab: string; // filename key e.g. "SKILL.md"
  diffMode: boolean;
  baselineFiles: SkillFile[]; // snapshot before agent run

  // Chat messages
  messages: RefineMessage[];

  // Agent state
  activeAgentId: string | null;
  isRunning: boolean;
  sessionId: string | null;

  // Actions
  setRefinableSkills: (skills: SkillSummary[]) => void;
  setLoadingSkills: (v: boolean) => void;
  selectSkill: (skill: SkillSummary | null) => void;
  setSkillFiles: (files: SkillFile[]) => void;
  setLoadingFiles: (v: boolean) => void;
  setActiveFileTab: (filename: string) => void;
  setDiffMode: (v: boolean) => void;
  snapshotBaseline: () => void;
  addUserMessage: (text: string, targetFiles?: string[], command?: RefineCommand) => RefineMessage;
  addAgentTurn: (agentId: string) => RefineMessage;
  updateSkillFiles: (files: SkillFile[]) => void;
  setActiveAgentId: (id: string | null) => void;
  setRunning: (v: boolean) => void;
  clearSession: () => void;
}

/** Session state that resets when switching skills or clearing the session. */
const SESSION_DEFAULTS = {
  messages: [] as RefineMessage[],
  activeAgentId: null as string | null,
  isRunning: false,
  sessionId: null as string | null,
  diffMode: false,
  baselineFiles: [] as SkillFile[],
  skillFiles: [] as SkillFile[],
  activeFileTab: "SKILL.md",
} as const;

export const useRefineStore = create<RefineState>((set, get) => ({
  // Initial state
  selectedSkill: null,
  refinableSkills: [],
  isLoadingSkills: false,
  isLoadingFiles: false,
  ...SESSION_DEFAULTS,

  // Actions
  setRefinableSkills: (skills) => set({ refinableSkills: skills }),
  setLoadingSkills: (v) => set({ isLoadingSkills: v }),

  selectSkill: (skill) =>
    set({ selectedSkill: skill, ...SESSION_DEFAULTS }),

  setSkillFiles: (files) => set({ skillFiles: files, isLoadingFiles: false }),
  setLoadingFiles: (v) => set({ isLoadingFiles: v }),
  setActiveFileTab: (filename) => set({ activeFileTab: filename }),
  setDiffMode: (v) => set({ diffMode: v }),

  snapshotBaseline: () => {
    const { skillFiles } = get();
    set({ baselineFiles: skillFiles.map((f) => ({ ...f })) });
  },

  addUserMessage: (text, targetFiles, command) => {
    const message: RefineMessage = {
      id: crypto.randomUUID(),
      role: "user",
      userText: text,
      targetFiles,
      command,
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, message] }));
    return message;
  },

  addAgentTurn: (agentId) => {
    const message: RefineMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      agentId,
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, message] }));
    return message;
  },

  updateSkillFiles: (files) => set({ skillFiles: files }),

  setActiveAgentId: (id) => set({ activeAgentId: id }),
  setRunning: (v) => set({ isRunning: v }),

  clearSession: () => set(SESSION_DEFAULTS),
}));
