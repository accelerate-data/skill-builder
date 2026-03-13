import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { resetTauriMocks } from "@/test/mocks/tauri";

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ skill: undefined }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ proceed: vi.fn(), reset: vi.fn(), status: "idle" }),
}));

// Mock toast
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

// Mock agent stream hook side-effect import
vi.mock("@/hooks/use-agent-stream", () => ({}));

// Mock tauri — use vi.hoisted so variables are available in the factory (which is hoisted)
const mockReleaseLock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockCleanupSkillSidecar = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockCloseRefineSession = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/tauri", () => ({
  listRefinableSkills: vi.fn(() => Promise.resolve([])),
  getSkillContentForRefine: vi.fn(() => Promise.resolve([])),
  startRefineSession: vi.fn(() => Promise.resolve({ session_id: "s1" })),
  sendRefineMessage: vi.fn(() => Promise.resolve("agent-1")),
  closeRefineSession: mockCloseRefineSession,
  finalizeRefineRun: vi.fn(() => Promise.resolve({ files: [], diff: null })),
  materializeRefineValidationOutput: vi.fn(() => Promise.resolve()),
  cleanupSkillSidecar: mockCleanupSkillSidecar,
  acquireLock: vi.fn(() => Promise.resolve()),
  releaseLock: mockReleaseLock,
}));

// Mock child components to avoid deep rendering
vi.mock("@/components/refine/resizable-split-pane", () => ({
  ResizableSplitPane: () => <div data-testid="split-pane" />,
}));
vi.mock("@/components/refine/skill-picker", () => ({
  SkillPicker: () => <div data-testid="skill-picker" />,
}));
vi.mock("@/components/refine/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/refine/preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview-panel" />,
}));
vi.mock("@/hooks/use-scope-blocked", () => ({
  useScopeBlocked: () => false,
}));
vi.mock("@/stores/skill-store", () => ({
  useSkillStore: (sel: (state: { lockedSkills: string[] }) => unknown) => sel({ lockedSkills: [] }),
}));

import RefinePage from "@/pages/refine";
import type { SkillSummary } from "@/lib/types";
import { useRefineStore } from "@/stores/refine-store";
import { useSettingsStore } from "@/stores/settings-store";

const TEST_SKILL: SkillSummary = {
  name: "my-skill",
  current_step: null,
  status: null,
  last_modified: null,
  tags: [],
  purpose: null,
  author_login: null,
  author_avatar: null,
  intake_json: null,
  description: "",
};

beforeEach(() => {
  resetTauriMocks();
  mockReleaseLock.mockClear();
  mockCleanupSkillSidecar.mockClear();
  mockCloseRefineSession.mockClear();
  useRefineStore.setState({ selectedSkill: null, isRunning: false, activeAgentId: null, sessionId: null });
  useSettingsStore.setState({ workspacePath: "/workspace", skillsPath: null });
});

describe("RefinePage — lock release on unmount", () => {
  it("releases lock on unmount when a skill was selected", () => {
    useRefineStore.setState({ selectedSkill: TEST_SKILL });

    const { unmount } = render(<RefinePage />);
    unmount();

    expect(mockReleaseLock).toHaveBeenCalledWith("my-skill");
    expect(mockCleanupSkillSidecar).toHaveBeenCalledWith("my-skill");
  });

  it("closes backend session on unmount when a session is active", () => {
    useRefineStore.setState({ selectedSkill: TEST_SKILL, sessionId: "session-abc" });

    const { unmount } = render(<RefinePage />);
    unmount();

    // closeRefineSession must be called BEFORE clearSession so the Rust in-memory
    // map is cleaned up — prevents "already exists" on the next startRefineSession.
    expect(mockCloseRefineSession).toHaveBeenCalledWith("session-abc");
    expect(mockReleaseLock).toHaveBeenCalledWith("my-skill");
  });

  it("does not call releaseLock on unmount when no skill was selected", () => {
    const { unmount } = render(<RefinePage />);
    unmount();

    expect(mockReleaseLock).not.toHaveBeenCalled();
    expect(mockCloseRefineSession).not.toHaveBeenCalled();
  });
});
