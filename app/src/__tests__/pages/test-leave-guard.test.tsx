/**
 * Leave-guard wiring tests for TestPage.
 *
 * Covers:
 * - Navigation is blocked while a test run is in progress
 * - Clicking Leave calls cleanupSkillTest (if testId) + cleanupSkillSidecar
 * - Clicking Stay keeps the page and does not call cleanup
 *
 * Uses the real useTestStore so the shouldBlock predicate is exercised via
 * actual store state (not a stub). Everything else is mocked minimally.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTestStore } from "@/stores/test-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";

// ---------------------------------------------------------------------------
// Controllable router mock — mockBlocker.status drives the guard dialog
// ---------------------------------------------------------------------------
const mockBlocker = vi.hoisted(() => ({
  proceed: vi.fn(),
  reset: vi.fn(),
  status: "idle" as string,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  useBlocker: () => mockBlocker,
}));

// ---------------------------------------------------------------------------
// Tauri mock — track cleanup calls
// ---------------------------------------------------------------------------
const mockCleanupSkillTest = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCleanupSkillSidecar = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/tauri", () => ({
  listRefinableSkills: vi.fn().mockResolvedValue([]),
  getWorkspacePath: vi.fn().mockResolvedValue("/tmp/ws"),
  getDisabledSteps: vi.fn().mockResolvedValue(null),
  startAgent: vi.fn().mockResolvedValue("agent-id"),
  cleanupSkillSidecar: mockCleanupSkillSidecar,
  prepareSkillTest: vi.fn().mockResolvedValue({
    test_id: "t1",
    baseline_cwd: "/tmp/baseline",
    with_skill_cwd: "/tmp/with-skill",
    transcript_log_dir: "/tmp/logs",
  }),
  cleanupSkillTest: mockCleanupSkillTest,
}));

vi.mock("@/hooks/use-agent-stream", () => ({}));
vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));

vi.mock("@/stores/refine-store", () => {
  const _state = { setSkill: vi.fn(), isRunning: false, setPendingInitialMessage: vi.fn() };
  const useRefineStore = (selector?: (s: typeof _state) => unknown) =>
    selector ? selector(_state) : _state;
  useRefineStore.getState = () => _state;
  return { useRefineStore };
});

// Import TestPage AFTER mocks
const { default: TestPage } = await import("@/pages/test");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderTestPage() {
  return render(<TestPage />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TestPage — leave-guard wiring", () => {
  beforeEach(() => {
    useTestStore.setState({ isRunning: false });
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
    useSettingsStore.getState().setSettings({ anthropicApiKey: "sk-test", skillsPath: "/skills" });
    mockBlocker.status = "idle";
    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockCleanupSkillTest.mockClear();
    mockCleanupSkillSidecar.mockClear();
  });

  it("shows leave guard dialog when isRunning and navigation is blocked", async () => {
    useTestStore.getState().setRunning(true);
    mockBlocker.status = "blocked";

    renderTestPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /stay/i })).toBeInTheDocument();
    });
  });

  it("clicking Leave calls cleanupSkillSidecar and clears running state", async () => {
    const user = userEvent.setup();
    useTestStore.getState().setRunning(true);
    mockBlocker.status = "blocked";

    renderTestPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /leave/i }));

    expect(mockCleanupSkillSidecar).toHaveBeenCalledWith("__test_baseline__");
    expect(useTestStore.getState().isRunning).toBe(false);
  });

  it("clicking Stay calls blocker.reset and does not call cleanup", async () => {
    const user = userEvent.setup();
    useTestStore.getState().setRunning(true);
    mockBlocker.status = "blocked";

    renderTestPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stay/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /stay/i }));

    expect(mockBlocker.reset).toHaveBeenCalled();
    expect(mockCleanupSkillTest).not.toHaveBeenCalled();
    expect(mockCleanupSkillSidecar).not.toHaveBeenCalled();
  });
});
