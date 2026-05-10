import { create } from "zustand";
import type { RefineDiff, EditableSkill } from "@/lib/types";
import { useAgentStore } from "@/stores/agent-store";

export interface SkillFile {
  filename: string; // e.g. "SKILL.md", "references/domain-glossary.md"
  content: string;
}

export interface RefineQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface RefineQuestionPrompt {
  question: string;
  header: string;
  options: RefineQuestionOption[];
  multiSelect?: boolean;
}

export interface RefineQuestionResponse {
  answers: Record<string, string | string[]>;
  selectedLabels: string[];
  customText?: string;
}

export type RefineMessageRole = "user" | "agent" | "question";

export interface RefineMessage {
  id: string;
  role: RefineMessageRole;
  agentId?: string; // set for "agent" role — links to agent-store run
  agentText?: string; // restored agent text when rehydrating persisted history
  hideTaskSent?: boolean;
  userText?: string; // set for "user" role
  targetFiles?: string[]; // files targeted with @mentions
  toolUseId?: string;
  questions?: RefineQuestionPrompt[];
  pending?: boolean;
  response?: RefineQuestionResponse;
  displayItemSplitIndex?: number; // display item count when question was asked — splits agent turn
  diff?: RefineDiff; // attached after agent turn completes with file changes
  timestamp: number;
}

interface RefineState {
  // Skill picker
  selectedSkill: EditableSkill | null;
  refinableSkills: EditableSkill[];
  isLoadingSkills: boolean;

  // Skill file content (for preview panel)
  skillFiles: SkillFile[];
  isLoadingFiles: boolean;

  // Preview panel
  activeFileTab: string; // filename key e.g. "SKILL.md"
  selectedModifiedFile: string | null;
  diffMode: boolean;
  gitDiff: RefineDiff | null;
  previewRevision: number;

  // Chat messages
  messages: RefineMessage[];
  pendingFollowupMessage: string | null;

  // Agent state
  activeAgentId: string | null;
  isRunning: boolean;
  isStopping: boolean;
  conversationId: string | null;
  sessionExhausted: boolean;
  /** Agent names discovered from allowed refine plugins (e.g. "skill-creator:rewrite-skill"). */
  availableAgents: string[];

  // Pending initial message (from Test page -> Refine page navigation)
  pendingInitialMessage: string | null;
  setPendingInitialMessage: (msg: string | null) => void;

  // Actions
  setRefinableSkills: (skills: EditableSkill[]) => void;
  setLoadingSkills: (v: boolean) => void;
  setSelectedSkill: (skill: EditableSkill | null) => void;
  selectSkill: (skill: EditableSkill | null) => void;
  setSkillFiles: (files: SkillFile[]) => void;
  setLoadingFiles: (v: boolean) => void;
  setActiveFileTab: (filename: string) => void;
  setSelectedModifiedFile: (filename: string | null) => void;
  setDiffMode: (v: boolean) => void;
  addUserMessage: (text: string, targetFiles?: string[]) => RefineMessage;
  addAgentTurn: (agentId: string) => RefineMessage;
  attachDiffToLastAgentTurn: (diff: RefineDiff) => void;
  addQuestionMessage: (
    agentId: string,
    toolUseId: string,
    questions: RefineQuestionPrompt[],
  ) => RefineMessage;
  answerQuestionMessage: (
    messageId: string,
    response: RefineQuestionResponse,
  ) => void;
  updateSkillFiles: (files: SkillFile[]) => void;
  setGitDiff: (diff: RefineDiff | null) => void;
  setActiveAgentId: (id: string | null) => void;
  setRunning: (v: boolean) => void;
  setStopping: (v: boolean) => void;
  setConversationId: (id: string | null) => void;
  setSessionExhausted: (v: boolean) => void;
  setAvailableAgents: (agents: string[]) => void;
  setPendingFollowupMessage: (message: string | null) => void;
  setMessages: (messages: RefineMessage[]) => void;
  clearSession: () => void;
}

export function isAuthoredSkillFile(filename: string): boolean {
  return filename === "SKILL.md" || filename.startsWith("references/");
}

/** Session state that resets when switching skills or clearing the session. */
const SESSION_DEFAULTS = {
  messages: [] as RefineMessage[],
  pendingFollowupMessage: null as string | null,
  activeAgentId: null as string | null,
  isRunning: false,
  isStopping: false,
  conversationId: null as string | null,
  sessionExhausted: false,
  availableAgents: [] as string[],
  diffMode: false,
  gitDiff: null as RefineDiff | null,
  previewRevision: 0,
  skillFiles: [] as SkillFile[],
  activeFileTab: "SKILL.md",
  selectedModifiedFile: null as string | null,
  // pendingInitialMessage is intentionally excluded: it is cross-page navigation
  // state set by the test page and consumed by ChatInputBar. Including it here
  // caused React StrictMode's simulated unmount (and normal page-unmount cleanup)
  // to wipe the message before ChatInputBar could render and read it.
} as const;

