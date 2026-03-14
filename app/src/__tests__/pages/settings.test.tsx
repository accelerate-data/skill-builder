import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";
import { useAuthStore } from "@/stores/auth-store";

import type { AppSettings } from "@/lib/types";

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

// Mock next-themes
const mockSetTheme = vi.fn();
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: mockSetTheme }),
}));

// Mock @tanstack/react-router
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// Mock shadcn Select with a native <select> so selectOptions works in jsdom.
const SelectCtx = React.createContext<{
  value: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
  idRef: React.MutableRefObject<string | undefined>;
} | null>(null);

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => {
    const idRef = React.useRef<string | undefined>(undefined);
    return (
      <SelectCtx.Provider value={{ value, onValueChange, disabled, idRef }}>
        {children}
      </SelectCtx.Provider>
    );
  },
  SelectTrigger: ({ id }: { id?: string; children?: React.ReactNode }) => {
    const ctx = React.useContext(SelectCtx);
    if (ctx && id) ctx.idRef.current = id;
    return null;
  },
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => {
    const ctx = React.useContext(SelectCtx);
    return (
      <select
        id={ctx?.idRef.current}
        value={ctx?.value ?? ""}
        onChange={(e) => ctx?.onValueChange?.(e.target.value)}
        disabled={ctx?.disabled}
      >
        {children}
      </select>
    );
  },
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: () => null,
  SelectSeparator: () => null,
}));


// Mock @/lib/tauri functions that the settings page imports
vi.mock("@/lib/tauri", () => ({
  getDataDir: vi.fn(() => Promise.resolve("/Users/test/Library/Application Support/com.skill-builder.app")),
  checkMarketplaceUrl: vi.fn(() => Promise.resolve("Test Registry")),
  parseGitHubUrl: vi.fn(() => Promise.resolve({ owner: "test", repo: "repo", branch: "main", subpath: null })),
  githubStartDeviceFlow: vi.fn(),
  githubPollForToken: vi.fn(),
  githubGetUser: vi.fn(() => Promise.resolve(null)),
  githubLogout: vi.fn(),
}));

vi.mock("@/components/github-login-dialog", () => ({
  GitHubLoginDialog: () => null,
}));

vi.mock("@/components/imported-skills-tab", () => ({
  ImportedSkillsTab: () => <div data-testid="skills-page">Imported Skills Content</div>,
}));

vi.mock("@/components/feedback-dialog", () => ({
  FeedbackDialog: () => null,
}));

// Import after mocks are set up
import SettingsPage from "@/pages/settings";
import { useSettingsStore } from "@/stores/settings-store";

