import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ChatState {
  sessionId: string | null;
  skillName: string | null;
  mode: "conversational" | "review";
  messages: ChatMessage[];
  isStreaming: boolean;
  activeAgentId: string | null;

  initSession: (sessionId: string, skillName: string, mode: string) => void;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setStreaming: (streaming: boolean) => void;
  setActiveAgentId: (id: string | null) => void;
  setMode: (mode: "conversational" | "review") => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  skillName: null,
  mode: "conversational",
  messages: [],
  isStreaming: false,
  activeAgentId: null,

  initSession: (sessionId, skillName, mode) =>
    set({
      sessionId,
      skillName,
      mode: mode as "conversational" | "review",
      messages: [],
      isStreaming: false,
      activeAgentId: null,
    }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setMessages: (msgs) => set({ messages: msgs }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setActiveAgentId: (id) => set({ activeAgentId: id }),

  setMode: (mode) => set({ mode }),

  reset: () =>
    set({
      sessionId: null,
      skillName: null,
      mode: "conversational",
      messages: [],
      isStreaming: false,
      activeAgentId: null,
    }),
}));
