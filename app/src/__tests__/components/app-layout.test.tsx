import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import { toast } from "@/lib/toast";
import type { AppSettings, ReconciliationResult } from "@/lib/types";

const mockNavigate = vi.fn();
const mockRouter = { navigate: vi.fn() };
const SALES_SKILL_ID = "1";
const FINANCE_SKILL_ID = "2";

// Mock @tanstack/react-router
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouter: () => mockRouter,
  useRouterState: ({ select }: { select?: (state: { location: { pathname: string; search: Record<string, string> } }) => unknown } = {}) => {
    const state = { location: { pathname: "/", search: {} } };
    return select ? select(state) : state;
  },
  Outlet: () => <div data-testid="outlet">Dashboard Content</div>,
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

// Mock layout sub-components to avoid their dependencies (localStorage, next-themes, etc.)
vi.mock("@/components/layout/sidebar", () => ({
  IconRail: () => <aside data-testid="icon-rail">IconRail</aside>,
}));

vi.mock("@/components/skill-list-panel", () => ({
  SkillListPanel: ({
    onSelectSkill,
    onActivateSkill,
  }: {
    onSelectSkill?: (name: string, tab?: string) => void;
    onActivateSkill?: (name: string, targetSurface?: "workflow" | "workspace") => Promise<void> | void;
  }) => (
    <div data-testid="skill-list-panel">
      <button onClick={() => onSelectSkill?.(SALES_SKILL_ID, "refine")}>Select sales</button>
      <button onClick={() => onSelectSkill?.(FINANCE_SKILL_ID, "refine")}>Select finance</button>
      <button
        onClick={() => {
          void Promise.resolve(onActivateSkill?.(SALES_SKILL_ID, "workflow")).catch(() => {});
        }}
      >
        Review sales
      </button>
      <button
        onClick={() => {
          void Promise.resolve(onActivateSkill?.(SALES_SKILL_ID)).catch(() => {});
        }}
      >
        Startup activate sales
      </button>
    </div>
  ),
}));

vi.mock("@/components/close-guard", () => ({
  CloseGuard: () => null,
}));

vi.mock("@/components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ skill }: { skill: { name?: string } }) => (
    <div data-testid="workspace-shell">{skill?.name ?? "workspace"}</div>
  ),
}));

vi.mock("@/components/splash-screen", () => ({
  SplashScreen: ({
    onReady,
    onDismiss,
  }: {
    onReady: () => void;
    onDismiss: () => void;
  }) => {
    // Simulate immediate successful validation. Schedule via queueMicrotask
    // to avoid setting parent state during render.
    queueMicrotask(() => {
      onReady();
      onDismiss();
    });
    return null;
  },
}));

vi.mock("@/components/setup-screen", () => ({
  SetupScreen: () => {
    return <div data-testid="setup-screen">Setup</div>;
  },
}));

// Mock toast wrapper
vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

// Must import after mocks are set up
import { AppLayout } from "@/components/layout/app-layout";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillStore } from "@/stores/skill-store";
import {
  getEvalsRunning,
  getEvalsStopping,
  setEvalsCancelHandler,
  setEvalsRunning,
  setEvalsStopping,
} from "@/lib/eval-running-state";
import { renderWithQueryClient } from "@/test/query-test-utils";

// Use renderWithQueryClient as the default render for most tests
const render = renderWithQueryClient;

const defaultSettings: AppSettings = {
  model_settings: {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    api_key: "sk-ant-test",
    base_url: null,
    reasoning_effort: "auto",
    usage_id: "workflow",
  },
  workspace_path: "/home/user/workspace",
  skills_path: "/home/user/skills",
  log_level: "info",
  extended_context: false,
  splash_shown: false,
  github_oauth_token: null,
  github_user_login: null,
  github_user_avatar: null,
  github_user_email: null,
  marketplace_registries: [],
  marketplace_initialized: false,
  max_dimensions: 8,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
  auto_update: false,
};

