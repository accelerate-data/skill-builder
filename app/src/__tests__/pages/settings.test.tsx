import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
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

// Mock @/lib/tauri functions that the settings page imports
vi.mock("@/lib/tauri", () => ({
  checkNode: vi.fn(() =>
    Promise.resolve({
      available: true,
      version: "20.0.0",
      meets_minimum: true,
      error: null,
    })
  ),
  listGithubRepos: vi.fn(() => Promise.resolve([])),
  cloneRepo: vi.fn(() =>
    Promise.resolve({
      path: "/some/path",
      created_readme: false,
      created_gitignore: false,
    })
  ),
  commitAndPush: vi.fn(() => Promise.resolve("No changes to commit")),
}));

// Import after mocks are set up
import SettingsPage from "@/pages/settings";

const defaultSettings: AppSettings = {
  anthropic_api_key: null,
  github_token: null,
  github_repo: null,
  workspace_path: null,
  auto_commit: false,
  auto_push: false,
};

const populatedSettings: AppSettings = {
  anthropic_api_key: "sk-ant-existing-key",
  github_token: "ghp_existingtoken",
  github_repo: "owner/repo",
  workspace_path: "/home/user/workspace",
  auto_commit: true,
  auto_push: false,
};

function setupDefaultMocks(settingsOverride?: Partial<AppSettings>) {
  const settings = { ...defaultSettings, ...settingsOverride };
  mockInvokeCommands({
    get_settings: settings,
    save_settings: undefined,
    test_api_key: true,
    get_current_user: { login: "testuser" },
    check_node: {
      available: true,
      version: "20.0.0",
      meets_minimum: true,
      error: null,
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
    expect(screen.getByText("GitHub Token")).toBeInTheDocument();
    expect(screen.getByText("Node.js Runtime")).toBeInTheDocument();
    expect(screen.getByText("GitHub Repository")).toBeInTheDocument();
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

  it("populates form fields after settings load", async () => {
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    // API key field (password input)
    const apiKeyInput = screen.getByPlaceholderText("sk-ant-...");
    expect(apiKeyInput).toHaveValue("sk-ant-existing-key");

    // GitHub token field
    const ghTokenInput = screen.getByPlaceholderText("ghp_...");
    expect(ghTokenInput).toHaveValue("ghp_existingtoken");

    // Workspace path
    const workspaceInput = screen.getByPlaceholderText("Select a folder...");
    expect(workspaceInput).toHaveValue("/home/user/workspace");
  });

  it("calls invoke with test_api_key when Test button is clicked", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    // There are two "Test" buttons (one for API key, one for GH token).
    // The first "Test" button is for the API key.
    const testButtons = screen.getAllByRole("button", { name: /Test/i });
    const apiTestButton = testButtons[0];

    await user.click(apiTestButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("test_api_key", {
        apiKey: "sk-ant-existing-key",
      });
    });
  });

  it("calls invoke with save_settings when Save button is clicked", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: /Save Settings/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: populatedSettings,
      });
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
});
