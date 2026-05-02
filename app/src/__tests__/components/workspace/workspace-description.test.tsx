import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/test/mocks/tauri";
import { mockListen, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import type { SkillSummary } from "@/lib/tauri";

// ─── Store mocks ─────────────────────────────────────────────────────────────

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({
      workspacePath: "/workspace",
      modelSettings: { model: "claude-sonnet-4-6" },
    }),
  ),
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: vi.fn((selector) =>
    selector({ runs: {} }),
  ),
  default: { getState: () => ({ registerRun: vi.fn() }) },
}));

vi.mock("@/hooks/use-agent-stream", () => ({}));

vi.mock("@/lib/description-opt-running-state", () => ({
  setDescriptionOptRunning: vi.fn(),
}));

vi.mock("@/components/agent-output-panel", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));

// ─── Tauri command mocks ──────────────────────────────────────────────────────

const mockRunOptimizationLoop = vi.fn();
const mockApplyDescription = vi.fn();
const mockCancelDescriptionOptimization = vi.fn();
const mockLoadEvalQueries = vi.fn();
const mockSaveEvalQueries = vi.fn();
const mockWriteDescOptLog = vi.fn();
const mockStartGenerateDescEvalQueries = vi.fn();
const mockCancelAgentRun = vi.fn();

vi.mock("@/lib/tauri", () => ({
  runOptimizationLoop: (...args: unknown[]) => mockRunOptimizationLoop(...args),
  applyDescription: (...args: unknown[]) => mockApplyDescription(...args),
  cancelDescriptionOptimization: (...args: unknown[]) => mockCancelDescriptionOptimization(...args),
  loadEvalQueries: (...args: unknown[]) => mockLoadEvalQueries(...args),
  saveEvalQueries: (...args: unknown[]) => mockSaveEvalQueries(...args),
  writeDescOptLog: (...args: unknown[]) => mockWriteDescOptLog(...args),
  startGenerateDescEvalQueries: (...args: unknown[]) => mockStartGenerateDescEvalQueries(...args),
  cancelAgentRun: (...args: unknown[]) => mockCancelAgentRun(...args),
}));

// useLeaveGuard: expose blockerStatus control
const blockerControl = vi.hoisted(() => ({ status: "idle" as string }));
vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: ({ onLeave }: { shouldBlock: () => boolean; onLeave: (proceed: () => void) => void }) => ({
    blockerStatus: blockerControl.status,
    handleNavStay: vi.fn(),
    handleNavLeave: () => onLeave(() => {}),
  }),
}));

// ─── Import component after mocks ─────────────────────────────────────────────
import { WorkspaceDescription } from "@/components/workspace/workspace-description";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const skill: SkillSummary = {
  name: "dbt-analytics",
  plugin_slug: "skills",
  description: "Use when doing dbt work",
  current_step: null, status: "completed", last_modified: "2026-01-01T00:00:00Z",
  tags: [], purpose: "domain", skill_source: "skill-builder",
  author_login: null, author_avatar: null, intake_json: null, source: null,
  version: "1.0.0", model: null, argumentHint: null, userInvocable: null,
  disableModelInvocation: null, plugin_display_name: "Skills", is_default_plugin: true,
};

const stubQueries = [
  { id: "q1", query: "how do I run dbt tests?", should_trigger: true },
  { id: "q2", query: "what is the weather today?", should_trigger: false },
];

