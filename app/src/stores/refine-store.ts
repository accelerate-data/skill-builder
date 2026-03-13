import { create } from "zustand";
import type { RefineDiff, SkillSummary } from "@/lib/types";

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
  gitDiff: RefineDiff | null;
  previewRevision: number;

  // Chat messages
  messages: RefineMessage[];

  // Agent state
  activeAgentId: string | null;
  isRunning: boolean;
  sessionId: string | null;
  sessionExhausted: boolean;

  // Pending initial message (from Test page -> Refine page navigation)
  pendingInitialMessage: string | null;
  setPendingInitialMessage: (msg: string | null) => void;

  // Actions
  setRefinableSkills: (skills: SkillSummary[]) => void;
  setLoadingSkills: (v: boolean) => void;
  selectSkill: (skill: SkillSummary | null) => void;
  setSkillFiles: (files: SkillFile[]) => void;
  setLoadingFiles: (v: boolean) => void;
  setActiveFileTab: (filename: string) => void;
  setDiffMode: (v: boolean) => void;
  addUserMessage: (text: string, targetFiles?: string[], command?: RefineCommand) => RefineMessage;
  addAgentTurn: (agentId: string) => RefineMessage;
  updateSkillFiles: (files: SkillFile[]) => void;
  setGitDiff: (diff: RefineDiff | null) => void;
  setActiveAgentId: (id: string | null) => void;
  setRunning: (v: boolean) => void;
  setSessionId: (id: string | null) => void;
  setSessionExhausted: (v: boolean) => void;
  clearSession: () => void;
}

export function isAuthoredSkillFile(filename: string): boolean {
  return filename === "SKILL.md" || filename.startsWith("references/");
}

/** Session state that resets when switching skills or clearing the session. */
const SESSION_DEFAULTS = {
  messages: [] as RefineMessage[],
  activeAgentId: null as string | null,
  isRunning: false,
  sessionId: null as string | null,
  sessionExhausted: false,
  diffMode: false,
  gitDiff: null as RefineDiff | null,
  previewRevision: 0,
  skillFiles: [] as SkillFile[],
  activeFileTab: "SKILL.md",
  // pendingInitialMessage is intentionally excluded: it is cross-page navigation
  // state set by the test page and consumed by ChatInputBar. Including it here
  // caused React StrictMode's simulated unmount (and normal page-unmount cleanup)
  // to wipe the message before ChatInputBar could render and read it.
} as const;

export const useRefineStore = create<RefineState>((set) => ({
  // Initial state
  selectedSkill: null,
  refinableSkills: [],
  isLoadingSkills: false,
  isLoadingFiles: false,
  pendingInitialMessage: null,
  ...SESSION_DEFAULTS,

  // Actions
  setPendingInitialMessage: (msg) => set({ pendingInitialMessage: msg }),
  setRefinableSkills: (skills) => set({ refinableSkills: skills }),
  setLoadingSkills: (v) => set({ isLoadingSkills: v }),

  selectSkill: (skill) =>
    set({ selectedSkill: skill, ...SESSION_DEFAULTS }),

  setSkillFiles: (files) =>
    set((state) => ({
      skillFiles: files,
      isLoadingFiles: false,
      previewRevision: state.previewRevision + 1,
    })),
  setLoadingFiles: (v) => set({ isLoadingFiles: v }),
  setActiveFileTab: (filename) => set({ activeFileTab: filename }),
  setDiffMode: (v) => set({ diffMode: v }),

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

  updateSkillFiles: (files) => set((state) => {
    const existingFiles = new Set(state.skillFiles.map((file) => file.filename));
    const firstNewAuthoredFile = files.find((file) =>
      !existingFiles.has(file.filename) && isAuthoredSkillFile(file.filename)
    )?.filename;
    const activeStillExists = files.some((file) => file.filename === state.activeFileTab);
    const activeStillEligible = isAuthoredSkillFile(state.activeFileTab);
    const firstEligibleFile = files.find((file) => isAuthoredSkillFile(file.filename))?.filename;
    const nextActive = firstNewAuthoredFile
      ?? (activeStillExists && activeStillEligible
        ? state.activeFileTab
        : (firstEligibleFile ?? "SKILL.md"));
    return {
      skillFiles: files,
      activeFileTab: nextActive,
      previewRevision: state.previewRevision + 1,
    };
  }),

  setGitDiff: (diff) => set({ gitDiff: diff }),

  setActiveAgentId: (id) => set({ activeAgentId: id }),
  setRunning: (v) => set({ isRunning: v }),
  setSessionId: (id) => set({ sessionId: id }),
  setSessionExhausted: (v) => set({ sessionExhausted: v }),

  clearSession: () => set(SESSION_DEFAULTS),
}));
