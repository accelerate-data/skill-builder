import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import { useSettingsStore } from "@/stores/settings-store";
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

import DashboardPage from "@/pages/dashboard";

const defaultSettings: AppSettings = {
  anthropic_api_key: "sk-ant-test",
  workspace_path: "/home/user/workspace",
  skills_path: null,
  preferred_model: "sonnet",
  log_level: "info",
  extended_context: false,
  extended_thinking: false,
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

const sampleSkills: SkillSummary[] = [
  {
    name: "sales-pipeline",
    current_step: "Step 3",
    status: "in_progress",
    last_modified: new Date().toISOString(),
    tags: ["salesforce", "crm"],
    purpose: "platform",
    skill_source: "skill-builder",
    author_login: null,
    author_avatar: null,
    intake_json: null,
  },
  {
    name: "hr-analytics",
    current_step: "completed",
    status: "completed",
    last_modified: new Date().toISOString(),
    tags: ["workday"],
    purpose: "domain",
    skill_source: "skill-builder",
    author_login: null,
    author_avatar: null,
    intake_json: null,
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
    package_skill: { file_path: "/tmp/test.skill", size_bytes: 1024 },
    copy_file: undefined,
    save_settings: undefined,
    get_locked_skills: [],
  });

  // Hydrate the Zustand settings store (normally done by app-layout.tsx)
  useSettingsStore.getState().setSettings({
    workspacePath: settings.workspace_path,
    skillsPath: settings.skills_path,
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockNavigate.mockReset();
    useSettingsStore.getState().reset();
  });

  it("shows loading skeletons while fetching skills", async () => {
    // Setup store with workspace path
    useSettingsStore.getState().setSettings({
      workspacePath: defaultSettings.workspace_path,
      skillsPath: defaultSettings.skills_path,
    });
    // Make list_skills hang forever
    mockInvoke.mockImplementation(() => {
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
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });
    expect(screen.getByText("hr-analytics")).toBeInTheDocument();
  });

  it("navigates to skill page when skill card is clicked", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    // Click the skill name text to trigger navigation (card click)
    await user.click(screen.getByText("sales-pipeline"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "sales-pipeline" },
    });
  });

  it("does not show an Import button in the action bar when workspace and skills_path are configured", async () => {
    setupMocks({ settings: { skills_path: "/home/user/skills" } });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /^Import$/i })).not.toBeInTheDocument();
  });

  it("shows New Skill button when workspace and skills_path are set", async () => {
    setupMocks({ settings: { skills_path: "/home/user/skills" } });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /New Skill/i })
    ).toBeInTheDocument();
  });

  it("hides New Skill button and shows banner when skills_path is not set", async () => {
    setupMocks(); // skills_path is null by default
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /New Skill/i })).not.toBeInTheDocument();
    expect(screen.getByText("Skills folder not configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Settings/i })).toBeInTheDocument();
  });

  // --- F2: Search and Filter tests ---

  it("renders search input when skills exist", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Search skills...")).toBeInTheDocument();
  });

  it("filters skills by name", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search skills...");
    await user.type(searchInput, "sales");

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    expect(screen.queryByText("hr-analytics")).not.toBeInTheDocument();
  });

  it("filters skills by domain", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search skills...");
    await user.type(searchInput, "HR");

    expect(screen.queryByText("sales-pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("hr-analytics")).toBeInTheDocument();
  });

  it("shows no matching skills state when search has no results", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
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
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Tags/i })).toBeInTheDocument();
  });

  it("filters skills by tag selection", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    // Open tag filter dropdown
    await user.click(screen.getByRole("button", { name: /Tags/i }));

    // Select "workday" tag via the checkbox menu item
    const menuItem = screen.getByRole("menuitemcheckbox", { name: /workday/i });
    await user.click(menuItem);

    expect(screen.queryByText("sales-pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("hr-analytics")).toBeInTheDocument();
  });

  // --- Type filter tests ---

  it("renders Type filter button when skills exist", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Type/i })).toBeInTheDocument();
  });

  it("filters skills by type selection", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    // Open type filter dropdown
    await user.click(screen.getByRole("button", { name: /Type/i }));

    // Select "platform" type (now labeled "Organization specific Azure or Fabric standards")
    const menuItem = screen.getByRole("menuitemcheckbox", { name: /Azure or Fabric/i });
    await user.click(menuItem);

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    expect(screen.queryByText("hr-analytics")).not.toBeInTheDocument();
  });

  it("combines search, tag, and type filters", async () => {
    const user = userEvent.setup();
    setupMocks({
      settings: { skills_path: "/home/user/skills" },
      skills: [
        ...sampleSkills,
        {
          name: "marketing-data",
          current_step: "Step 1",
          status: "in_progress",
          last_modified: new Date().toISOString(),
          tags: ["salesforce"],
          purpose: "platform",
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
      ],
    });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    // Filter by type: platform (sales-pipeline + marketing-data)
    await user.click(screen.getByRole("button", { name: /Type/i }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Azure or Fabric/i }));

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    expect(screen.getByText("marketing-data")).toBeInTheDocument();
    expect(screen.queryByText("hr-analytics")).not.toBeInTheDocument();

    // Further filter by search: "marketing"
    const searchInput = screen.getByPlaceholderText("Search skills...");
    await user.type(searchInput, "marketing");

    expect(screen.queryByText("sales-pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("marketing-data")).toBeInTheDocument();
  });

  // --- View toggle tests ---

  it("renders view toggle when skills exist", async () => {
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Grid view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List view" })).toBeInTheDocument();
  });

  it("does not show view toggle when no skills exist", async () => {
    setupMocks({ skills: [] });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("No skills yet")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Grid view" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "List view" })).not.toBeInTheDocument();
  });

  it("switches to list view when list icon is clicked", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "List view" }));

    // In list view, rows have role="button" — check that SkillListRow elements are rendered
    const rows = screen.getAllByRole("button", { name: /Edit workflow/i });
    expect(rows.length).toBeGreaterThan(0);

    // save_settings should have been called to persist the choice
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", expect.objectContaining({
        settings: expect.objectContaining({ dashboard_view_mode: "list" }),
      }));
    });
  });

  it("defaults to list view when >= 10 skills and no saved preference", async () => {
    const manySkills: SkillSummary[] = Array.from({ length: 12 }, (_, i) => ({
      name: `skill-${i}`,
      current_step: "Step 1",
      status: "in_progress",
      last_modified: new Date().toISOString(),
      tags: [],
      purpose: "domain",
      author_login: null,
      author_avatar: null,
      intake_json: null,
    }));
    setupMocks({ skills: manySkills });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("skill-0")).toBeInTheDocument();
    });

    // After loading, auto-select should pick list view (>= 10 skills, no saved preference)
    await waitFor(() => {
      const listButton = screen.getByRole("button", { name: "List view" });
      expect(listButton).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("restores saved view mode from settings store", async () => {
    setupMocks();
    useSettingsStore.getState().setSettings({ dashboardViewMode: "list" });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    const listButton = screen.getByRole("button", { name: "List view" });
    expect(listButton).toHaveAttribute("aria-pressed", "true");
  });

  // --- Toggle back to grid view ---

  it("switches back to grid view when grid icon is clicked after switching to list", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    // Switch to list
    await user.click(screen.getByRole("button", { name: "List view" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    });

    // Switch back to grid
    await user.click(screen.getByRole("button", { name: "Grid view" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "false");
  });

  // --- Delete dialog ---

  it("opens delete dialog when delete icon is clicked on a skill card", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete skill/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete Skill" })).toBeInTheDocument();
    });
  });

  it("closes delete dialog when cancel is clicked", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete skill/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete Skill" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Delete Skill" })).not.toBeInTheDocument();
    });
    // Skill card still present
    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
  });

  it("closes delete dialog when confirm delete is clicked", async () => {
    const user = userEvent.setup();
    setupMocks();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete skill/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete Skill" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Delete Skill" })).not.toBeInTheDocument();
    });
  });

  // --- Source filter ---

  it("filters skills by source when Source filter is applied", async () => {
    const user = userEvent.setup();
    setupMocks({
      skills: [
        {
          name: "builder-skill",
          current_step: "Step 1",
          status: "in_progress",
          last_modified: new Date().toISOString(),
          tags: [],
          purpose: "domain",
          skill_source: "skill-builder",
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
        {
          name: "marketplace-skill",
          current_step: null,
          status: "completed",
          last_modified: new Date().toISOString(),
          tags: [],
          purpose: "domain",
          skill_source: "marketplace",
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
      ],
    });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("builder-skill")).toBeInTheDocument();
    });
    expect(screen.getByText("marketplace-skill")).toBeInTheDocument();

    // Open Source filter dropdown
    await user.click(screen.getByRole("button", { name: /Source/i }));

    // Select "Marketplace" option
    const menuItem = screen.getByRole("menuitemcheckbox", { name: /Marketplace/i });
    await user.click(menuItem);

    // Only marketplace-skill should remain
    await waitFor(() => {
      expect(screen.queryByText("builder-skill")).not.toBeInTheDocument();
    });
    expect(screen.getByText("marketplace-skill")).toBeInTheDocument();
  });

  // --- List view: D3/D4 — edit workflow and more-actions only for skill-builder ---

  it("shows Edit Workflow button only for skill-builder skills in list view", async () => {
    const user = userEvent.setup();
    setupMocks({
      skills: [
        {
          name: "my-skill",
          current_step: "Step 2",
          status: "in_progress",
          last_modified: new Date().toISOString(),
          tags: [],
          purpose: "domain",
          skill_source: "skill-builder",
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
        {
          name: "mkt-skill",
          current_step: null,
          status: "completed",
          last_modified: new Date().toISOString(),
          tags: [],
          purpose: "domain",
          skill_source: "marketplace",
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
      ],
    });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("my-skill")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "List view" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
    });

    // Only one Edit Workflow button (for the skill-builder skill)
    expect(screen.getAllByRole("button", { name: /Edit workflow/i })).toHaveLength(1);
  });

  it("shows More Actions button only for skill-builder skills in list view", async () => {
    const user = userEvent.setup();
    setupMocks({
      skills: [
        {
          name: "my-skill",
          current_step: "Step 2",
          status: "in_progress",
          last_modified: new Date().toISOString(),
          tags: [],
          purpose: "domain",
          skill_source: "skill-builder",
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
        {
          name: "mkt-skill",
          current_step: null,
          status: "completed",
          last_modified: new Date().toISOString(),
          tags: [],
          purpose: "domain",
          skill_source: "marketplace",
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
      ],
    });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("my-skill")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "List view" }));

    // Current row actions expose More Actions on both skill-builder and marketplace rows.
    expect(screen.getAllByRole("button", { name: /More actions/i })).toHaveLength(2);
  });

  // --- List view: D5 — download visible for completed/marketplace skills ---

  it("shows Download for completed skills and Refine only for completed skill-builder skills in list view", async () => {
    const user = userEvent.setup();
    setupMocks({
      settings: { skills_path: "/home/user/skills" },
    });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("hr-analytics")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "List view" }));

    // `sales-pipeline` is at step 3, which now counts as workflow-complete via
    // `isWorkflowComplete`, so both rows expose Download and Refine.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Download skill/i })).toHaveLength(2);
    });
    expect(screen.getAllByRole("button", { name: /Refine skill/i })).toHaveLength(2);
  });
});
