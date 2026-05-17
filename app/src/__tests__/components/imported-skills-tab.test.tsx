import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import type { AppSettings, LibraryPlugin } from "@/lib/types";
import { renderWithQueryClient as render } from "@/test/query-test-utils";

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
import { toast } from "@/lib/toast";
import { queryKeys } from "@/lib/queries/query-keys";

const defaultSettings: AppSettings = {
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
  max_dimensions: 5,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
  auto_update: false,
};

const samplePlugins: LibraryPlugin[] = [
  {
    id: 1,
    slug: "skills",
    display_name: "Skills",
    version: null,
    source_type: "synthetic",
    source_url: null,
    is_default: true,
    upgrade_locked: false,
  },
  {
    id: 2,
    slug: "analytics-pack",
    display_name: "Analytics Pack",
    version: "1.0.0",
    source_type: "marketplace",
    source_url: "https://github.com/test-org/skills",
    is_default: false,
    upgrade_locked: false,
  },
  {
    id: 3,
    slug: "local-tools",
    display_name: "Local Tools",
    version: "2.0.0",
    source_type: "local",
    source_url: null,
    is_default: false,
    upgrade_locked: false,
  },
];

function setupMocks(plugins: LibraryPlugin[] = samplePlugins) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_settings") return Promise.resolve(defaultSettings);
    if (cmd === "list_plugins") return Promise.resolve(plugins);
    if (cmd === "delete_plugin") return Promise.resolve(undefined);
    if (cmd === "parse_skill_file") return Promise.resolve({ name: "test-skill", description: "desc", version: "1.0.0", user_invocable: null, disable_model_invocation: null });
    return Promise.reject(new Error(`Unmocked command: ${cmd}`));
  });
}

describe("ImportedSkillsTab", () => {
  beforeEach(() => {
    resetTauriMocks();
    useSettingsStore.getState().reset();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("shows loading skeletons while fetching", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "list_plugins") return new Promise(() => {});
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });
    render(<ImportedSkillsTab />);

    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders plugin rows for non-default plugins", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("Analytics Pack")).toBeInTheDocument();
    });
    expect(screen.getByText("Local Tools")).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText("2.0.0")).toBeInTheDocument();
  });

  it("hides default plugin from the list", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("Analytics Pack")).toBeInTheDocument();
    });
    // Default plugin "Skills" should not appear as a row
    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
  });

  it("shows empty state when only default plugin exists", async () => {
    setupMocks([samplePlugins[0]]); // Only the default
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("No plugins")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Browse the marketplace or upload a skill package to get started.")
    ).toBeInTheDocument();
  });

  it("renders Create Plugin button", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Create Plugin/ })).toBeInTheDocument();
    });
  });

  it("renders Upload button", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
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
    useSettingsStore.getState().setSettings({
      marketplaceRegistries: [{ name: "Test", source_url: "https://github.com/owner/skills", enabled: true }],
    });
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Marketplace/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("renders delete button for each non-default plugin", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByLabelText("Delete Analytics Pack")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Delete Local Tools")).toBeInTheDocument();
  });

  it("delete plugin shows success toast and refreshes list", async () => {
    const user = userEvent.setup();
    setupMocks();
    const { queryClient } = render(<ImportedSkillsTab />);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => {
      expect(screen.getByLabelText("Delete Analytics Pack")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Delete Analytics Pack"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_plugin", { pluginSlug: "analytics-pack" });
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Deleted plugin "Analytics Pack"',
      expect.anything(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.skills.all });
  });

  it("shows source URL when available", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("https://github.com/test-org/skills")).toBeInTheDocument();
    });
  });

  it("shows source_type when no source URL", async () => {
    setupMocks();
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("local")).toBeInTheDocument();
    });
  });

  it("shows upgrade-locked badge when plugin.upgrade_locked is true", async () => {
    const lockedPlugins: LibraryPlugin[] = [
      samplePlugins[0],
      {
        id: 2,
        slug: "analytics-pack",
        display_name: "Analytics Pack",
        version: "1.0.0",
        source_type: "marketplace",
        source_url: "https://github.com/test-org/skills",
        is_default: false,
        upgrade_locked: true,
      },
    ];
    setupMocks(lockedPlugins);
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("Upgrades locked")).toBeInTheDocument();
    });
  });

  it("does not call import when file dialog is cancelled", async () => {
    const user = userEvent.setup();
    setupMocks([samplePlugins[0]]);
    (mockOpen as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<ImportedSkillsTab />);

    await waitFor(() => {
      expect(screen.getByText("No plugins")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Upload" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockInvoke).not.toHaveBeenCalledWith("import_skill_from_file", expect.anything());
  });
});
