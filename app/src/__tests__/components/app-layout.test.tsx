import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const defaultSettings: AppSettings = {
  anthropic_api_key: "sk-ant-test",
  workspace_path: "/home/user/workspace",
  skills_path: "/home/user/skills",
  preferred_model: "sonnet",
  debug_mode: false,
  extended_context: false,
  extended_thinking: false,
  splash_shown: false,
};

const emptyReconciliation: ReconciliationResult = {
  orphans: [],
  notifications: [],
  auto_cleaned: 0,
};

describe("AppLayout", () => {
  beforeEach(() => {
    resetTauriMocks();
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
      reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 3 },
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
      reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 1 },
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        "Cleaned up 1 incomplete skill"
      );
    });
  });

  it("shows warning toasts for reset notifications", async () => {
    const notifications = [
      'Skill "sales-pipeline" was reset to step 3 (workspace files are behind database)',
      'Skill "hr-analytics" was reset to step 1 (workspace files are behind database)',
    ];

    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: { orphans: [], notifications, auto_cleaned: 0 },
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(notifications[0], {
        duration: 5000,
      });
      expect(toast.warning).toHaveBeenCalledWith(notifications[1], {
        duration: 5000,
      });
    });
  });

  it("shows orphan resolution dialog when orphans exist", async () => {
    mockInvokeCommands({
      get_settings: defaultSettings,
      reconcile_startup: {
        orphans: [
          {
            skill_name: "old-skill",
            domain: "test",
            skill_type: "domain",
          },
        ],
        notifications: [],
        auto_cleaned: 0,
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
});