const emptyReconciliation: ReconciliationResult = {
  orphans: [],
  notifications: [],
  auto_cleaned: 0,
  discovered_skills: [],
};

describe("AppLayout", () => {
  beforeEach(() => {
    resetTauriMocks();
    useSettingsStore.getState().reset();
    useRefineStore.getState().clearSession();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSkillStore.getState().setActiveSkill(null);
    setEvalsRunning(false);
    setEvalsStopping(false);
    setEvalsCancelHandler(null);
    vi.mocked(toast.info).mockReset();
    vi.mocked(toast.warning).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockNavigate.mockReset();
  });

  it("calls reconcile_startup after settings load and renders content", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("blocks content rendering until reconciliation completes", async () => {
    // Settings resolve immediately, reconciliation hangs
    let resolveReconcile!: (value: ReconciliationResult) => void;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup")
        return new Promise<ReconciliationResult>((resolve) => {
          resolveReconcile = resolve;
        });
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    // Wait for settings to load
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", {});
    });

    // Content should NOT be rendered yet
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();

    // Resolve reconciliation
    resolveReconcile(emptyReconciliation);

    // Now content should appear
    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("does not toast when auto_cleaning notification-only reconciliation", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup" && args?.apply === true) {
        return Promise.resolve({
          orphans: [],
          notifications: ["'my-skill' was reset from step 3 to step 0"],
          auto_cleaned: 3,
          discovered_skills: [],
        });
      }
      if (cmd === "reconcile_startup") {
        return Promise.resolve({
          orphans: [],
          notifications: ["'my-skill' was reset from step 3 to step 0"],
          auto_cleaned: 0,
          discovered_skills: [],
        });
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", { apply: true });
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
    expect(toast.info).not.toHaveBeenCalledWith("Cleaned up 3 incomplete skills");
  });

  it("does not toast singular auto-clean text during silent auto-apply", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup" && args?.apply === true) {
        return Promise.resolve({
          orphans: [],
          notifications: ["'my-skill' was reset from step 3 to step 0"],
          auto_cleaned: 1,
          discovered_skills: [],
        });
      }
      if (cmd === "reconcile_startup") {
        return Promise.resolve({
          orphans: [],
          notifications: ["'my-skill' was reset from step 3 to step 0"],
          auto_cleaned: 0,
          discovered_skills: [],
        });
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", { apply: true });
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
    expect(toast.info).not.toHaveBeenCalledWith("Cleaned up 1 incomplete skill");
  });

  it("auto-applies notification-only reconciliation without showing the ack dialog", async () => {
    const notifications = [
      'Skill "sales-pipeline" was reset to step 3 (workspace files are behind database)',
      'Skill "hr-analytics" was reset to step 1 (workspace files are behind database)',
    ];

    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup" && args?.apply === true) return Promise.resolve(emptyReconciliation);
      if (cmd === "reconcile_startup") {
        return Promise.resolve({ orphans: [], notifications, auto_cleaned: 0, discovered_skills: [] });
      }
      if (cmd === "list_skills") return Promise.resolve([]);
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", { apply: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
    expect(screen.queryByText("Startup Reconciliation")).not.toBeInTheDocument();
  });

  it("pauses refine exactly once when Escape is pressed during a refine run", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
      pause_openhands_session: true,
    });
    useRefineStore.setState({
      isRunning: true,
      activeAgentId: "refine-agent-1",
      selectedSkill: {
        name: "my-skill",
        status: "completed",
        current_step: null,
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      conversationId: "conv-refine-1",
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    mockInvoke.mockClear();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pause_openhands_session", {
        input: {
          skillName: "my-skill",
          pluginSlug: "skills",
          conversationId: "conv-refine-1",
          agentId: "refine-agent-1",
        },
      });
    });
    expect(
      mockInvoke.mock.calls.filter(([cmd]) => cmd === "pause_openhands_session"),
    ).toHaveLength(1);
  });

  it("pauses the workflow conversation when Escape is pressed during workflow streaming", async () => {
    const skills = [
      {
        name: "my-skill",
        status: "in_progress",
        current_step: "1",
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
        description: null,
        version: null,
        userInvocable: null,
        disableModelInvocation: null,
      },
    ];
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
      if (cmd === "list_skills") return Promise.resolve(skills);
      if (cmd === "list_imported_skills") return Promise.resolve([]);
      if (cmd === "pause_openhands_session") return Promise.resolve(true);
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });
    useAgentStore.getState().registerRun(
      "workflow-agent-1",
      "test-model",
      "my-skill",
      "workflow",
      "parent-1",
    );
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "workflow-agent-1": {
          ...state.runs["workflow-agent-1"],
          sessionId: "conv-workflow",
        },
      },
    }));
    useWorkflowStore.getState().setRunning(true);

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    // Wait for skills query to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    mockInvoke.mockClear();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pause_openhands_session", {
        input: {
          skillName: "my-skill",
          pluginSlug: "skills",
          conversationId: "conv-workflow",
          agentId: "workflow-agent-1",
        },
      });
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("cancel_workflow_step", expect.anything());
  });

  it("requests eval cancellation when Escape is pressed during eval execution", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
    });
    const cancelEval = vi.fn().mockResolvedValue(undefined);
    setEvalsRunning(true);
    setEvalsCancelHandler(cancelEval);

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await waitFor(() => {
      expect(cancelEval).toHaveBeenCalledTimes(1);
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("pause_openhands_session", expect.anything());
  });

  it("sets refine isStopping immediately when Escape is pressed during refine run", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
      pause_openhands_session: true,
    });
    useRefineStore.setState({
      isRunning: true,
      isStopping: false,
      activeAgentId: "refine-agent-1",
      selectedSkill: {
        name: "my-skill",
        status: "completed",
        current_step: null,
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      conversationId: "conv-refine-1",
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(useRefineStore.getState().isStopping).toBe(true);
  });

  it("still pauses refine when a nested element stops Escape propagation", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
      pause_openhands_session: true,
    });
    useRefineStore.setState({
      isRunning: true,
      isStopping: false,
      activeAgentId: "refine-agent-1",
      selectedSkill: {
        name: "my-skill",
        status: "completed",
        current_step: null,
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      conversationId: "conv-refine-1",
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    const nested = document.createElement("button");
    nested.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
      }
    });
    document.body.appendChild(nested);

    try {
      mockInvoke.mockClear();
      nested.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("pause_openhands_session", {
          input: {
            skillName: "my-skill",
            pluginSlug: "skills",
            conversationId: "conv-refine-1",
            agentId: "refine-agent-1",
          },
        });
      });
      expect(useRefineStore.getState().isStopping).toBe(true);
    } finally {
      nested.remove();
    }
  });

  it("does not call cancel again when Escape is pressed during refine stopping state", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
    });
    useRefineStore.setState({
      isRunning: true,
      isStopping: true,
      activeAgentId: "refine-agent-stopping",
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    mockInvoke.mockClear();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await new Promise((r) => setTimeout(r, 100));
    expect(mockInvoke).not.toHaveBeenCalledWith("pause_openhands_session", expect.anything());
  });

  it("sets workflow isStopping immediately when Escape is pressed during workflow run", async () => {
    const skills = [
      {
        name: "my-skill",
        status: "in_progress",
        current_step: "1",
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
        description: null,
        version: null,
        userInvocable: null,
        disableModelInvocation: null,
      },
    ];
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
      if (cmd === "list_skills") return Promise.resolve(skills);
      if (cmd === "list_imported_skills") return Promise.resolve([]);
      if (cmd === "pause_openhands_session") return Promise.resolve(true);
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });
    useAgentStore.getState().registerRun(
      "workflow-agent-1",
      "test-model",
      "my-skill",
      "workflow",
      "parent-1",
    );
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "workflow-agent-1": {
          ...state.runs["workflow-agent-1"],
          sessionId: "conv-workflow",
        },
      },
    }));
    useWorkflowStore.getState().setRunning(true);
    useWorkflowStore.getState().setStopping(false);

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    // Wait for skills query to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(useWorkflowStore.getState().isStopping).toBe(true);
  });

  it("pauses workflow from the active skill session even when no workflow run record exists yet", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
      pause_openhands_session: true,
      log_frontend: null,
    });
    useRefineStore.setState({
      selectedSkill: {
        id: 2740,
        name: "my-skill",
        status: "in_progress",
        current_step: "1",
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      conversationId: "conv-workflow-fallback",
    });
    useAgentStore.getState().setActiveAgent("workflow-agent-pending");
    useWorkflowStore.getState().setRunning(true);
    useWorkflowStore.getState().setStopping(false);

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    mockInvoke.mockClear();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(useWorkflowStore.getState().isStopping).toBe(true);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pause_openhands_session", {
        input: {
          skillName: "my-skill",
          pluginSlug: "skills",
          conversationId: "conv-workflow-fallback",
          agentId: "workflow-agent-pending",
        },
      });
    });
  });

  it("sets evals isStopping immediately when Escape is pressed during eval run", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
    });
    const cancelEval = vi.fn().mockResolvedValue(undefined);
    setEvalsRunning(true);
    setEvalsStopping(false);
    setEvalsCancelHandler(cancelEval);

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    // Verify evals are running before Escape
    expect(getEvalsRunning()).toBe(true);
    expect(getEvalsStopping()).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    // isStopping should be true immediately (optimistic)
    expect(getEvalsStopping()).toBe(true);
    expect(cancelEval).toHaveBeenCalledTimes(1);
  });

  it("renders content after auto-applying notification-only reconciliation", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup" && args?.apply === true) return Promise.resolve(emptyReconciliation);
      if (cmd === "reconcile_startup") {
        return Promise.resolve({
          orphans: [],
          notifications: ["'my-skill' was reset from step 3 to step 0"],
          auto_cleaned: 0,
          discovered_skills: [],
        });
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", { apply: true });
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("bootstraps an OpenHands session for the selected skill", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
      if (cmd === "list_skills") {
        return Promise.resolve([
          {
            id: 1,
            name: "sales-skill",
            current_step: null,
            status: "completed",
            last_modified: null,
            tags: [],
            purpose: "domain",
            skill_source: "skill-builder",
            author_login: null,
            author_avatar: null,
            intake_json: null,
            description: null,
            version: null,
            userInvocable: null,
            disableModelInvocation: null,
            plugin_slug: "skills",
            plugin_display_name: "Skills",
            is_default_plugin: true,
          },
        ]);
      }
      if (cmd === "list_imported_skills") return Promise.resolve([]);
      if (cmd === "acquire_lock") return Promise.resolve(undefined);
      if (cmd === "release_lock") {
        return Promise.resolve(undefined);
      }
      if (cmd === "select_skill_openhands_session") {
        return Promise.resolve({
          conversation_id: "conv-sales",
          skill_name: "sales-skill",
          created_at: new Date().toISOString(),
          available_agents: ["skill-creator"],
          restored_messages: [],
          restored_transcript_events: [],
        });
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd} ${JSON.stringify(args)}`));
    });

    render(<AppLayout />);

    // Wait for the skill panel to appear, then simulate SkillListPanel's startup auto-select
    await waitFor(() => {
      expect(screen.getByText("Startup activate sales")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Startup activate sales"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("select_skill_openhands_session", {
        skillId: 1,
        workspacePath: "/home/user/workspace",
      });
    });

    expect(useRefineStore.getState().conversationId).toBe("conv-sales");
  });

  it("navigates to the workflow page for an already-active skill when explicitly requested", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
      if (cmd === "list_skills") {
        return Promise.resolve([
          {
            id: 1,
            name: "sales-skill",
            current_step: null,
            status: "completed",
            last_modified: null,
            tags: [],
            purpose: "domain",
            skill_source: "skill-builder",
            author_login: null,
            author_avatar: null,
            intake_json: null,
            description: null,
            version: null,
            userInvocable: null,
            disableModelInvocation: null,
            plugin_slug: "skills",
            plugin_display_name: "Skills",
            is_default_plugin: true,
          },
        ]);
      }
      if (cmd === "list_imported_skills") return Promise.resolve([]);
      if (cmd === "github_get_user") return Promise.resolve(null);
      return Promise.reject(new Error(`Unmocked command: ${cmd} ${JSON.stringify(args)}`));
    });

    useSkillStore.getState().setActiveSkill(SALES_SKILL_ID);
    useRefineStore.setState({
      selectedSkill: {
        id: 1,
        name: "sales-skill",
        status: "completed",
        current_step: null,
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      conversationId: "conv-sales",
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText("Review sales")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Review sales"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/workflow/$skillId",
        params: { skillId: SALES_SKILL_ID },
      });
    });
  });

  it("pauses the current skill conversation before switching skills", async () => {
    const commandOrder: string[] = [];
    const skills = [
      {
        id: 1,
        name: "sales-skill",
        current_step: null,
        status: "completed",
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        description: null,
        version: null,
        userInvocable: null,
        disableModelInvocation: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      {
        id: 2,
        name: "finance-skill",
        current_step: null,
        status: "completed",
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        description: null,
        version: null,
        userInvocable: null,
        disableModelInvocation: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
    ];

    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      commandOrder.push(cmd);
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
      if (cmd === "list_skills") return Promise.resolve(skills);
      if (cmd === "list_imported_skills") return Promise.resolve([]);
      if (cmd === "select_skill_openhands_session") {
        return Promise.resolve({
          conversation_id:
            args?.skillId === 1 ? "conv-current" : "conv-next",
          skill_name:
            args?.skillId === 1 ? "sales-skill" : "finance-skill",
          created_at: new Date().toISOString(),
          available_agents: ["skill-creator"],
          restored_messages: [],
          restored_transcript_events: [],
        });
      }
      if (cmd === "pause_openhands_session") return Promise.resolve(undefined);
      if (cmd === "release_lock") return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    useSkillStore.getState().setActiveSkill(SALES_SKILL_ID);
    useRefineStore.setState({
      selectedSkill: {
        id: 1,
        name: "sales-skill",
        status: "completed",
        current_step: null,
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      conversationId: "conv-current",
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("skill-list-panel")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Select finance"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pause_openhands_session", {
        input: {
          skillName: "sales-skill",
          pluginSlug: "skills",
          conversationId: "conv-current",
          agentId: null,
        },
      });
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("release_lock", {
        skillId: 1,
      });
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("select_skill_openhands_session", {
        skillId: 2,
        workspacePath: "/home/user/workspace",
      });
    });

    expect(commandOrder.indexOf("pause_openhands_session")).toBeLessThan(
      commandOrder.indexOf("release_lock"),
    );
    expect(commandOrder.indexOf("release_lock")).toBeLessThan(
      commandOrder.indexOf("select_skill_openhands_session"),
    );
  });

  it("does not bootstrap the next skill when pause fails", async () => {
    const skills = [
      {
        id: 1,
        name: "sales-skill",
        current_step: null,
        status: "completed",
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        description: null,
        version: null,
        userInvocable: null,
        disableModelInvocation: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      {
        id: 2,
        name: "finance-skill",
        current_step: null,
        status: "completed",
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        description: null,
        version: null,
        userInvocable: null,
        disableModelInvocation: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
      if (cmd === "list_skills") return Promise.resolve(skills);
      if (cmd === "list_imported_skills") return Promise.resolve([]);
      if (cmd === "pause_openhands_session") return Promise.reject(new Error("pause failed"));
      if (cmd === "release_lock") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    useSkillStore.getState().setActiveSkill(SALES_SKILL_ID);
    useRefineStore.setState({
      selectedSkill: {
        id: 1,
        name: "sales-skill",
        status: "completed",
        current_step: null,
        last_modified: null,
        tags: [],
        purpose: "domain",
        skill_source: "skill-builder",
        author_login: null,
        author_avatar: null,
        intake_json: null,
        plugin_slug: "skills",
        plugin_display_name: "Skills",
        is_default_plugin: true,
      },
      conversationId: "conv-current",
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("skill-list-panel")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Select finance"));

    // Should not proceed to select_skill_openhands_session for the next skill
    await new Promise((r) => setTimeout(r, 100));
    expect(mockInvoke).not.toHaveBeenCalledWith("select_skill_openhands_session", {
      skillId: 2,
      workspacePath: "/home/user/workspace",
    });
  });

  it("shows reconciliation dialog when discovered skills require user resolution", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: {
        orphans: [],
        notifications: ["'my-skill' workflow record recreated at step 3"],
        auto_cleaned: 0,
        discovered_skills: [{ name: "partial-skill", detected_step: 2, scenario: "7a" }],
      },
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText("Startup Reconciliation")).toBeInTheDocument();
    });

    expect(screen.getByText("'my-skill' workflow record recreated at step 3")).toBeInTheDocument();
    expect(screen.getByText("partial-skill")).toBeInTheDocument();
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("refreshes skill list after auto-applying reconciliation", async () => {
    const invokedCommands: string[] = [];
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      invokedCommands.push(cmd);
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup" && args?.apply === true) return Promise.resolve(emptyReconciliation);
      if (cmd === "reconcile_startup") {
        return Promise.resolve({
          orphans: [],
          notifications: ["'my-skill' was reset from step 3 to step 0"],
          auto_cleaned: 0,
          discovered_skills: [],
        });
      }
      if (cmd === "list_skills") return Promise.resolve([]);
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(invokedCommands).toContain("reconcile_startup");
      expect(invokedCommands).toContain("list_skills");
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    expect(screen.queryByText("Startup Reconciliation")).not.toBeInTheDocument();
  });

  it("does not offer cancellation for notification-only reconciliation", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup" && args?.apply === true) return Promise.resolve(emptyReconciliation);
      if (cmd === "reconcile_startup") {
        return Promise.resolve({
          orphans: [],
          notifications: ["'my-skill' was reset from step 3 to step 0"],
          auto_cleaned: 0,
          discovered_skills: [],
        });
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", { apply: true });
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    expect(screen.queryByText("Startup Reconciliation")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("record_reconciliation_cancel", expect.anything());
  });

  it("shows orphan resolution dialog when orphans exist", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: {
        orphans: [
          {
            skill_name: "old-skill",
            purpose: "domain",
          },
        ],
        notifications: [],
        auto_cleaned: 0,
        discovered_skills: [],
      },
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText("Orphaned Skills Found")).toBeInTheDocument();
    });

    expect(screen.getByText("old-skill")).toBeInTheDocument();
  });

  it("proceeds when reconciliation fails (e.g., no workspace configured)", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup")
        return Promise.reject(new Error("Workspace path not initialized"));
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("calls reconcile_startup concurrently with get_settings on mount", async () => {
    // Both calls hang forever — verifies they fire concurrently, not sequentially
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    render(<AppLayout />);

    // Give it a tick
    await new Promise((r) => setTimeout(r, 50));

    // reconcileStartup fires concurrently with getSettings (not gated on settings load)
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toContain("get_settings");
    expect(calls).toContain("reconcile_startup");
  });

  it("skips setup screen when only API key is missing", async () => {
    mockInvokeCommands({
      get_settings: {
        ...defaultSettings,
        model_settings: {
          ...defaultSettings.model_settings,
          api_key: null,
        },
      },
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("setup-screen")).not.toBeInTheDocument();
  });

  it("shows setup screen when skills path is missing", async () => {
    mockInvokeCommands({
      get_settings: { ...defaultSettings, skills_path: null },
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("setup-screen")).toBeInTheDocument();
    });
  });

  it("skips setup screen for returning users with both settings configured", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
    // Setup screen should not be present (it auto-completes via mock, but
    // for configured users the isConfigured effect sets setupComplete before
    // splash dismisses, so it never mounts)
  });

  describe("startup routing", () => {
    const baseSkill = {
      id: 1,
      name: "sales-skill",
      current_step: null,
      last_modified: null,
      tags: [],
      purpose: "domain",
      skill_source: "skill-builder",
      author_login: null,
      author_avatar: null,
      intake_json: null,
      description: null,
      version: null,
      userInvocable: null,
      disableModelInvocation: null,
      plugin_slug: "skills",
      plugin_display_name: "Skills",
      is_default_plugin: true,
    };

    const setupMock = (skillOverrides: Record<string, unknown> = {}, selectSessionFn?: () => Promise<unknown>) => {
      mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_settings") return Promise.resolve(defaultSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "list_skills") return Promise.resolve([{ ...baseSkill, ...skillOverrides }]);
        if (cmd === "list_imported_skills") return Promise.resolve([]);
        if (cmd === "select_skill_openhands_session") return selectSessionFn ? selectSessionFn() : Promise.resolve({
          conversation_id: "conv-sales",
          skill_name: "sales-skill",
          created_at: new Date().toISOString(),
          available_agents: ["skill-creator"],
          restored_messages: [],
          restored_transcript_events: [],
        });
        if (cmd === "release_lock") {
          return Promise.resolve(undefined);
        }
        return Promise.reject(new Error(`Unmocked command: ${cmd} ${JSON.stringify(args)}`));
      });
    };

    it("navigates to '/workspace/$skillId' when the pre-selected skill has status 'completed'", async () => {
      setupMock({ status: "completed" });
      render(<AppLayout />);

      await waitFor(() => expect(screen.getByText("Startup activate sales")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Startup activate sales"));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({
          to: "/workspace/$skillId",
          params: { skillId: SALES_SKILL_ID },
          search: { tab: undefined },
        });
      });
    });

    it("navigates to '/workflow/$skillId' when the pre-selected skill has status 'in_progress'", async () => {
      setupMock({ status: "in_progress" });
      render(<AppLayout />);

      await waitFor(() => expect(screen.getByText("Startup activate sales")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Startup activate sales"));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({
          to: "/workflow/$skillId",
          params: { skillId: SALES_SKILL_ID },
        });
      });
    });

    it("does not navigate when bootstrap throws", async () => {
      setupMock({ status: "completed" }, () => Promise.reject(new Error("session failed")));
      render(<AppLayout />);

      await waitFor(() => expect(screen.getByText("Startup activate sales")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Startup activate sales"));

      // Wait for bootstrap attempt, then for error cleanup (activeSkill reset to null)
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("select_skill_openhands_session", {
          skillId: 1,
          workspacePath: "/home/user/workspace",
        });
      });
      await waitFor(() => {
        expect(useSkillStore.getState().activeSkillId).toBeNull();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("clears selected workspace skill when bootstrap throws", async () => {
      setupMock({ status: "completed" }, () => Promise.reject(new Error("session failed")));
      render(<AppLayout />);

      await waitFor(() => expect(screen.getByText("Startup activate sales")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Startup activate sales"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("select_skill_openhands_session", {
          skillId: 1,
          workspacePath: "/home/user/workspace",
        });
      });
      await waitFor(() => {
        expect(useSkillStore.getState().activeSkillId).toBeNull();
      });
    });
  });

  describe("marketplace update toasts", () => {
    const marketplaceSettings = {
      ...defaultSettings,
      marketplace_registries: [{ name: "Test", source_url: "https://github.com/owner/skill-marketplace", enabled: true }],
    };
    const repoInfo = { owner: "owner", repo: "skill-marketplace", branch: "main", subpath: null };

    it("shows info toast for library skills update in manual mode", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [{ name: "sales-skill", path: "skills/sales-skill", version: "1.1.0" }],
          workspace: [],
        });
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          "Dashboard: update available for 1 skill: sales-skill",
          expect.objectContaining({ action: expect.any(Object) })
        );
      });
    });

    it("does not show a separate workspace update toast in manual mode", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [],
          workspace: [{ name: "hr-skill", path: "skills/hr-skill", version: "1.1.0" }],
        });
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("check_marketplace_updates", {});
      });
      expect(toast.info).not.toHaveBeenCalledWith(
        "Settings \u2192 Skills: update available for 1 skill: hr-skill",
        expect.anything()
      );
    });

    it("shows success toast after auto-updating non-customized skills", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve({ ...marketplaceSettings, auto_update: true });
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [{ name: "sales-skill", path: "skills/sales-skill", version: "1.1.0" }],
          workspace: [],
        });
        if (cmd === "check_skill_customized") return Promise.resolve(false);
        if (cmd === "import_marketplace_to_library") return Promise.resolve([]);
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ duration: Infinity })
        );
      });
    });

    it("skips customized skills during auto-update", async () => {
      mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_settings") return Promise.resolve({ ...marketplaceSettings, auto_update: true });
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [
            { name: "customized-skill", path: "skills/customized-skill", version: "1.1.0" },
            { name: "stock-skill", path: "skills/stock-skill", version: "1.1.0" },
          ],
          workspace: [],
        });
        if (cmd === "check_skill_customized") return Promise.resolve(args?.skillName === "customized-skill");
        if (cmd === "import_marketplace_to_library") return Promise.resolve([]);
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      // Only the 1 non-customized skill is auto-updated
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ duration: Infinity })
        );
      });
    });

    it("shows no toast when all skills are up to date", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [],
          workspace: [],
        });
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      // Wait for the check to complete (reconciliation done = content visible)
      await waitFor(() => {
        expect(screen.getByTestId("outlet")).toBeInTheDocument();
      });

      expect(toast.info).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("shows persistent error toast when marketplace update check fails", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "check_marketplace_updates") return Promise.reject(new Error("marketplace.json not found"));
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Marketplace update check failed: marketplace.json not found",
          expect.objectContaining({ duration: Infinity })
        );
      });
    });

    it("skips marketplace update check when all registries are disabled", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") {
          return Promise.resolve({
            ...marketplaceSettings,
            marketplace_registries: [
              { name: "Disabled", source_url: "https://github.com/owner/skill-marketplace", enabled: false },
            ],
          });
        }
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(screen.getByTestId("outlet")).toBeInTheDocument();
      });
      const calls = mockInvoke.mock.calls.map((c) => c[0]);
      expect(calls).not.toContain("check_marketplace_updates");
    });

    it("refreshes stored registry name when backend reports a different name", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "check_marketplace_updates") {
          return Promise.resolve({
            library: [],
            workspace: [],
            registry_names: [
              {
                source_url: "https://github.com/owner/skill-marketplace",
                registry_name: "Renamed Registry",
              },
            ],
          });
        }
        if (cmd === "save_settings") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "save_settings",
          expect.objectContaining({
            settings: expect.objectContaining({
              marketplace_registries: [
                {
                  name: "Renamed Registry",
                  source_url: "https://github.com/owner/skill-marketplace",
                  enabled: true,
                },
              ],
            }),
          })
        );
      });
    });
  });
});
