import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import type { WorkspaceSkill, AppSettings } from "@/lib/types";

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

// Mock @tanstack/react-router
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// Mock react-markdown (avoid complex rendering in tests)
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: () => {},
}));

import { SkillsLibraryTab } from "@/components/skills-library-tab";

const defaultSettings: AppSettings = {
  anthropic_api_key: "sk-test",
  workspace_path: "/home/user/workspace",
  skills_path: "/home/user/skills",
  preferred_model: "sonnet",
  log_level: "info",
  extended_context: false,
  extended_thinking: false,
  splash_shown: false,
  github_oauth_token: null,
  github_user_login: null,
  github_user_avatar: null,
  github_user_email: null,
  marketplace_url: null,
  max_dimensions: 5,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
};

const sampleSkills: WorkspaceSkill[] = [
  {
    skill_id: "id-1",
    skill_name: "sales-analytics",
    domain: "sales",
    description: "Analytics skill for sales data",
    is_active: true,
    disk_path: "/skills/sales-analytics",
    imported_at: "2026-01-15T10:00:00Z",
    is_bundled: false,
    skill_type: null,
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    purpose: null,
  },
  {
    skill_id: "id-2",
    skill_name: "hr-metrics",
    domain: "HR",
    description: null,
    is_active: false,
    disk_path: "/skills/hr-metrics",
    imported_at: "2026-01-10T08:00:00Z",
    is_bundled: false,
    skill_type: null,
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    purpose: null,
  },
];

function setupMocks(skills: WorkspaceSkill[] = sampleSkills) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_settings") return Promise.resolve(defaultSettings);
    if (cmd === "list_workspace_skills") return Promise.resolve(skills);
    return Promise.reject(new Error(`Unmocked command: ${cmd}`));
  });
}

