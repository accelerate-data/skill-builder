import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WorkspaceRefine } from "@/components/workspace/workspace-refine";
import type { SkillSummary } from "@/lib/types";

// --- Tauri mock ---
const tauriMocks = vi.hoisted(() => ({
  acquireLock: vi.fn().mockResolvedValue(undefined),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  startRefineSession: vi.fn().mockResolvedValue({
    conversation_id: "conv-1",
    available_agents: [],
    restored_messages: [],
    restored_transcript_events: [],
  }),
  closeRefineSession: vi.fn().mockResolvedValue(undefined),
  getSkillContentForRefine: vi.fn().mockResolvedValue([]),
  sendRefineMessage: vi.fn().mockResolvedValue("agent-1"),
  cancelAgentRun: vi.fn().mockResolvedValue(undefined),
  finalizeRefineRun: vi.fn().mockResolvedValue({ files: [], diff: null }),
}));

vi.mock("@/lib/tauri", () => tauriMocks);

vi.mock("@/lib/agent-results", () => ({
  extractStructuredResultPayload: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

// --- Router mock ---
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// --- Store mocks ---
const settingsStoreState = vi.hoisted(() => ({
  workspacePath: "/workspace",
  modelSettings: { model: null as string | null },
  availableModels: [] as unknown[],
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn((selector: (s: typeof settingsStoreState) => unknown) =>
    selector(settingsStoreState),
  ),
}));

const refineStoreState = vi.hoisted(() => ({
  selectedSkill: null as SkillSummary | null,
  skillFiles: [] as { filename: string; content: string }[],
  previewRevision: 0,
  selectedModifiedFile: null as string | null,
  isRunning: false,
  activeAgentId: null as string | null,
  conversationId: null as string | null,
  sessionExhausted: false,
  selectSkill: vi.fn(),
  setLoadingFiles: vi.fn(),
  setSkillFiles: vi.fn(),
  setGitDiff: vi.fn(),
  setActiveFileTab: vi.fn(),
  setSelectedModifiedFile: vi.fn(),
  setConversationId: vi.fn(),
  setRunning: vi.fn(),
  setActiveAgentId: vi.fn(),
  setAvailableAgents: vi.fn(),
  setMessages: vi.fn(),
  setPendingFollowupMessage: vi.fn(),
  addUserMessage: vi.fn(),
  addAgentTurn: vi.fn(),
  updateSkillFiles: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock("@/stores/refine-store", () => ({
  useRefineStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => selector(refineStoreState)),
    { getState: () => refineStoreState },
  ),
}));

const agentStoreState = vi.hoisted(() => ({
  runs: {} as Record<string, unknown>,
  clearRuns: vi.fn(),
  clearRunsBySource: vi.fn(),
  registerRun: vi.fn(),
  addConversationEvent: vi.fn(),
  applyConversationState: vi.fn(),
  completeRun: vi.fn(),
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => selector(agentStoreState)),
    { getState: () => agentStoreState },
  ),
}));

// --- Hook mocks ---
vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: () => ({
    blockerStatus: "idle",
    handleNavStay: vi.fn(),
    handleNavLeave: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-scope-blocked", () => ({
  useScopeBlocked: () => false,
}));

const agentStreamMocks = vi.hoisted(() => ({
  initAgentStream: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-agent-stream", () => agentStreamMocks);

// --- Child component mocks ---
vi.mock("@/components/refine/chat-panel", () => ({
  ChatPanel: ({ onSend }: { onSend: (text: string) => void }) => (
    <button data-testid="chat-panel" onClick={() => onSend("Refine this")}>
      Send
    </button>
  ),
}));

// --- Helpers ---
function makeSkill(name: string): SkillSummary {
  return {
    name,
    status: "completed",
    current_step: null,
    last_modified: null,
    tags: [],
    purpose: null,
    skill_source: "skill-builder",
    author_login: null,
    author_avatar: null,
    intake_json: null,
    plugin_slug: "skills",
    plugin_display_name: "Skills",
    is_default_plugin: true,
  };
}

function renderRefine(skill: SkillSummary) {
  return render(<WorkspaceRefine skill={skill} />);
}

describe("WorkspaceRefine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refineStoreState.selectedSkill = null;
    refineStoreState.conversationId = null;
    refineStoreState.selectedModifiedFile = null;
    refineStoreState.isRunning = false;
    refineStoreState.activeAgentId = null;
    settingsStoreState.modelSettings.model = null;
  });

  it("renders the chat panel by default for the selected skill", async () => {
    const skill = makeSkill("my-skill");
    await act(async () => {
      renderRefine(skill);
    });

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    // PreviewPanel is now rendered at the workspace-shell level, not here.
  });

  it("keeps the chat panel mounted when a modified file is selected", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.selectedModifiedFile = "SKILL.md";

    await act(async () => {
      renderRefine(skill);
    });

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    // PreviewPanel is now rendered at the workspace-shell level, not here.
  });

  it("does not render a SkillPicker", async () => {
    const skill = makeSkill("my-skill");
    await act(async () => {
      renderRefine(skill);
    });

    expect(screen.queryByTestId("skill-picker")).not.toBeInTheDocument();
  });

  it("calls startRefineSession on mount with the skill name", async () => {
    const skill = makeSkill("my-skill");
    await act(async () => {
      renderRefine(skill);
    });

    expect(agentStreamMocks.initAgentStream).toHaveBeenCalled();
    expect(tauriMocks.startRefineSession).toHaveBeenCalledWith(
      "my-skill",
      "/workspace",
      "skills",
    );
  });

  it("hydrates restored messages from the resumed refine session", async () => {
    const skill = makeSkill("my-skill");
    tauriMocks.startRefineSession.mockResolvedValueOnce({
      conversation_id: "conv-1",
      available_agents: ["skill-creator"],
      restored_messages: [
        { role: "user", content: "Tighten the intro" },
        { role: "agent", content: "Updated the intro section." },
      ],
    });

    await act(async () => {
      renderRefine(skill);
    });

    expect(refineStoreState.setMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          userText: "Tighten the intro",
        }),
        expect.objectContaining({
          role: "agent",
          agentText: "Updated the intro section.",
        }),
      ]),
    );
  });

  it("hydrates resumed transcript events into a restored agent turn", async () => {
    const skill = makeSkill("my-skill");
    tauriMocks.startRefineSession.mockResolvedValueOnce({
      conversation_id: "conv-1",
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [
        {
          event_class: "MessageEvent",
          timestamp: 1710000000000,
          event: {
            source: "user",
            message: "Tighten the intro",
          },
        },
        {
          event_class: "ActionEvent",
          timestamp: 1710000001000,
          tool_call_id: "tool-1",
          event: {
            action: {
              tool: "terminal",
              arguments: { command: "npm test" },
              tool_call_id: "tool-1",
            },
            llm_response_id: "resp-1",
          },
        },
        {
          event_class: "ObservationEvent",
          timestamp: 1710000002000,
          tool_call_id: "tool-1",
          event: {
            observation: {
              content: "Tests passed",
              tool_call_id: "tool-1",
            },
          },
        },
        {
          event_class: "MessageEvent",
          timestamp: 1710000003000,
          event: {
            source: "agent",
            message: "Updated the intro and verified it.",
          },
        },
      ],
    });

    await act(async () => {
      renderRefine(skill);
    });

    expect(agentStoreState.registerRun).toHaveBeenCalledWith(
      "restored:conv-1:0",
      "openhands",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:conv-1:restored:0",
    );
    expect(agentStoreState.addConversationEvent).toHaveBeenCalledTimes(4);
    expect(agentStoreState.addConversationEvent).toHaveBeenNthCalledWith(
      1,
      "restored:conv-1:0",
      expect.objectContaining({
        eventClass: "MessageEvent",
        event: expect.objectContaining({
          source: "user",
          message: "Tighten the intro",
        }),
      }),
    );
    expect(agentStoreState.completeRun).toHaveBeenCalledWith(
      "restored:conv-1:0",
      true,
    );
    expect(refineStoreState.setMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        role: "agent",
        agentId: "restored:conv-1:0",
      }),
    ]);
  });

  it("restores setup events before the first user turn", async () => {
    const skill = makeSkill("my-skill");
    tauriMocks.startRefineSession.mockResolvedValueOnce({
      conversation_id: "conv-1",
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [
        {
          event_class: "SystemPromptEvent",
          timestamp: 1710000000000,
          event: {
            system_prompt: { text: "You are the skill creator." },
          },
        },
        {
          event_class: "MessageEvent",
          timestamp: 1710000001000,
          event: {
            source: "user",
            message: "Tighten the intro",
          },
        },
        {
          event_class: "MessageEvent",
          timestamp: 1710000002000,
          event: {
            source: "agent",
            message: "Updated the intro section.",
          },
        },
      ],
    });

    await act(async () => {
      renderRefine(skill);
    });

    expect(agentStoreState.registerRun).toHaveBeenNthCalledWith(
      1,
      "restored:conv-1:0",
      "openhands",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:conv-1:restored:0",
    );
    expect(agentStoreState.registerRun).toHaveBeenNthCalledWith(
      2,
      "restored:conv-1:1",
      "openhands",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:conv-1:restored:1",
    );
    expect(agentStoreState.addConversationEvent).toHaveBeenNthCalledWith(
      2,
      "restored:conv-1:1",
      expect.objectContaining({
        eventClass: "MessageEvent",
        event: expect.objectContaining({
          source: "user",
          message: "Tighten the intro",
        }),
      }),
    );
    expect(refineStoreState.setMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        role: "agent",
        agentId: "restored:conv-1:0",
      }),
      expect.objectContaining({
        role: "agent",
        agentId: "restored:conv-1:1",
      }),
    ]);
  });

  it("restores setup-only transcript events into an initial agent turn", async () => {
    const skill = makeSkill("my-skill");
    tauriMocks.startRefineSession.mockResolvedValueOnce({
      conversation_id: "conv-1",
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [
        {
          event_class: "SystemPromptEvent",
          timestamp: 1710000000000,
          event: {
            system_prompt: { text: "You are the skill creator." },
          },
        },
      ],
    });

    await act(async () => {
      renderRefine(skill);
    });

    expect(agentStoreState.registerRun).toHaveBeenCalledWith(
      "restored:conv-1:0",
      "openhands",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:conv-1:restored:0",
    );
    expect(refineStoreState.setMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        role: "agent",
        agentId: "restored:conv-1:0",
      }),
    ]);
  });

  it("passes restored child subagent events through with parent tool links", async () => {
    const skill = makeSkill("my-skill");
    tauriMocks.startRefineSession.mockResolvedValueOnce({
      conversation_id: "conv-1",
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [
        {
          event_class: "MessageEvent",
          timestamp: 1710000000000,
          event: {
            source: "user",
            message: "Find the MRR rationale",
          },
        },
        {
          event_class: "ActionEvent",
          timestamp: 1710000001000,
          tool_call_id: "parent-task-1",
          event: {
            tool_name: "task",
            action: {
              prompt: "Find the MRR rationale",
            },
          },
        },
        {
          event_class: "ActionEvent",
          timestamp: 1710000002000,
          tool_call_id: "child-tool-1",
          parent_tool_call_id: "parent-task-1",
          event: {
            tool_name: "terminal",
            action: {
              tool_call_id: "child-tool-1",
              command: "rg MRR conversations",
            },
          },
        },
      ],
    });

    await act(async () => {
      renderRefine(skill);
    });

    expect(agentStoreState.addConversationEvent).toHaveBeenCalledWith(
      "restored:conv-1:0",
      expect.objectContaining({
        toolCallId: "child-tool-1",
        parentToolCallId: "parent-task-1",
      }),
    );
  });

  it("calls closeRefineSession and startRefineSession when skill prop changes", async () => {
    const skill1 = makeSkill("skill-a");
    const skill2 = makeSkill("skill-b");

    let rerender: ReturnType<typeof render>["rerender"];
    await act(async () => {
      ({ rerender } = renderRefine(skill1));
    });

    // Simulate an active session for skill-a
    refineStoreState.conversationId = "conv-1";
    refineStoreState.selectedSkill = skill1;

    tauriMocks.closeRefineSession.mockClear();
    tauriMocks.startRefineSession.mockClear();

    await act(async () => {
      rerender!(<WorkspaceRefine skill={skill2} />);
    });

    expect(tauriMocks.closeRefineSession).toHaveBeenCalledWith("skill-a", "skills");
    expect(tauriMocks.startRefineSession).toHaveBeenCalledWith(
      "skill-b",
      "/workspace",
      "skills",
    );
    expect(agentStoreState.clearRunsBySource).toHaveBeenCalledWith("refine");
  });

  it("does not add a duplicate plain user bubble when dispatching a refine turn", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.selectedSkill = skill;

    await act(async () => {
      renderRefine(skill);
    });

    refineStoreState.conversationId = "conv-1";

    await act(async () => {
      screen.getByTestId("chat-panel").click();
    });

    expect(refineStoreState.addUserMessage).not.toHaveBeenCalled();
    expect(agentStoreState.registerRun).toHaveBeenCalledWith(
      "agent-1",
      "openhands",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:conv-1",
    );
    expect(refineStoreState.addAgentTurn).toHaveBeenCalledWith("agent-1");
  });

  it("does not handle Escape locally; layout owns the global pause shortcut", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.conversationId = "conv-esc";
    refineStoreState.selectedSkill = skill;
    refineStoreState.isRunning = true;
    refineStoreState.activeAgentId = "agent-esc";

    await act(async () => {
      renderRefine(skill);
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(tauriMocks.cancelAgentRun).not.toHaveBeenCalled();
  });

  it("calls closeRefineSession on unmount", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.conversationId = "conv-unmount";
    refineStoreState.selectedSkill = skill;

    let unmount: ReturnType<typeof render>["unmount"];
    await act(async () => {
      ({ unmount } = renderRefine(skill));
    });

    tauriMocks.closeRefineSession.mockClear();

    await act(async () => {
      unmount!();
    });

    expect(tauriMocks.closeRefineSession).toHaveBeenCalledWith(
      "my-skill",
      "skills",
    );
    expect(agentStoreState.clearRunsBySource).toHaveBeenCalledWith("refine");
  });

});
