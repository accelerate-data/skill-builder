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
  splash_shown: false,
};

const populatedSettings: AppSettings = {
  anthropic_api_key: "sk-ant-existing-key",
  workspace_path: "/home/user/workspace",
  skills_path: null,
  preferred_model: "sonnet",
  debug_mode: false,
  extended_context: false,
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

  it("includes skills_path in save_settings payload", async () => {
    const user = userEvent.setup();
    setupDefaultMocks({ ...populatedSettings, skills_path: "/output" });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: /Save Settings/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          skills_path: "/output",
        }),
      });
    });
  });
});
