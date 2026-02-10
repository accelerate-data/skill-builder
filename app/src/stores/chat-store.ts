import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  status: "pending" | "accepted" | "rejected";
}

interface ChatState {
  sessionId: string | null;
  skillName: string | null;
  mode: "conversational" | "review";
  messages: ChatMessage[];
  suggestions: Suggestion[];
  isStreaming: boolean;
  activeAgentId: string | null;

  initSession: (sessionId: string, skillName: string, mode: string) => void;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setStreaming: (streaming: boolean) => void;
  setActiveAgentId: (id: string | null) => void;
  setMode: (mode: "conversational" | "review") => void;
  addSuggestion: (s: Suggestion) => void;
  setSuggestions: (s: Suggestion[]) => void;
  updateSuggestionStatus: (id: string, status: Suggestion["status"]) => void;
  clearSuggestions: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  skillName: null,
  mode: "conversational",
  messages: [],
  suggestions: [],
  isStreaming: false,
  activeAgentId: null,

  initSession: (sessionId, skillName, mode) =>
    set({
      sessionId,
      skillName,
      mode: mode as "conversational" | "review",
      messages: [],
      suggestions: [],
      isStreaming: false,
      activeAgentId: null,
    }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setMessages: (msgs) => set({ messages: msgs }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setActiveAgentId: (id) => set({ activeAgentId: id }),

  setMode: (mode) => set({ mode }),

  addSuggestion: (s) =>
    set((state) => ({ suggestions: [...state.suggestions, s] })),

  setSuggestions: (suggestions) => set({ suggestions }),

  updateSuggestionStatus: (id, status) =>
    set((state) => ({
      suggestions: state.suggestions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    })),

  clearSuggestions: () => set({ suggestions: [] }),

  reset: () =>
    set({
      sessionId: null,
      skillName: null,
      mode: "conversational",
      messages: [],
      suggestions: [],
      isStreaming: false,
      activeAgentId: null,
    }),
}));
