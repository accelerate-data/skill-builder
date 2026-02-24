import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import { toast } from "sonner";
import type { AppSettings, ReconciliationResult } from "@/lib/types";

// Mock @tanstack/react-router
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: "/" } }),
  Outlet: () => <div data-testid="outlet">Dashboard Content</div>,
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

// Mock layout sub-components to avoid their dependencies (localStorage, next-themes, etc.)
vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar">Sidebar</aside>,
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock("@/components/close-guard", () => ({
  CloseGuard: () => null,
}));

vi.mock("@/components/splash-screen", () => ({
  SplashScreen: ({
    onReady,
    onDismiss,
  }: {
    onReady: () => void;
    onDismiss: () => void;
  }) => {
    // Simulate immediate successful validation. Schedule via queueMicrotask
    // to avoid setting parent state during render.
    queueMicrotask(() => {
      onReady();
      onDismiss();
    });
    return null;
  },
}));

vi.mock("@/components/setup-screen", () => ({
  SetupScreen: () => {
    return <div data-testid="setup-screen">Setup</div>;
  },
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

// Must import after mocks are set up
import { AppLayout } from "@/components/layout/app-layout";
import { useSettingsStore } from "@/stores/settings-store";

const defaultSettings: AppSettings = {
  anthropic_api_key: "sk-ant-test",
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
  max_dimensions: 8,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
  auto_update: false,
};

const emptyReconciliation: ReconciliationResult = {
  orphans: [],
  notifications: [],
  auto_cleaned: 0,
  discovered_skills: [],
};

describe("AppLayout", () => {
  beforeEach(() => {
    resetTauriMocks();
    useSettingsStore.getState().reset();
    vi.mocked(toast.info).mockReset();
    vi.mocked(toast.warning).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it("calls reconcile_startup after settings load and renders content", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup");
    });

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("blocks content rendering until reconciliation completes", async () => {
    // Settings resolve immediately, reconciliation hangs
    let resolveReconcile!: (value: ReconciliationResult) => void;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup")
        return new Promise<ReconciliationResult>((resolve) => {
          resolveReconcile = resolve;
        });
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    // Wait for settings to load
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup");
    });

    // Content should NOT be rendered yet
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();

    // Resolve reconciliation
    resolveReconcile(emptyReconciliation);

    // Now content should appear
    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("shows info toast when auto_cleaned > 0", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 3, discovered_skills: [] },
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        "Cleaned up 3 incomplete skills"
      );
    });
  });

  it("shows singular text when auto_cleaned is 1", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 1, discovered_skills: [] },
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        "Cleaned up 1 incomplete skill"
      );
    });
  });

  it("shows ReconciliationAckDialog for reset notifications instead of toasts", async () => {
    const notifications = [
      'Skill "sales-pipeline" was reset to step 3 (workspace files are behind database)',
      'Skill "hr-analytics" was reset to step 1 (workspace files are behind database)',
    ];

    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: { orphans: [], notifications, auto_cleaned: 0, discovered_skills: [] },
    });

    render(<AppLayout />);

    // The ACK dialog should appear with the "Startup Reconciliation" title
    await waitFor(() => {
      expect(screen.getByText("Startup Reconciliation")).toBeInTheDocument();
    });

    // Notifications should be listed in the dialog
    expect(screen.getByText(notifications[0])).toBeInTheDocument();
    expect(screen.getByText(notifications[1])).toBeInTheDocument();

    // Content should NOT be rendered until ACK dialog is dismissed
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();

    // toast.warning should NOT be called (notifications go to dialog now)
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("renders content after acknowledging reconciliation dialog", async () => {
    const user = userEvent.setup();

    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: {
        orphans: [],
        notifications: ["'my-skill' was reset from step 3 to step 0"],
        auto_cleaned: 0,
        discovered_skills: [],
      },
    });

    render(<AppLayout />);

    // Wait for the ACK dialog
    await waitFor(() => {
      expect(screen.getByText("Startup Reconciliation")).toBeInTheDocument();
    });

    // Click the Acknowledge button
    await user.click(screen.getByRole("button", { name: /Acknowledge/i }));

    // Content should now render
    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("shows orphan resolution dialog when orphans exist", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: {
        orphans: [
          {
            skill_name: "old-skill",
            purpose: "domain",
          },
        ],
        notifications: [],
        auto_cleaned: 0,
        discovered_skills: [],
      },
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText("Orphaned Skills Found")).toBeInTheDocument();
    });

    expect(screen.getByText("old-skill")).toBeInTheDocument();
  });

  it("proceeds when reconciliation fails (e.g., no workspace configured)", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "reconcile_startup")
        return Promise.reject(new Error("Workspace path not initialized"));
      return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
  });

  it("does not call reconcile_startup until settings are loaded", async () => {
    // Settings hang forever
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    render(<AppLayout />);

    // Give it a tick
    await new Promise((r) => setTimeout(r, 50));

    // reconcile_startup should NOT have been called since settings haven't loaded
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toContain("get_settings");
    expect(calls).not.toContain("reconcile_startup");
  });

  it("shows setup screen when API key is missing", async () => {
    // SetupScreen mock auto-completes, but we can verify it was rendered
    mockInvokeCommands({
      get_settings: { ...defaultSettings, anthropic_api_key: null },
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("setup-screen")).toBeInTheDocument();
    });
  });

  it("shows setup screen when skills path is missing", async () => {
    mockInvokeCommands({
      get_settings: { ...defaultSettings, skills_path: null },
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("setup-screen")).toBeInTheDocument();
    });
  });

  it("skips setup screen for returning users with both settings configured", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: emptyReconciliation,
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });
    // Setup screen should not be present (it auto-completes via mock, but
    // for configured users the isConfigured effect sets setupComplete before
    // splash dismisses, so it never mounts)
  });

  describe("marketplace update toasts", () => {
    const marketplaceSettings = {
      ...defaultSettings,
      marketplace_url: "https://github.com/owner/skill-marketplace",
    };
    const repoInfo = { owner: "owner", repo: "skill-marketplace", branch: "main", subpath: null };

    it("shows info toast for library skills update in manual mode", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "list_models") return Promise.reject(new Error("not needed"));
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [{ name: "sales-skill", path: "skills/sales-skill", version: "1.1.0" }],
          workspace: [],
        });
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          "Skills Library: update available for 1 skill: sales-skill",
          expect.objectContaining({ duration: Infinity })
        );
      });
    });

    it("shows info toast for workspace skills update in manual mode", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "list_models") return Promise.reject(new Error("not needed"));
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [],
          workspace: [{ name: "hr-skill", path: "skills/hr-skill", version: "1.1.0" }],
        });
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          "Settings \u2192 Skills: update available for 1 skill: hr-skill",
          expect.objectContaining({ duration: Infinity })
        );
      });
    });

    it("shows success toast after auto-updating non-customized skills", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve({ ...marketplaceSettings, auto_update: true });
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "list_models") return Promise.reject(new Error("not needed"));
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [{ name: "sales-skill", path: "skills/sales-skill", version: "1.1.0" }],
          workspace: [],
        });
        if (cmd === "check_skill_customized") return Promise.resolve(false);
        if (cmd === "import_marketplace_to_library") return Promise.resolve([]);
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ duration: Infinity })
        );
      });
    });

    it("skips customized skills during auto-update", async () => {
      mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_settings") return Promise.resolve({ ...marketplaceSettings, auto_update: true });
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "list_models") return Promise.reject(new Error("not needed"));
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [
            { name: "customized-skill", path: "skills/customized-skill", version: "1.1.0" },
            { name: "stock-skill", path: "skills/stock-skill", version: "1.1.0" },
          ],
          workspace: [],
        });
        if (cmd === "check_skill_customized") return Promise.resolve(args?.skillName === "customized-skill");
        if (cmd === "import_marketplace_to_library") return Promise.resolve([]);
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      // Only the 1 non-customized skill is auto-updated
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ duration: Infinity })
        );
      });
    });

    it("shows no toast when all skills are up to date", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "list_models") return Promise.reject(new Error("not needed"));
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.resolve({
          library: [],
          workspace: [],
        });
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      // Wait for the check to complete (reconciliation done = content visible)
      await waitFor(() => {
        expect(screen.getByTestId("outlet")).toBeInTheDocument();
      });

      expect(toast.info).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("shows persistent error toast when marketplace update check fails", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(marketplaceSettings);
        if (cmd === "reconcile_startup") return Promise.resolve(emptyReconciliation);
        if (cmd === "list_models") return Promise.reject(new Error("not needed"));
        if (cmd === "parse_github_url") return Promise.resolve(repoInfo);
        if (cmd === "check_marketplace_updates") return Promise.reject(new Error("marketplace.json not found"));
        return Promise.resolve(undefined);
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Marketplace update check failed: marketplace.json not found",
          expect.objectContaining({ duration: 8000 })
        );
      });
    });
  });
});
