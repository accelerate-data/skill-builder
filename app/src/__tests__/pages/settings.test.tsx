import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";
import { openPath as mockOpenPath } from "@tauri-apps/plugin-opener";
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

// Mock @tauri-apps/plugin-opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(() => Promise.resolve()),
}));

// Mock @/lib/tauri functions that the settings page imports
vi.mock("@/lib/tauri", () => ({
  checkNode: vi.fn(() =>
    Promise.resolve({
      available: true,
      version: "20.0.0",
      meets_minimum: true,
      error: null,
      source: "system",
    })
  ),
  getDataDir: vi.fn(() => Promise.resolve("/Users/test/Library/Application Support/com.skill-builder.app")),
}));

// Import after mocks are set up
import SettingsPage from "@/pages/settings";

const defaultSettings: AppSettings = {
  anthropic_api_key: null,
  workspace_path: null,
  skills_path: null,
  preferred_model: null,
  debug_mode: false,
  extended_context: false,
  extended_thinking: false,
  splash_shown: false,
};

const populatedSettings: AppSettings = {
  anthropic_api_key: "sk-ant-existing-key",
  workspace_path: "/home/user/workspace",
  skills_path: null,
  preferred_model: "sonnet",
  debug_mode: false,
  extended_context: false,
  extended_thinking: false,
  splash_shown: false,
};

function setupDefaultMocks(settingsOverride?: Partial<AppSettings>) {
  const settings = { ...defaultSettings, ...settingsOverride };
  mockInvokeCommands({
    get_settings: settings,
    save_settings: undefined,
    test_api_key: true,
    check_node: {
      available: true,
      version: "20.0.0",
      meets_minimum: true,
      error: null,
      source: "system",
    },
  });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("renders all card sections", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByText("Checking Node.js...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("API Configuration")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Workspace Folder")).toBeInTheDocument();
    expect(screen.getByText("Node.js Runtime")).toBeInTheDocument();
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

    // Workspace path shown as read-only text
    expect(screen.getByText("/home/user/workspace")).toBeInTheDocument();
  });

  it("shows 'Not initialized' when no workspace path", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

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

    const testButton = screen.getByRole("button", { name: /Test/i });
    await user.click(testButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("test_api_key", {
        apiKey: "sk-ant-existing-key",
      });
    });
  });

  it("auto-saves when debug mode toggle is changed", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const debugSwitch = screen.getByRole("switch", { name: /Unattended workflow/i });
    await user.click(debugSwitch);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          debug_mode: true,
        }),
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

    const debugSwitch = screen.getByRole("switch", { name: /Unattended workflow/i });
    await user.click(debugSwitch);

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

    const debugSwitch = screen.getByRole("switch", { name: /Unattended workflow/i });
    await user.click(debugSwitch);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to save: DB error", { duration: Infinity });
    });
  });

  it("displays Node.js available status after check", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
    });

    expect(screen.getByText("v20.0.0")).toBeInTheDocument();
  });

  it("has the page title 'Settings'", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const heading = screen.getByRole("heading", { name: "Settings" });
    expect(heading).toBeInTheDocument();
  });

  it("displays the app version from Tauri", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Skill Builder v0.1.0")).toBeInTheDocument();
    });
  });

  it("shows fallback version when getVersion fails", async () => {
    const { mockGetVersion } = await import("@/test/mocks/tauri");
    mockGetVersion.mockRejectedValueOnce(new Error("not available"));
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Skill Builder vdev")).toBeInTheDocument();
    });
  });

  it("renders Skills Folder card with Browse button", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

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

    expect(screen.getByText("/home/user/my-skills")).toBeInTheDocument();
  });

  it("renders Clear button in Workspace Folder card", async () => {
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.getByText("Workspace Folder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear/i })).toBeInTheDocument();
  });

  it("disables Clear button when workspace path is not set", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

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

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText("/Users/me/Skills")).toBeInTheDocument();
    });
  });

  it("renders Data Directory card with path", async () => {
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

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

    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("calls openPath when Open button is clicked", async () => {
    const user = userEvent.setup();
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    await user.click(openButton);

    expect(mockOpenPath).toHaveBeenCalledWith(
      "/Users/test/Library/Application Support/com.skill-builder.app"
    );
  });

  it("disables Open button when data dir is unknown", async () => {
    const { getDataDir } = await import("@/lib/tauri");
    vi.mocked(getDataDir).mockRejectedValueOnce(new Error("no dir"));
    setupDefaultMocks();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    expect(openButton).toBeDisabled();
  });
});