describe("SkillsLibraryTab", () => {
  beforeEach(() => {
    resetTauriMocks();
    useSettingsStore.getState().reset();
    useImportedSkillsStore.setState({
      skills: [],
      isLoading: false,
      error: null,
      selectedSkill: null,
    });
    mockNavigate.mockReset();
  });

  it("shows loading skeletons while fetching", async () => {
    // list_workspace_skills hangs — component stays in loading state
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "list_workspace_skills") return new Promise(() => {}); // hang
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });
    render(<SkillsLibraryTab />);

    // Wait for list_workspace_skills to be called, which puts the store in loading state
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_workspace_skills");
    });

    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders upload button", async () => {
    setupMocks();
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Upload Skill/i })).toBeInTheDocument();
    });
  });

  it("Marketplace button is disabled when marketplace URL is not configured", async () => {
    // Store default: marketplaceUrl = null
    setupMocks();
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Marketplace/i });
      expect(btn).toBeDisabled();
    });
  });

  it("Marketplace button is enabled when marketplace URL is configured", async () => {
    useSettingsStore.getState().setSettings({ marketplaceUrl: "https://github.com/owner/skills" });
    setupMocks();
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Marketplace/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("renders skill rows when skills exist", async () => {
    setupMocks();
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("sales-analytics")).toBeInTheDocument();
    });
    expect(screen.getByText("hr-metrics")).toBeInTheDocument();
  });

  it("shows empty state when no skills", async () => {
    setupMocks([]);
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_workspace_skills");
    });

    await waitFor(() => {
      expect(screen.getByText("No workspace skills")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Upload a .skill package or browse the marketplace to add skills.")
    ).toBeInTheDocument();
  });

  it("shows domain text on skill row", async () => {
    setupMocks();
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("sales")).toBeInTheDocument();
    });
    expect(screen.getByText("HR")).toBeInTheDocument();
  });

  it("renders active toggle switch for each skill", async () => {
    setupMocks();
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /Toggle sales-analytics/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("switch", { name: /Toggle hr-metrics/i })).toBeInTheDocument();
  });

  it("renders delete button for non-bundled skills", async () => {
    setupMocks();
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete sales-analytics/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Delete hr-metrics/i })).toBeInTheDocument();
  });

  it("does not render delete button for bundled skills", async () => {
    const bundledSkill: WorkspaceSkill = {
      ...sampleSkills[0],
      skill_id: "id-bundled",
      skill_name: "bundled-skill",
      is_bundled: true,
    };
    setupMocks([bundledSkill]);
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("bundled-skill")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Delete bundled-skill/i })).not.toBeInTheDocument();
  });

  it("calls upload_skill when file is selected", async () => {
    const user = userEvent.setup();

    const newSkill: WorkspaceSkill = {
      skill_id: "id-3",
      skill_name: "new-skill",
      domain: null,
      description: "A new skill",
      is_active: true,
      disk_path: "/skills/new-skill",
      imported_at: new Date().toISOString(),
      is_bundled: false,
      skill_type: null,
      version: null,
      model: null,
      argument_hint: null,
      user_invocable: null,
      disable_model_invocation: null,
      purpose: null,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "list_workspace_skills") return Promise.resolve([]);
      if (cmd === "upload_skill") return Promise.resolve(newSkill);
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });
    (mockOpen as ReturnType<typeof vi.fn>).mockResolvedValue("/path/to/file.skill");

    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("No workspace skills")).toBeInTheDocument();
    });

    const uploadButton = screen.getByRole("button", { name: /Upload Skill/i });
    await user.click(uploadButton);

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("upload_skill", { filePath: "/path/to/file.skill" });
    });
  });

  it("does not call upload_skill when dialog is cancelled", async () => {
    const user = userEvent.setup();

    setupMocks([]);
    (mockOpen as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("No workspace skills")).toBeInTheDocument();
    });

    const uploadButton = screen.getByRole("button", { name: /Upload Skill/i });
    await user.click(uploadButton);

    // upload_skill should never be called
    await new Promise((r) => setTimeout(r, 50));
    expect(mockInvoke).not.toHaveBeenCalledWith("upload_skill", expect.anything());
  });

  // Test A — Built-in badge renders for bundled skills (VD-876)
  it("shows Built-in badge for bundled skill and not for non-bundled skill", async () => {
    const bundledSkill: WorkspaceSkill = {
      ...sampleSkills[0],
      skill_id: "id-bundled",
      skill_name: "bundled-skill",
      is_bundled: true,
    };
    const nonBundledSkill: WorkspaceSkill = {
      ...sampleSkills[1],
      skill_id: "id-regular",
      skill_name: "regular-skill",
      is_bundled: false,
    };
    setupMocks([bundledSkill, nonBundledSkill]);
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("bundled-skill")).toBeInTheDocument();
    });
    expect(screen.getByText("regular-skill")).toBeInTheDocument();

    // Built-in badge should appear for the bundled skill
    expect(screen.getByText("Built-in")).toBeInTheDocument();

    // Only one Built-in badge — regular-skill should not have one
    const builtInBadges = screen.getAllByText("Built-in");
    expect(builtInBadges).toHaveLength(1);
  });

  // Test B — Purpose badge renders for skills with a purpose (VD-883)
  it("shows purpose badge for skill with purpose and not for skill with null purpose", async () => {
    const skillWithPurpose: WorkspaceSkill = {
      ...sampleSkills[0],
      skill_id: "id-purpose",
      skill_name: "research-skill",
      purpose: "research",
    };
    const skillNoPurpose: WorkspaceSkill = {
      ...sampleSkills[1],
      skill_id: "id-no-purpose",
      skill_name: "plain-skill",
      purpose: null,
    };
    setupMocks([skillWithPurpose, skillNoPurpose]);
    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("research-skill")).toBeInTheDocument();
    });
    expect(screen.getByText("plain-skill")).toBeInTheDocument();

    // Purpose badge should show for the skill with purpose
    expect(screen.getByText("research")).toBeInTheDocument();

    // Only one "research" badge — plain-skill has no purpose badge
    const purposeBadges = screen.getAllByText("research");
    expect(purposeBadges).toHaveLength(1);
  });

  // Test C — Set purpose calls set_workspace_skill_purpose (VD-883)
  it("calls set_workspace_skill_purpose when a purpose is selected from the popover", async () => {
    const user = userEvent.setup();

    const skill: WorkspaceSkill = {
      ...sampleSkills[0],
      skill_id: "id-purpose-test",
      skill_name: "my-skill",
      purpose: null,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "list_workspace_skills") return Promise.resolve([skill]);
      if (cmd === "set_workspace_skill_purpose") return Promise.resolve();
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<SkillsLibraryTab />);

    await waitFor(() => {
      expect(screen.getByText("my-skill")).toBeInTheDocument();
    });

    // Open the purpose popover via the Tag icon button
    const purposeTrigger = screen.getByRole("button", { name: /Set purpose for my-skill/i });
    await user.click(purposeTrigger);

    // Wait for the popover to open and select "research"
    await waitFor(() => {
      expect(screen.getByText("Set purpose")).toBeInTheDocument();
    });

    const researchOption = screen.getByRole("button", { name: "research" });
    await user.click(researchOption);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("set_workspace_skill_purpose", {
        skillId: "id-purpose-test",
        purpose: "research",
      });
    });
  });
});
