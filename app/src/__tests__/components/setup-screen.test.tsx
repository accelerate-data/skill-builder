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

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
  Toaster: () => null,
}));

vi.mock("@/lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri");
  return {
    ...actual,
    getDefaultSkillsPath: vi.fn(() => Promise.resolve("/Users/test/skill-builder")),
  };
});

import { SetupScreen } from "@/components/setup-screen";

const baseSettings = {
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
    expect(screen.getByLabelText("Anthropic API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Skills Folder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Test/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get Started/i })).toBeInTheDocument();
  });

  it("pre-populates skills path with default", async () => {
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      const input = screen.getByLabelText("Skills Folder") as HTMLInputElement;
      expect(input.value).toBe("/Users/test/skill-builder");
    });
  });

  it("disables Get Started when API key is empty", async () => {
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Get Started/i })).toBeDisabled();
  });

  it("enables Get Started when both fields are filled", async () => {
    const user = userEvent.setup();
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Anthropic API Key"), "sk-ant-test");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Get Started/i })).not.toBeDisabled();
    });
  });

  it("Test button calls test_api_key", async () => {
    const user = userEvent.setup();
    mockInvokeCommands({ test_api_key: true });
    render(<SetupScreen onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Skill Builder")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Anthropic API Key"), "sk-ant-test");
    await user.click(screen.getByRole("button", { name: /Test/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("test_api_key", { apiKey: "sk-ant-test" });
    });
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

    await user.type(screen.getByLabelText("Anthropic API Key"), "sk-ant-test");
    await user.click(screen.getByRole("button", { name: /Get Started/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          anthropic_api_key: "sk-ant-test",
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

    await user.type(screen.getByLabelText("Anthropic API Key"), "sk-ant-test");
    await user.click(screen.getByRole("button", { name: /Get Started/i }));

    await waitFor(() => {
      expect(useSettingsStore.getState().isConfigured).toBe(true);
    });
  });

  it("pre-populates API key from store when already set", async () => {
    useSettingsStore.getState().setSettings({ anthropicApiKey: "sk-ant-existing" });
    render(<SetupScreen />);

    await waitFor(() => {
      const input = screen.getByLabelText("Anthropic API Key") as HTMLInputElement;
      expect(input.value).toBe("sk-ant-existing");
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

    // Type API key
    await user.type(screen.getByLabelText("Anthropic API Key"), "sk-ant-test");

    // Clear skills path
    await user.clear(screen.getByLabelText("Skills Folder"));

    expect(screen.getByRole("button", { name: /Get Started/i })).toBeDisabled();
  });
});
