import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WorkspaceRefine } from "@/components/workspace/workspace-refine";
import type { SkillSummary } from "@/lib/types";
import { toast } from "@/lib/toast";

const mockLeaveCurrentSkill = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/active-skill-transition", () => ({
  leaveCurrentSkill: () => mockLeaveCurrentSkill(),
}));

// --- Tauri mock ---
const tauriMocks = vi.hoisted(() => ({
  acquireLock: vi.fn().mockResolvedValue(undefined),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  getSkillContentForRefine: vi.fn().mockResolvedValue([]),
  sendRefineMessage: vi.fn().mockResolvedValue({
    agent_id: "agent-1",
    conversation_id: "conv-1",
  }),
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
  setSelectedSkill: vi.fn(),
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
const leaveGuardCapture = vi.hoisted(() => ({
  onLeave: undefined as ((proceed: () => void) => void) | undefined,
}));

vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: vi.fn().mockImplementation(({ onLeave }: { onLeave: (proceed: () => void) => void }) => {
    leaveGuardCapture.onLeave = onLeave;
    return {
      blockerStatus: "idle",
      handleNavStay: vi.fn(),
      handleNavLeave: vi.fn(),
    };
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
    leaveGuardCapture.onLeave = undefined;
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

  it("does not bootstrap an OpenHands session on mount", async () => {
    const skill = makeSkill("my-skill");
    await act(async () => {
      renderRefine(skill);
    });

    expect(agentStreamMocks.initAgentStream).toHaveBeenCalled();
    expect(tauriMocks.sendRefineMessage).not.toHaveBeenCalled();
  });

  it("loads skill files when the skill prop changes", async () => {
    const skill1 = makeSkill("skill-a");
    const skill2 = makeSkill("skill-b");

    let rerender: ReturnType<typeof render>["rerender"];
    await act(async () => {
      ({ rerender } = renderRefine(skill1));
    });

    tauriMocks.getSkillContentForRefine.mockClear();

    await act(async () => {
      rerender!(<WorkspaceRefine skill={skill2} />);
    });

    expect(tauriMocks.getSkillContentForRefine).toHaveBeenCalledWith(
      "skill-b",
      "/workspace",
      "skills",
    );
    expect(refineStoreState.setSkillFiles).toHaveBeenCalled();
  });

  it("adds a plain user bubble when dispatching a refine turn", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.selectedSkill = skill;

    await act(async () => {
      renderRefine(skill);
    });

    refineStoreState.conversationId = "conv-1";

    await act(async () => {
      screen.getByTestId("chat-panel").click();
    });

    expect(refineStoreState.addUserMessage).toHaveBeenCalledWith(
      "Refine this",
      undefined,
    );
    expect(agentStoreState.registerRun).toHaveBeenCalledWith(
      "agent-1",
      "openhands",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:conv-1",
    );
    expect(refineStoreState.addAgentTurn).toHaveBeenCalledWith("agent-1");
  });

  it("fails loudly when the selected skill has no conversation id", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.selectedSkill = skill;
    refineStoreState.conversationId = null;

    await act(async () => {
      renderRefine(skill);
    });

    await act(async () => {
      screen.getByTestId("chat-panel").click();
    });

    expect(tauriMocks.sendRefineMessage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Refine session for 'my-skill' has no active conversation",
      { duration: Infinity },
    );
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

  it("does not pause or close OpenHands on unmount", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.conversationId = "conv-unmount";
    refineStoreState.selectedSkill = skill;

    let unmount: ReturnType<typeof render>["unmount"];
    await act(async () => {
      ({ unmount } = renderRefine(skill));
    });

    await act(async () => {
      unmount!();
    });

    expect(tauriMocks.sendRefineMessage).not.toHaveBeenCalled();
  });

  it("delegates leave confirmation cleanup to leaveCurrentSkill", async () => {
    const skill = makeSkill("my-skill");

    await act(async () => {
      renderRefine(skill);
    });

    const proceed = vi.fn();
    await act(async () => {
      leaveGuardCapture.onLeave?.(proceed);
    });

    expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

});
