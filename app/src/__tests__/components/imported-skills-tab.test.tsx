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
import type { ImportedSkill, AppSettings } from "@/lib/types";

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

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: () => {},
}));

import { ImportedSkillsTab } from "@/components/imported-skills-tab";

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
  marketplace_registries: [],
  marketplace_initialized: false,
  max_dimensions: 5,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
  auto_update: false,
};

const sampleSkills: ImportedSkill[] = [
  {
    skill_id: "id-1",
    skill_name: "sales-analytics",
    description: "Analytics skill for sales data",
    is_active: true,
    disk_path: "/skills/sales-analytics",
    imported_at: "2026-01-15T10:00:00Z",
    is_bundled: false,
    purpose: null,
    version: "1.0.0",
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
  },
  {
    skill_id: "id-2",
    skill_name: "hr-metrics",
    description: null,
    is_active: true,
    disk_path: "/skills/hr-metrics",
    imported_at: "2026-01-10T08:00:00Z",
    is_bundled: false,
    purpose: null,
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
  },
];

function setupMocks(skills: ImportedSkill[] = sampleSkills) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_settings") return Promise.resolve(defaultSettings);
    if (cmd === "list_imported_skills") return Promise.resolve(skills);
    if (cmd === "import_skill_from_file") return Promise.resolve("skill-id");
    return Promise.reject(new Error(`Unmocked command: ${cmd}`));
  });
}

describe("ImportedSkillsTab", () => {
  beforeEach(() => {
    resetTauriMocks();
    useSettingsStore.getState().reset();
    useImportedSkillsStore.setState({
      skills: [],
      isLoading: false,
      error: null,
    });
    mockNavigate.mockReset();
  });

  it("shows loading skeletons while fetching", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "list_imported_skills") return new Promise(() => {});
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_imported_skills", { sourceUrl: null });
    });

    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders import button", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    });
  });

  it("Marketplace button is disabled when no registry is enabled", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Marketplace/i });
      expect(btn).toBeDisabled();
    });
  });

  it("Marketplace button is enabled when a registry is configured", async () => {
    useSettingsStore.getState().setSettings({ marketplaceRegistries: [{ name: "Test", source_url: "https://github.com/owner/skills", enabled: true }] });
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Marketplace/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("renders skill rows when skills exist", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("sales-analytics")).toBeInTheDocument();
    });
    expect(screen.getByText("hr-metrics")).toBeInTheDocument();
  });

  it("shows empty state when no skills", async () => {
    setupMocks([]);
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_imported_skills", { sourceUrl: null });
    });

    await waitFor(() => {
      expect(screen.getByText("No imported skills")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Import a .skill package or browse the marketplace to add skills.")
    ).toBeInTheDocument();
  });

  it("renders delete button for non-bundled skills", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete sales-analytics/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Delete hr-metrics/i })).toBeInTheDocument();
  });

  it("does not render delete button for bundled skills", async () => {
    const bundledSkill: ImportedSkill = {
      ...sampleSkills[0],
      skill_id: "id-bundled",
      skill_name: "bundled-skill",
      is_bundled: true,
    };
    setupMocks([bundledSkill]);
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("bundled-skill")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Delete bundled-skill/i })).not.toBeInTheDocument();
  });

  it("shows Built-in badge for bundled skill", async () => {
    const bundledSkill: ImportedSkill = {
      ...sampleSkills[0],
      skill_id: "id-bundled",
      skill_name: "bundled-skill",
      is_bundled: true,
    };
    const nonBundledSkill: ImportedSkill = {
      ...sampleSkills[1],
      skill_id: "id-regular",
      skill_name: "regular-skill",
      is_bundled: false,
    };
    setupMocks([bundledSkill, nonBundledSkill]);
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("bundled-skill")).toBeInTheDocument();
    });
    expect(screen.getByText("regular-skill")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    const builtInBadges = screen.getAllByText("Built-in");
    expect(builtInBadges).toHaveLength(1);
  });

  it("does not call import when dialog is cancelled", async () => {
    const user = userEvent.setup();

    setupMocks([]);
    (mockOpen as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("No imported skills")).toBeInTheDocument();
    });

    const importButton = screen.getByRole("button", { name: "Import" });
    await user.click(importButton);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockInvoke).not.toHaveBeenCalledWith("import_skill_from_file", expect.anything());
  });
});