const stubResult = {
  ok: true,
  best_description: "Use when the user is doing dbt work",
  original_description: "Use when doing dbt work",
  best_score: "0.86",
  best_train_score: "0.85",
  best_test_score: "0.86",
  iterations_run: 2,
  history: [
    { iteration: 0, description: "Use when doing dbt work", train_passed: null, train_total: null, test_passed: 6, test_total: 7 },
    { iteration: 1, description: "Use when the user is doing dbt work", train_passed: 10, train_total: 13, test_passed: 6, test_total: 7 },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ProgressCallback = (event: { payload: unknown }) => void;

/**
 * After clicking Optimize, extract the description:progress callback that the
 * component registered via listen(). Must be called after waitFor confirms listen was called.
 */
function getProgressCallback(): ProgressCallback {
  const call = mockListen.mock.calls.find((c) => c[0] === "description:progress");
  if (!call) throw new Error("description:progress listener not registered");
  return call[1] as ProgressCallback;
}

/** Render with pre-loaded queries so the Optimize button is enabled */
async function renderWithQueries(onApply?: (desc: string) => void) {
  mockLoadEvalQueries.mockResolvedValue(stubQueries);
  const utils = render(
    <WorkspaceDescription skill={skill} workspacePath="/workspace" onApply={onApply} />,
  );
  // Wait for loadEvalQueries to populate state
  await waitFor(() => expect(mockLoadEvalQueries).toHaveBeenCalled());
  return utils;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetTauriMocks();
  mockRunOptimizationLoop.mockReset();
  mockApplyDescription.mockReset().mockResolvedValue("1.0.1");
  mockCancelDescriptionOptimization.mockReset().mockResolvedValue(undefined);
  mockLoadEvalQueries.mockReset().mockResolvedValue([]);
  mockSaveEvalQueries.mockReset().mockResolvedValue(undefined);
  mockWriteDescOptLog.mockReset().mockResolvedValue(undefined);
  mockListen.mockReturnValue(Promise.resolve(vi.fn()));
  blockerControl.status = "idle";
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WorkspaceDescription — optimization lifecycle", () => {
  it("Optimize button disabled when no queries loaded", async () => {
    mockLoadEvalQueries.mockResolvedValue([]);
    render(<WorkspaceDescription skill={skill} workspacePath="/workspace" />);
    await waitFor(() => expect(mockLoadEvalQueries).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Optimize" })).toBeDisabled();
  });

  it("Optimize button enabled when queries with should_trigger=true exist", async () => {
    await renderWithQueries();
    expect(screen.getByRole("button", { name: "Optimize" })).toBeEnabled();
  });

  it("clicking Optimize registers description:progress listener and calls runOptimizationLoop", async () => {
    const user = userEvent.setup();
    mockRunOptimizationLoop.mockReturnValue(new Promise(() => {})); // never resolves

    await renderWithQueries();
    await user.click(screen.getByRole("button", { name: "Optimize" }));

    await waitFor(() => expect(mockRunOptimizationLoop).toHaveBeenCalled());
    // Check skill name, plugin, workspace path are correct
    const [calledSkill, calledPlugin, calledWorkspace] = mockRunOptimizationLoop.mock.calls[0];
    expect(calledSkill).toBe(skill.name);
    expect(calledPlugin).toBe(skill.plugin_slug);
    expect(calledWorkspace).toBe("/workspace");
    // Queries contain the loaded content (id may be regenerated, check query text)
    const calledQueries = mockRunOptimizationLoop.mock.calls[0][4] as Array<{query: string}>;
    expect(calledQueries.map((q) => q.query)).toContain("how do I run dbt tests?");
    expect(mockListen).toHaveBeenCalledWith("description:progress", expect.any(Function));
  });

  it("progress events update the completed iterations table", async () => {
    const user = userEvent.setup();
    mockRunOptimizationLoop.mockReturnValue(new Promise(() => {}));

    await renderWithQueries();
    await user.click(screen.getByRole("button", { name: "Optimize" }));
    await waitFor(() => expect(mockListen).toHaveBeenCalledWith("description:progress", expect.any(Function)));

    const fire = getProgressCallback();
    act(() => fire({ payload: { type: "progress", iteration: 0, description: "desc", train_passed: null, train_total: null, test_passed: 5, test_total: 7 } }));

    await waitFor(() => expect(screen.getAllByText("N/A").length).toBeGreaterThan(0));
  });

  it("iteration 0 shows N/A for train and numeric test score", async () => {
    const user = userEvent.setup();
    mockRunOptimizationLoop.mockReturnValue(new Promise(() => {}));

    await renderWithQueries();
    await user.click(screen.getByRole("button", { name: "Optimize" }));
    await waitFor(() => expect(mockListen).toHaveBeenCalledWith("description:progress", expect.any(Function)));

    const fire = getProgressCallback();
    act(() => fire({ payload: { type: "progress", iteration: 0, description: "d", train_passed: null, train_total: null, test_passed: 5, test_total: 7 } }));

    await waitFor(() => expect(screen.getAllByText("N/A").length).toBeGreaterThan(0));
    // Test score 5/7 ≈ 0.71 (appears in score card and table)
    await waitFor(() => expect(screen.getAllByText(/0\.71/).length).toBeGreaterThan(0));
  });

  it("running iteration counter skips iteration 0 (shows 1 not 2 when baseline done)", async () => {
    const user = userEvent.setup();
    mockRunOptimizationLoop.mockReturnValue(new Promise(() => {}));

    await renderWithQueries();
    await user.click(screen.getByRole("button", { name: "Optimize" }));
    await waitFor(() => expect(mockListen).toHaveBeenCalledWith("description:progress", expect.any(Function)));

    // Fire baseline (iteration 0)
    const fire = getProgressCallback();
    act(() => fire({ payload: { type: "progress", iteration: 0, description: "d", train_passed: null, train_total: null, test_passed: 5, test_total: 7 } }));

    // After iter 0: completedOptIters = progress.filter(p => p.iteration > 0).length = 0
    // currentIter = 0 + 1 = 1  (not 2)
    // Running row text: "1 (running)" in same cell
    await waitFor(() => {
      const cells = screen.getAllByRole("cell");
      const runningCell = cells.find((c) => c.textContent?.includes("(running)"));
      expect(runningCell?.textContent).toMatch(/^1/);
    });
  });

  it("Cancel button calls cancelDescriptionOptimization", async () => {
    const user = userEvent.setup();
    mockRunOptimizationLoop.mockReturnValue(new Promise(() => {}));
    mockListen.mockReturnValue(Promise.resolve(vi.fn()));

    await renderWithQueries();
    await user.click(screen.getByRole("button", { name: "Optimize" }));
    await waitFor(() => screen.getByRole("button", { name: /cancel/i }));

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockCancelDescriptionOptimization).toHaveBeenCalled();
  });

  it("shows result section after runOptimizationLoop resolves", async () => {
    const user = userEvent.setup();
    mockListen.mockReturnValue(Promise.resolve(vi.fn()));
    mockRunOptimizationLoop.mockResolvedValue(stubResult);

    await renderWithQueries();
    await user.click(screen.getByRole("button", { name: "Optimize" }));

    await waitFor(() => expect(screen.getByText("Results")).toBeInTheDocument());
    expect(screen.getByText(/2 iterations complete/i)).toBeInTheDocument();
  });

  it("Apply button calls applyDescription then onApply with best description", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    mockListen.mockReturnValue(Promise.resolve(vi.fn()));
    mockRunOptimizationLoop.mockResolvedValue(stubResult);

    await renderWithQueries(onApply);
    await user.click(screen.getByRole("button", { name: "Optimize" }));
    await waitFor(() => screen.getByRole("button", { name: /apply best description/i }));

    await user.click(screen.getByRole("button", { name: /apply best description/i }));

    await waitFor(() => {
      expect(mockApplyDescription).toHaveBeenCalledWith(
        skill.name, skill.plugin_slug, "/workspace", stubResult.best_description,
      );
      expect(onApply).toHaveBeenCalledWith(stubResult.best_description, "1.0.1");
    });
  });

  it("shows success toast after apply and clears result", async () => {
    const user = userEvent.setup();
    mockListen.mockReturnValue(Promise.resolve(vi.fn()));
    mockRunOptimizationLoop.mockResolvedValue(stubResult);

    await renderWithQueries();
    await user.click(screen.getByRole("button", { name: "Optimize" }));
    await waitFor(() => screen.getByRole("button", { name: /apply best description/i }));

    await user.click(screen.getByRole("button", { name: /apply best description/i }));

    await waitFor(() => expect(screen.getByText(/applied successfully/i)).toBeInTheDocument());
    // Result section should be gone
    expect(screen.queryByText("Results")).not.toBeInTheDocument();
  });

  it("shows route-level guard dialog when blockerStatus is blocked", async () => {
    blockerControl.status = "blocked";
    mockLoadEvalQueries.mockResolvedValue([]);
    render(<WorkspaceDescription skill={skill} workspacePath="/workspace" />);
    await waitFor(() => expect(mockLoadEvalQueries).toHaveBeenCalled());

    expect(screen.getByText("Optimization In Progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
  });
});
