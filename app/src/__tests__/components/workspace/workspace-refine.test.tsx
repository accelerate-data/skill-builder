import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WorkspaceRefine } from "@/components/workspace/workspace-refine";
import type { SkillSummary } from "@/lib/types";

// --- Tauri mock ---
const tauriMocks = vi.hoisted(() => ({
  acquireLock: vi.fn().mockResolvedValue(undefined),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  startRefineSession: vi.fn().mockResolvedValue({
    session_id: "session-1",
    available_agents: [],
    restored_messages: [],
  }),
  closeRefineSession: vi.fn().mockResolvedValue(undefined),
  getSkillContentForRefine: vi.fn().mockResolvedValue([]),
  sendRefineMessage: vi.fn().mockResolvedValue("agent-1"),
  pauseRefineSession: vi.fn().mockResolvedValue(undefined),
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
  sessionId: null as string | null,
  sessionExhausted: false,
  selectSkill: vi.fn(),
  setLoadingFiles: vi.fn(),
  setSkillFiles: vi.fn(),
  setGitDiff: vi.fn(),
  setActiveFileTab: vi.fn(),
  setSelectedModifiedFile: vi.fn(),
  setSessionId: vi.fn(),
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
  registerRun: vi.fn(),
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
    refineStoreState.sessionId = null;
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
      session_id: "session-1",
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

  it("calls closeRefineSession and startRefineSession when skill prop changes", async () => {
    const skill1 = makeSkill("skill-a");
    const skill2 = makeSkill("skill-b");

    let rerender: ReturnType<typeof render>["rerender"];
    await act(async () => {
      ({ rerender } = renderRefine(skill1));
    });

    // Simulate an active session for skill-a
    refineStoreState.sessionId = "session-1";
    refineStoreState.selectedSkill = skill1;

    tauriMocks.closeRefineSession.mockClear();
    tauriMocks.startRefineSession.mockClear();

    await act(async () => {
      rerender!(<WorkspaceRefine skill={skill2} />);
    });

    expect(tauriMocks.closeRefineSession).toHaveBeenCalledWith("session-1");
    expect(tauriMocks.startRefineSession).toHaveBeenCalledWith(
      "skill-b",
      "/workspace",
      "skills",
    );
  });

  it("calls pauseRefineSession when Escape is pressed during a running session", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.sessionId = "session-esc";
    refineStoreState.selectedSkill = skill;
    refineStoreState.isRunning = true;

    await act(async () => {
      renderRefine(skill);
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(tauriMocks.pauseRefineSession).toHaveBeenCalledWith("session-esc");
  });

  it("does not call pauseRefineSession when Escape is pressed while idle", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.sessionId = "session-idle";
    refineStoreState.selectedSkill = skill;
    refineStoreState.isRunning = false;

    await act(async () => {
      renderRefine(skill);
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(tauriMocks.pauseRefineSession).not.toHaveBeenCalled();
  });

  it("calls closeRefineSession on unmount", async () => {
    const skill = makeSkill("my-skill");
    refineStoreState.sessionId = "session-unmount";
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
      "session-unmount",
    );
  });

});
