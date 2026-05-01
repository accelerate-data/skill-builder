import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetTauriMocks } from "@/test/mocks/tauri";
import { renderWithQueryClient as render } from "@/test/query-test-utils";
import { useSettingsStore } from "@/stores/settings-store";

// Mock @tanstack/react-router
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
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

// Mock SkillDialog to avoid its dependencies
vi.mock("@/components/skill-dialog", () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? <div data-testid="skill-dialog"><button onClick={() => onOpenChange(false)}>Close</button></div> : null,
}));

import DashboardPage from "@/pages/dashboard";

describe("DashboardPage", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockNavigate.mockReset();
    useSettingsStore.getState().reset();
  });

  it("renders select-a-skill heading and description", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Select a skill")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a skill from the list to open its workspace, or create a new one.")
    ).toBeInTheDocument();
  });

  it("renders New Skill button", () => {
    render(<DashboardPage />);

    expect(screen.getByRole("button", { name: /New Skill/i })).toBeInTheDocument();
  });

  it("opens SkillDialog when New Skill button is clicked", async () => {
    useSettingsStore.getState().setSettings({
      workspacePath: "/home/user/workspace",
    });
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    expect(screen.getByTestId("skill-dialog")).toBeInTheDocument();
  });

  it("does not render SkillDialog when workspacePath is not set", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    expect(screen.queryByTestId("skill-dialog")).not.toBeInTheDocument();
  });
});