export const useRefineStore = create<RefineState>((set, get) => ({
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
  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  selectSkill: (skill) => set({ selectedSkill: skill, ...SESSION_DEFAULTS }),

  setSkillFiles: (files) =>
    set((state) => ({
      skillFiles: files,
      isLoadingFiles: false,
      previewRevision: state.previewRevision + 1,
    })),
  setLoadingFiles: (v) => set({ isLoadingFiles: v }),
  setActiveFileTab: (filename) => set({ activeFileTab: filename }),
  setSelectedModifiedFile: (filename) =>
    set({ selectedModifiedFile: filename }),
  setDiffMode: (v) => set({ diffMode: v }),

  addUserMessage: (text, targetFiles) => {
    const message: RefineMessage = {
      id: crypto.randomUUID(),
      role: "user",
      userText: text,
      targetFiles,
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

  attachDiffToLastAgentTurn: (diff) =>
    set((state) => {
      const idx = [...state.messages]
        .reverse()
        .findIndex((m) => m.role === "agent");
      if (idx === -1) return {};
      const actualIdx = state.messages.length - 1 - idx;
      const updated = [...state.messages];
      updated[actualIdx] = { ...updated[actualIdx], diff };
      return { messages: updated };
    }),

  addQuestionMessage: (agentId, toolUseId, questions): RefineMessage => {
    const existingMessage = get().messages.find(
      (message) =>
        message.role === "question" && message.toolUseId === toolUseId,
    );
    if (existingMessage) {
      return existingMessage;
    }

    const displayItemSplitIndex =
      useAgentStore.getState().runs[agentId]?.displayItems?.length ?? 0;
    const message: RefineMessage = {
      id: crypto.randomUUID(),
      role: "question",
      agentId,
      toolUseId,
      questions,
      pending: true,
      displayItemSplitIndex,
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, message] }));
    return message;
  },

  answerQuestionMessage: (messageId, response) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              pending: false,
              response,
            }
          : message,
      ),
    })),

  updateSkillFiles: (files) =>
    set((state) => {
      const existingFiles = new Set(
        state.skillFiles.map((file) => file.filename),
      );
      const nextFileNames = new Set(files.map((file) => file.filename));
      const firstNewAuthoredFile = files.find(
        (file) =>
          !existingFiles.has(file.filename) &&
          isAuthoredSkillFile(file.filename),
      )?.filename;
      const activeStillExists = files.some(
        (file) => file.filename === state.activeFileTab,
      );
      const activeStillEligible = isAuthoredSkillFile(state.activeFileTab);
      const firstEligibleFile = files.find((file) =>
        isAuthoredSkillFile(file.filename),
      )?.filename;
      const nextActive =
        firstNewAuthoredFile ??
        (activeStillExists && activeStillEligible
          ? state.activeFileTab
          : (firstEligibleFile ?? "SKILL.md"));
      return {
        skillFiles: files,
        activeFileTab: nextActive,
        selectedModifiedFile:
          state.selectedModifiedFile &&
          nextFileNames.has(state.selectedModifiedFile)
            ? state.selectedModifiedFile
            : null,
        previewRevision: state.previewRevision + 1,
      };
    }),

  setGitDiff: (diff) =>
    set((state) => {
      if (!diff) {
        return {
          gitDiff: null,
          selectedModifiedFile: null,
        };
      }
      const diffPaths = new Set(
        diff.files
          .map((file) => {
            const parts = file.path.split("/");
            return parts.length > 1 ? parts.slice(1).join("/") : file.path;
          })
          .filter((path) => isAuthoredSkillFile(path)),
      );
      return {
        gitDiff: diff,
        selectedModifiedFile:
          state.selectedModifiedFile &&
          diffPaths.has(state.selectedModifiedFile)
            ? state.selectedModifiedFile
            : null,
      };
    }),

  setActiveAgentId: (id) => set({ activeAgentId: id }),
  setRunning: (v) => set({ isRunning: v }),
  setStopping: (v) => set({ isStopping: v }),
  setConversationId: (id) => set({ conversationId: id }),
  setSessionExhausted: (v) => set({ sessionExhausted: v }),
  setAvailableAgents: (agents) => set({ availableAgents: agents }),
  setPendingFollowupMessage: (message) =>
    set({ pendingFollowupMessage: message }),
  setMessages: (messages) => set({ messages }),

  clearSession: () => set(SESSION_DEFAULTS),
}));
