import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@/stores/settings-store";

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

vi.mock("@/lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri");
  return {
    ...actual,
    getDefaultSkillsPath: vi.fn(() =>
      Promise.resolve("/Users/test/skill-builder"),
    ),
  };
});

import { SetupScreen } from "@/components/setup-screen";

const baseSettings = {
  model_settings: null,
  workspace_path: null,
  skills_path: null,
  log_level: "info",
  extended_context: false,
  splash_shown: false,
  github_oauth_token: null,
  github_user_login: null,
  github_user_avatar: null,
  github_user_email: null,
  max_dimensions: 5,
  industry: null,
  function_role: null,
};

describe("SetupScreen", () => {
  beforeEach(() => {
    resetTauriMocks();
    useSettingsStore.getState().reset();
  });

  it("renders with expected elements", async () => {
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Skills Folder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Test/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Get Started/i }),
    ).toBeInTheDocument();
  });

  it("pre-populates skills path with default", async () => {
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      const input = screen.getByLabelText("Skills Folder") as HTMLInputElement;
      expect(input.value).toBe("/Users/test/skill-builder");
    });
  });

  it("enables Get Started when default skills path is loaded", async () => {
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      const input = screen.getByLabelText("Skills Folder") as HTMLInputElement;
      expect(input.value).toBe("/Users/test/skill-builder");
    });

    expect(screen.getByRole("button", { name: /Get Started/i })).not.toBeDisabled();
  });

  it("Browse button opens directory picker and updates skills path", async () => {
    const user = userEvent.setup();
    vi.mocked(mockOpen).mockResolvedValueOnce("/Users/me/my-skills");
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Browse/i }));

    await waitFor(() => {
      const input = screen.getByLabelText("Skills Folder") as HTMLInputElement;
      expect(input.value).toBe("/Users/me/my-skills");
    });
  });

  it("normalizes duplicated Windows paths with spaces from the directory picker", async () => {
    const user = userEvent.setup();
    vi.mocked(mockOpen).mockResolvedValueOnce(
      "C:\\Users\\me\\Skill Builder\\Skill Builder\\",
    );
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Browse/i }));

    await waitFor(() => {
      const input = screen.getByLabelText("Skills Folder") as HTMLInputElement;
      expect(input.value).toBe("C:\\Users\\me\\Skill Builder");
    });
  });

  it("Get Started saves settings and calls onComplete", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    mockInvokeCommands({
      get_settings: baseSettings,
      save_settings: undefined,
    });
    render(<SetupScreen onComplete={onComplete} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Get Started/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          model_settings: null,
          skills_path: "/Users/test/skill-builder",
        }),
      });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("updates settings store isConfigured after save", async () => {
    const user = userEvent.setup();
    mockInvokeCommands({
      get_settings: baseSettings,
      save_settings: undefined,
    });
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Get Started/i }));

    await waitFor(() => {
      expect(useSettingsStore.getState().isConfigured).toBe(true);
    });
  });

  it("pre-populates skills path from store instead of default when already set", async () => {
    useSettingsStore.getState().setSettings({ skillsPath: "/existing/skills" });
    render(<SetupScreen />);

    await waitFor(() => {
      const input = screen.getByLabelText("Skills Folder") as HTMLInputElement;
      expect(input.value).toBe("/existing/skills");
    });
  });

  it("disables Get Started when skills path is cleared", async () => {
    const user = userEvent.setup();
    render(<SetupScreen onComplete={vi.fn()} />);

    // Wait for default skills path to load
    await waitFor(() => {
      const input = screen.getByLabelText("Skills Folder") as HTMLInputElement;
      expect(input.value).toBe("/Users/test/skill-builder");
    });

    // Clear skills path
    await user.clear(screen.getByLabelText("Skills Folder"));

    expect(screen.getByRole("button", { name: /Get Started/i })).toBeDisabled();
  });
});