const defaultSettings: AppSettings = {
  anthropic_api_key: null,
  workspace_path: null,
  skills_path: null,
  preferred_model: null,
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

const populatedSettings: AppSettings = {
  anthropic_api_key: "sk-ant-existing-key",
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

function setupDefaultMocks(settingsOverride?: Partial<AppSettings>) {
  const settings = { ...defaultSettings, ...settingsOverride };
  mockInvokeCommands({
    get_settings: settings,
    save_settings: undefined,
    test_api_key: true,
    get_log_file_path: "/tmp/com.vibedata.skill-builder/skill-builder.log",
    set_log_level: undefined,
  });
  // Populate the settings store with the mock settings
  useSettingsStore.setState({
    anthropicApiKey: settings.anthropic_api_key,
    workspacePath: settings.workspace_path,
    skillsPath: settings.skills_path,
    preferredModel: settings.preferred_model,
    logLevel: settings.log_level,
    extendedThinking: settings.extended_thinking,
    interleavedThinkingBeta: settings.interleaved_thinking_beta ?? true,
    sdkEffort: settings.sdk_effort,
    fallbackModel: settings.fallback_model,
    refinePromptSuggestions: settings.refine_prompt_suggestions ?? true,
    maxDimensions: settings.max_dimensions ?? 5,
    industry: settings.industry,
    functionRole: settings.function_role,
    autoUpdate: settings.auto_update ?? false,
    githubOauthToken: settings.github_oauth_token,
    githubUserLogin: settings.github_user_login,
    githubUserAvatar: settings.github_user_avatar,
    githubUserEmail: settings.github_user_email,
    marketplaceRegistries: settings.marketplace_registries ?? [],
    marketplaceInitialized: settings.marketplace_initialized ?? false,
    dashboardViewMode: settings.dashboard_view_mode,
  });
}

/** Helper to switch to a specific settings section after page loads */
async function switchToSection(sectionName: RegExp | string) {
  const pattern = sectionName instanceof RegExp ? sectionName : new RegExp(sectionName, "i");
  const button = screen.getByRole("button", { name: pattern });
  const user = userEvent.setup();
  await user.click(button);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockNavigate.mockClear();
    // Default to logged-out state
    useAuthStore.setState({ user: null, isLoggedIn: false, isLoading: false });
    useSettingsStore.getState().reset();
    // Reset URL search params so tab defaults to "general"
    window.history.replaceState({}, "", window.location.pathname);
  });

  it("back button navigates to dashboard", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /back to dashboard/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("renders all 6 sections in left nav", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /General/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Claude SDK/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marketplace/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Advanced/i })).toBeInTheDocument();
  });

  it("renders General section card sections by default", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.getByText("User Profile")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("initializes settings from store snapshot", () => {
    // Populate store with specific values
    const testSettings: Partial<AppSettings> = {
      anthropic_api_key: "sk-ant-test-key",
      preferred_model: "opus",
      log_level: "debug",
    };
    setupDefaultMocks(testSettings);
    render(<SettingsPage />);

    // The page should load synchronously with no loading state,
    // since settings are initialized from the store snapshot
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("populates API key after settings load", async () => {
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Claude SDK/i);

    // API key field (password input)
    const apiKeyInput = screen.getByPlaceholderText("sk-ant-...");
    expect(apiKeyInput).toHaveValue("sk-ant-existing-key");
  });

  it("shows 'Not configured' when no skills folder path", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("calls invoke with test_api_key when Test button is clicked", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Claude SDK/i);

    const testButtons = screen.getAllByRole("button", { name: /Test/i });
    // First "Test" button is the Anthropic API key test button
    await user.click(testButtons[0]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("test_api_key", {
        apiKey: "sk-ant-existing-key",
      });
    });
  });

  it("auto-saves when Extended Thinking toggle is changed", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Claude SDK/i);

    const thinkingSwitch = screen.getByRole("switch", { name: /Extended thinking/i });
    await user.click(thinkingSwitch);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          extended_thinking: true,
        }),
      });
    });
  });

  it("auto-saves on API key blur", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Claude SDK/i);

    const apiKeyInput = screen.getByPlaceholderText("sk-ant-...");
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, "sk-ant-new-key");
    await user.tab(); // blur the input

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          anthropic_api_key: "sk-ant-new-key",
        }),
      });
    });
  });

  it("shows Saved indicator after auto-save", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Claude SDK/i);

    const thinkingSwitch = screen.getByRole("switch", { name: /Extended thinking/i });
    await user.click(thinkingSwitch);

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("shows error toast on auto-save failure", async () => {
    const user = userEvent.setup();
    const { toast } = await import("@/lib/toast");
    setupDefaultMocks(populatedSettings);
    // Override save_settings to fail
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "save_settings") return Promise.reject("DB error");
      if (cmd === "get_settings") return Promise.resolve(populatedSettings);
      return Promise.resolve(undefined);
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Claude SDK/i);

    const thinkingSwitch = screen.getByRole("switch", { name: /Extended thinking/i });
    await user.click(thinkingSwitch);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to save: DB error",
        expect.objectContaining({ duration: Infinity }),
      );
    });
  });

  it("displays the app version from Tauri", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      const matches = screen.getAllByText("v0.1.0");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows fallback version when getVersion fails", async () => {
    const { mockGetVersion } = await import("@/test/mocks/tauri");
    mockGetVersion.mockRejectedValueOnce(new Error("not available"));
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      const matches = screen.getAllByText("vdev");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders Skills Folder row with Browse button in Storage card", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Skills Folder")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse/i })).toBeInTheDocument();
  });

  it("renders Skills Folder path when configured", async () => {
    setupDefaultMocks({ skills_path: "/home/user/my-skills" });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("/home/user/my-skills")).toBeInTheDocument();
  });

  it("does not render workspace folder controls in Storage card", async () => {
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.queryByText("Workspace Folder")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear/i })).not.toBeInTheDocument();
  });

  it("does not render Clear button when workspace path is not set", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.queryByRole("button", { name: /Clear/i })).not.toBeInTheDocument();
  });

  it("includes skills_path in auto-save payload when browsing", async () => {
    const user = userEvent.setup();
    setupDefaultMocks({ ...populatedSettings, skills_path: "/output" });
    vi.mocked(mockOpen).mockResolvedValueOnce("/new/skills/path");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          skills_path: "/new/skills/path",
        }),
      });
    });
  });

  it("normalizes duplicate last segment from browse dialog", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    // Simulate macOS dialog returning a doubled path
    vi.mocked(mockOpen).mockResolvedValueOnce("/Users/me/Skills/Skills");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    // After normalization, the path should have the duplicate stripped
    await waitFor(() => {
      expect(screen.getByText("/Users/me/Skills")).toBeInTheDocument();
    });
  });

  it("normalizes duplicated Windows browse dialog paths with spaces", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    vi.mocked(mockOpen).mockResolvedValueOnce("C:\\Users\\me\\Skill Builder\\Skill Builder\\");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText("C:\\Users\\me\\Skill Builder")).toBeInTheDocument();
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          skills_path: "C:\\Users\\me\\Skill Builder",
        }),
      });
    });
  });

  it("strips trailing slash from browse dialog path", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    vi.mocked(mockOpen).mockResolvedValueOnce("/Users/me/Skills/");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText("/Users/me/Skills")).toBeInTheDocument();
    });
  });

  it("does not alter a normal browse dialog path", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    vi.mocked(mockOpen).mockResolvedValueOnce("/Users/me/Skills");
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText("/Users/me/Skills")).toBeInTheDocument();
    });
  });

  it("renders Data Directory path in Storage card", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Data Directory")).toBeInTheDocument();
    expect(
      screen.getByText("/Users/test/Library/Application Support/com.skill-builder.app")
    ).toBeInTheDocument();
  });

  it("shows 'Unknown' when get_data_dir fails", async () => {
    const { getDataDir } = await import("@/lib/tauri");
    vi.mocked(getDataDir).mockRejectedValueOnce(new Error("no dir"));
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders Log Level select in Logging card", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Logging")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Log Level/i })).toBeInTheDocument();
  });

  it("calls set_log_level when log level is changed", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const select = screen.getByRole("combobox", { name: /Log Level/i });
    await user.selectOptions(select, "debug");

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("set_log_level", { level: "debug" });
    });
  });

  it("auto-saves log_level when log level select is changed", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const select = screen.getByRole("combobox", { name: /Log Level/i });
    await user.selectOptions(select, "debug");

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          log_level: "debug",
        }),
      });
    });
  });

  it("renders logging helper text in Logging card", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Logging")).toBeInTheDocument();
    expect(
      screen.getByText(/Chat transcripts \(JSONL\) are always captured regardless of level\./i)
    ).toBeInTheDocument();
  });

  it("does not show a log file path fallback message", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
  });

  it("renders Appearance card with theme buttons", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
  });

  it("calls setTheme when a theme button is clicked", async () => {
    const user = userEvent.setup();
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("shows sign in button when not logged in", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/GitHub/i);

    expect(screen.getByText("GitHub Account")).toBeInTheDocument();
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Sign in with GitHub/i })).toBeInTheDocument();
  });

  it("shows checking state while auth status is loading", async () => {
    useAuthStore.setState({ user: null, isLoggedIn: false, isLoading: true, lastCheckedAt: null });
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/GitHub/i);

    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Checking GitHub connection...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in with GitHub/i })).not.toBeInTheDocument();
  });

  it("shows user info when logged in", async () => {
    useAuthStore.setState({
      user: { login: "octocat", avatar_url: "https://github.com/octocat.png", email: "octocat@github.com" },
      isLoggedIn: true,
      isLoading: false,
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    });
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/GitHub/i);

    expect(screen.getByText("GitHub Account")).toBeInTheDocument();
    expect(screen.getByText("@octocat")).toBeInTheDocument();
    expect(screen.getByText("octocat@github.com")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/Last checked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign Out/i })).toBeInTheDocument();
    // Should NOT show "Not connected"
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
  });

  it("auto-switches to skills section when pendingUpgradeOpen is set", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("skills-page")).not.toBeInTheDocument();

    act(() => {
      useSettingsStore.getState().setPendingUpgradeOpen({ skills: ["my-skill"] });
    });

    await waitFor(() => {
      expect(screen.getByTestId("skills-page")).toBeInTheDocument();
    });
  });

  it("shows Registries section in Marketplace tab", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Marketplace/i);

    expect(screen.getByText("Registries")).toBeInTheDocument();
  });
});
