import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";
import { useAuthStore } from "@/stores/auth-store";

import type { AppSettings } from "@/lib/types";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  Toaster: () => null,
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


// Mock @/lib/tauri functions that the settings page imports
vi.mock("@/lib/tauri", () => ({
  getDataDir: vi.fn(() => Promise.resolve("/Users/test/Library/Application Support/com.skill-builder.app")),
  githubStartDeviceFlow: vi.fn(),
  githubPollForToken: vi.fn(),
  githubGetUser: vi.fn(() => Promise.resolve(null)),
  githubLogout: vi.fn(),
  validateRemoteRepo: vi.fn(() => Promise.resolve()),
  listUserRepos: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/components/github-login-dialog", () => ({
  GitHubLoginDialog: () => null,
}));

vi.mock("@/components/skills-library-tab", () => ({
  SkillsLibraryTab: () => <div data-testid="skills-page">Skills Library Content</div>,
}));

vi.mock("@/components/feedback-dialog", () => ({
  FeedbackDialog: () => null,
}));

// Import after mocks are set up
import SettingsPage from "@/pages/settings";

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
  remote_repo_owner: null,
  remote_repo_name: null,
  max_dimensions: 8,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
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
  remote_repo_owner: null,
  remote_repo_name: null,
  max_dimensions: 8,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
};

function setupDefaultMocks(settingsOverride?: Partial<AppSettings>) {
  const settings = { ...defaultSettings, ...settingsOverride };
  mockInvokeCommands({
    get_settings: settings,
    save_settings: undefined,
    test_api_key: true,
    get_log_file_path: "/tmp/com.skillbuilder.app/skill-builder.log",
    set_log_level: undefined,
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

  it("renders all 5 sections in left nav", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /General/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skill Building/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skills Library/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Advanced/i })).toBeInTheDocument();
  });

  it("renders General section card sections by default", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.getByText("API Configuration")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("User Profile")).toBeInTheDocument();
  });

  it("shows loading spinner initially", () => {
    // Don't resolve get_settings immediately - make it hang
    mockInvoke.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    render(<SettingsPage />);

    // The page should show the loading spinner (Loader2 has animate-spin class)
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("populates API key after settings load", async () => {
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    // API key field (password input)
    const apiKeyInput = screen.getByPlaceholderText("sk-ant-...");
    expect(apiKeyInput).toHaveValue("sk-ant-existing-key");
  });

  it("shows 'Not initialized' when no workspace path", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);
    expect(screen.getByText("Not initialized")).toBeInTheDocument();
  });

  it("calls invoke with test_api_key when Test button is clicked", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

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

    await switchToSection(/Skill Building/i);

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

    await switchToSection(/Skill Building/i);

    const thinkingSwitch = screen.getByRole("switch", { name: /Extended thinking/i });
    await user.click(thinkingSwitch);

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("shows error toast on auto-save failure", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");
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

    await switchToSection(/Skill Building/i);

    const thinkingSwitch = screen.getByRole("switch", { name: /Extended thinking/i });
    await user.click(thinkingSwitch);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to save: DB error", { duration: Infinity });
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

  it("renders Clear button in Storage card for Workspace Folder", async () => {
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Workspace Folder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear/i })).toBeInTheDocument();
  });

  it("disables Clear button when workspace path is not set", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const clearButton = screen.getByRole("button", { name: /Clear/i });
    expect(clearButton).toBeDisabled();
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

  it("renders log file path in Logging card", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Logging")).toBeInTheDocument();
    expect(screen.getByText("/tmp/com.skillbuilder.app/skill-builder.log")).toBeInTheDocument();
  });

  it("shows 'Not available' when log file path is not set", async () => {
    // Override invoke so get_log_file_path rejects
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(defaultSettings);
      if (cmd === "get_log_file_path") return Promise.reject(new Error("not available"));
      return Promise.resolve(undefined);
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Not available")).toBeInTheDocument();
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
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with GitHub/i })).toBeInTheDocument();
  });

  it("shows user info when logged in", async () => {
    useAuthStore.setState({
      user: { login: "octocat", avatar_url: "https://github.com/octocat.png", email: "octocat@github.com" },
      isLoggedIn: true,
      isLoading: false,
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
    expect(screen.getByRole("button", { name: /Sign Out/i })).toBeInTheDocument();
    // Should NOT show "Not connected"
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
  });
});
