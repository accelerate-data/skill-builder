import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import type { SkillSummary, AppSettings } from "@/lib/types";

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

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

import DashboardPage from "@/pages/dashboard";

const defaultSettings: AppSettings = {
  anthropic_api_key: "sk-ant-test",
  workspace_path: "/home/user/workspace",
};

const sampleSkills: SkillSummary[] = [
  {
    name: "sales-pipeline",
    domain: "sales",
    current_step: "Step 3",
    status: "in_progress",
    last_modified: new Date().toISOString(),
  },
  {
    name: "hr-analytics",
    domain: "HR",
    current_step: "completed",
    status: "completed",
    last_modified: new Date().toISOString(),
  },
];

function setupMocks(
  overrides: Partial<{
    settings: Partial<AppSettings>;
    skills: SkillSummary[];
    workspaceExists: boolean;
  }> = {}
) {
  const settings = { ...defaultSettings, ...overrides.settings };
  const skills = overrides.skills ?? sampleSkills;
  const workspaceExists = overrides.workspaceExists ?? true;

  mockInvokeCommands({
    get_settings: settings,
    list_skills: skills,
    check_workspace_path: workspaceExists,
    create_skill: undefined,
    delete_skill: undefined,
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockNavigate.mockReset();
  });

  it("shows loading spinner while fetching skills", async () => {
    // Make get_settings resolve immediately but list_skills hang
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "check_workspace_path") return Promise.resolve(true);
      // list_skills hangs forever
      return new Promise(() => {});
    });
    render(<DashboardPage />);

    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeTruthy();
    });
  });

  it("renders skill cards when skills exist", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });
    expect(screen.getByText("Hr Analytics")).toBeInTheDocument();
  });

  it("shows page title", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Skills")).toBeInTheDocument();
    });
  });

  it("shows empty state when no skills and workspace is set", async () => {
    setupMocks({ skills: [] });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("No skills yet")).toBeInTheDocument();
      expect(
        screen.getByText("Create your first skill to get started.")
      ).toBeInTheDocument();
    });
  });

  it("shows empty state with settings link when no workspace", async () => {
    setupMocks({ settings: { workspace_path: null }, skills: [] });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("No skills yet")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "Configure a workspace path in Settings to get started."
      )
    ).toBeInTheDocument();
  });

  it("shows workspace warning when path does not exist on disk", async () => {
    setupMocks({ workspaceExists: false });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Workspace folder not found")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/configured workspace path no longer exists/)
    ).toBeInTheDocument();
  });

  it("navigates to skill page when Continue is clicked", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    const continueButtons = screen.getAllByRole("button", {
      name: /Continue/i,
    });
    await user.click(continueButtons[0]);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "sales-pipeline" },
    });
  });

  it("shows New Skill button when workspace is set", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /New Skill/i })
    ).toBeInTheDocument();
  });

  it("does not show New Skill button when no workspace", async () => {
    setupMocks({ settings: { workspace_path: null }, skills: [] });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("No skills yet")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /New Skill/i })
    ).not.toBeInTheDocument();
  });
});
