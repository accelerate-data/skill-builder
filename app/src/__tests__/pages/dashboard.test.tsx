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
  skills_path: null,
  preferred_model: "sonnet",
  debug_mode: false,
  extended_context: false,
  splash_shown: false,
};

const sampleSkills: SkillSummary[] = [
  {
    name: "sales-pipeline",
    domain: "sales",
    current_step: "Step 3",
    status: "in_progress",
    last_modified: new Date().toISOString(),
    tags: ["salesforce", "crm"],
    skill_type: "platform",
  },
  {
    name: "hr-analytics",
    domain: "HR",
    current_step: "completed",
    status: "completed",
    last_modified: new Date().toISOString(),
    tags: ["workday"],
    skill_type: "domain",
  },
];

function setupMocks(
  overrides: Partial<{
    settings: Partial<AppSettings>;
    skills: SkillSummary[];
  }> = {}
) {
  const settings = { ...defaultSettings, ...overrides.settings };
  const skills = overrides.skills ?? sampleSkills;

  mockInvokeCommands({
    get_settings: settings,
    list_skills: skills,
    create_skill: undefined,
    delete_skill: undefined,
    get_all_tags: ["salesforce", "crm", "workday"],
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockNavigate.mockReset();
  });

  it("shows loading skeletons while fetching skills", async () => {
    // Make get_settings resolve immediately but list_skills hang
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      // list_skills hangs forever
      return new Promise(() => {});
    });
    render(<DashboardPage />);

    await waitFor(() => {
      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
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

  it("shows empty state when no skills", async () => {
    setupMocks({ skills: [] });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("No skills yet")).toBeInTheDocument();
      expect(
        screen.getByText("Create your first skill to get started.")
      ).toBeInTheDocument();
    });
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

  // --- F2: Search and Filter tests ---

  it("renders search input when skills exist", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Search skills...")).toBeInTheDocument();
  });

  it("filters skills by name", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search skills...");
    await user.type(searchInput, "sales");

    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.queryByText("Hr Analytics")).not.toBeInTheDocument();
  });

  it("filters skills by domain", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search skills...");
    await user.type(searchInput, "HR");

    expect(screen.queryByText("Sales Pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("Hr Analytics")).toBeInTheDocument();
  });

  it("shows no matching skills state when search has no results", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search skills...");
    await user.type(searchInput, "nonexistent");

    expect(screen.getByText("No matching skills")).toBeInTheDocument();
    expect(
      screen.getByText("Try a different search term or clear your filters.")
    ).toBeInTheDocument();
  });

  it("does not show search bar when workspace is empty", async () => {
    setupMocks({ skills: [] });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("No skills yet")).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText("Search skills...")).not.toBeInTheDocument();
  });

  it("renders Tags filter button when skills exist", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Tags/i })).toBeInTheDocument();
  });

  it("filters skills by tag selection", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    // Open tag filter dropdown
    await user.click(screen.getByRole("button", { name: /Tags/i }));

    // Select "workday" tag via the checkbox menu item
    const menuItem = screen.getByRole("menuitemcheckbox", { name: /workday/i });
    await user.click(menuItem);

    expect(screen.queryByText("Sales Pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("Hr Analytics")).toBeInTheDocument();
  });

  // --- Type filter tests ---

  it("renders Type filter button when skills exist", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Type/i })).toBeInTheDocument();
  });

  it("filters skills by type selection", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    // Open type filter dropdown
    await user.click(screen.getByRole("button", { name: /Type/i }));

    // Select "Platform" type
    const menuItem = screen.getByRole("menuitemcheckbox", { name: /Platform/i });
    await user.click(menuItem);

    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.queryByText("Hr Analytics")).not.toBeInTheDocument();
  });

  it("combines search, tag, and type filters", async () => {
    const user = userEvent.setup();
    setupMocks({
      skills: [
        ...sampleSkills,
        {
          name: "marketing-data",
          domain: "marketing",
          current_step: "Step 1",
          status: "in_progress",
          last_modified: new Date().toISOString(),
          tags: ["salesforce"],
          skill_type: "platform",
        },
      ],
    });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    });

    // Filter by type: platform (Sales Pipeline + Marketing Data)
    await user.click(screen.getByRole("button", { name: /Type/i }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Platform/i }));

    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Marketing Data")).toBeInTheDocument();
    expect(screen.queryByText("Hr Analytics")).not.toBeInTheDocument();

    // Further filter by search: "marketing"
    const searchInput = screen.getByPlaceholderText("Search skills...");
    await user.type(searchInput, "marketing");

    expect(screen.queryByText("Sales Pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("Marketing Data")).toBeInTheDocument();
  });
});
