import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, act, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/query-test-utils";
import userEvent from "@testing-library/user-event";
import { mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";

import type { AppSettings } from "@/lib/types";

const modelCatalogFixture = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    api: null,
    env: ["ANTHROPIC_API_KEY"],
    doc: "https://docs.anthropic.com",
    models: {
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        tool_call: true,
        structured_output: true,
        temperature: true,
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15 },
        modalities: { input: ["text"], output: ["text"] },
      },
      "claude-basic": {
        id: "claude-basic",
        name: "Claude Basic",
        reasoning: false,
        tool_call: true,
        modalities: { output: ["text"] },
      },
      "claude-no-tools": {
        id: "claude-no-tools",
        name: "Claude No Tools",
        reasoning: true,
        tool_call: false,
        modalities: { output: ["text"] },
      },
    },
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    api: "https://openrouter.ai/api/v1",
    env: ["OPENROUTER_API_KEY"],
    doc: "https://openrouter.ai/docs",
    models: {
      "openai/gpt-5": {
        id: "openai/gpt-5",
        name: "GPT-5",
        reasoning: true,
        tool_call: true,
        structured_output: true,
        temperature: true,
        limit: { context: 400000, output: 128000 },
        cost: { input: 1.25, output: 10 },
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
};

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
  getDataDir: vi.fn(() =>
    Promise.resolve(
      "/Users/test/Library/Application Support/com.skill-builder.app",
    ),
  ),
  checkMarketplaceUrl: vi.fn(() => Promise.resolve("Test Registry")),
  parseGitHubUrl: vi.fn(() =>
    Promise.resolve({
      owner: "test",
      repo: "repo",
      branch: "main",
      subpath: null,
    }),
  ),
  githubStartDeviceFlow: vi.fn(),
  githubPollForToken: vi.fn(),
  githubGetUser: vi.fn(() => Promise.resolve(null)),
  githubLogout: vi.fn(),
  updateUserSettings: vi.fn(() => Promise.resolve(undefined)),
  updateGithubIdentity: vi.fn(() => Promise.resolve(undefined)),
  testModelConnection: vi.fn(() => Promise.resolve(true)),
  setLogLevel: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@/components/github-login-dialog", () => ({
  GitHubLoginDialog: () => null,
}));

vi.mock("@/components/imported-skills-tab", () => ({
  ImportedSkillsTab: () => (
    <div data-testid="skills-page">Imported Skills Content</div>
  ),
}));

vi.mock("@/components/feedback-dialog", () => ({
  FeedbackDialog: () => null,
}));

// Import after mocks are set up
import SettingsPage from "@/pages/settings";
import { useSettingsStore } from "@/stores/settings-store";
import {
  githubGetUser as _githubGetUser,
  updateGithubIdentity as _updateGithubIdentity,
  updateUserSettings as _updateUserSettings,
  testModelConnection as _testModelConnection,
} from "@/lib/tauri";

const defaultSettings: AppSettings = {
  model_settings: null,
  workspace_path: null,
  skills_path: null,
  log_level: "info",
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
  model_settings: {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    api_key: "sk-ant-existing-key",
    base_url: null,
  },
  workspace_path: "/home/user/workspace",
  skills_path: null,
  log_level: "info",
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
    update_user_settings: undefined,
    get_log_file_path: "/tmp/com.vibedata.skill-builder/skill-builder.log",
    set_log_level: undefined,
  });
  // Populate the settings store with the mock settings
  useSettingsStore.setState({
    modelSettings: {
      provider: settings.model_settings?.provider ?? "anthropic",
      model: settings.model_settings?.model ?? null,
      api_key: settings.model_settings?.api_key ?? null,
      base_url: settings.model_settings?.base_url ?? null,
      api_version: settings.model_settings?.api_version ?? null,
      temperature: settings.model_settings?.temperature ?? null,
      max_output_tokens: settings.model_settings?.max_output_tokens ?? null,
      timeout_seconds: settings.model_settings?.timeout_seconds ?? 300,
      num_retries: settings.model_settings?.num_retries ?? 5,
      reasoning_effort: settings.model_settings?.reasoning_effort ?? "auto",
      extra_headers: settings.model_settings?.extra_headers ?? null,
      input_cost_per_token:
        settings.model_settings?.input_cost_per_token ?? null,
      output_cost_per_token:
        settings.model_settings?.output_cost_per_token ?? null,
      usage_id: settings.model_settings?.usage_id ?? "workflow",
    },
    workspacePath: settings.workspace_path,
    skillsPath: settings.skills_path,
    logLevel: settings.log_level,
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
  const pattern =
    sectionName instanceof RegExp ? sectionName : new RegExp(sectionName, "i");
  const button = screen.getByRole("button", { name: pattern });
  const user = userEvent.setup();
  await user.click(button);
}

function getSettingsCard(title: string) {
  const titleNode = screen.getByText(title, {
    selector: '[data-slot="card-title"]',
  });
  const card = titleNode.closest('[data-slot="card"]');
  expect(card).not.toBeNull();
  return within(card as HTMLElement);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(modelCatalogFixture),
        }),
      ),
    );
    mockNavigate.mockClear();
    // Reset module-level mocks so test-specific overrides don't leak
    vi.mocked(_updateUserSettings).mockReset().mockResolvedValue(undefined);
    vi.mocked(_testModelConnection).mockReset().mockResolvedValue(true);
    vi.mocked(_githubGetUser).mockReset().mockResolvedValue(null);
    vi.mocked(_updateGithubIdentity).mockReset().mockResolvedValue(undefined);
    useSettingsStore.getState().reset();
    // Reset URL search params so tab defaults to "general"
    window.history.replaceState({}, "", window.location.pathname);
  });

  it("back button navigates to dashboard", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /back to dashboard/i }),
    );
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/",
      search: { tab: undefined },
    });
  });

  it("renders all 6 sections in left nav", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /General/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Models/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Plugins/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Marketplace/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Advanced/i }),
    ).toBeInTheDocument();
  });

  it("renders General section card sections by default", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

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
      model_settings: {
        provider: "anthropic",
        model: "claude-opus-4-5",
        api_key: "sk-ant-test-key",
        base_url: null,
      },
      log_level: "debug",
    };
    setupDefaultMocks(testSettings);
    renderWithQueryClient(<SettingsPage />);

    // The page should load synchronously with no loading state,
    // since settings are initialized from the store snapshot
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("populates API key after settings load", async () => {
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    // API key field (password input)
    const apiKeyInput = screen.getByPlaceholderText("sk-ant-...");
    expect(apiKeyInput).toHaveValue("sk-ant-existing-key");
  });

  it("auto-saves OpenAI provider model settings", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "OpenRouter" }),
      ).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: /^Provider$/i }),
      "openrouter",
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/Base URL/i)).toHaveValue(
        "https://openrouter.ai/api/v1",
      );
    });
    await user.selectOptions(
      screen.getByLabelText(/^Model$/i),
      "openrouter/openai/gpt-5",
    );

    const { updateUserSettings } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          model_settings: expect.objectContaining({
            provider: "openrouter",
            model: "openrouter/openai/gpt-5",
            base_url: "https://openrouter.ai/api/v1",
          }),
        }),
      );
    });
    expect(vi.mocked(updateUserSettings).mock.calls[0][0]).not.toHaveProperty(
      "openhands_model",
    );
  });

  it("groups model settings fields into the expected sections", async () => {
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    await screen.findByText("Provider", {
      selector: '[data-slot="card-title"]',
    });

    const providerSection = getSettingsCard("Provider");
    expect(
      providerSection.getByRole("combobox", { name: /^Provider$/i }),
    ).toBeInTheDocument();
    expect(providerSection.getByLabelText(/API Key/i)).toBeInTheDocument();
    expect(providerSection.getByLabelText(/Base URL/i)).toBeInTheDocument();

    const modelSection = getSettingsCard("Model");
    const reasoning = modelSection.getByRole("checkbox", {
      name: /Reasoning/i,
    });
    const toolCalling = modelSection.getByRole("checkbox", {
      name: /Tool calling/i,
    });
    expect(reasoning).toBeChecked();
    expect(reasoning).toBeDisabled();
    expect(toolCalling).toBeChecked();
    expect(toolCalling).toBeDisabled();
    expect(
      modelSection.getByRole("combobox", { name: /^Model$/i }),
    ).toBeInTheDocument();
    expect(
      reasoning.compareDocumentPosition(
        modelSection.getByRole("combobox", { name: /^Model$/i }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const modelDetailsSection = getSettingsCard("Model Details");
    expect(modelDetailsSection.getByText("200,000 tokens")).toBeInTheDocument();
    const toolCallingSupport = modelDetailsSection.getByRole("checkbox", {
      name: /Tool calling supported/i,
    });
    const reasoningSupport = modelDetailsSection.getByRole("checkbox", {
      name: /Reasoning supported/i,
    });
    expect(toolCallingSupport).toBeChecked();
    expect(toolCallingSupport).toBeDisabled();
    expect(reasoningSupport).toBeChecked();
    expect(reasoningSupport).toBeDisabled();

    const requestOptionsSection = getSettingsCard("Request Options");
    expect(
      requestOptionsSection.getByText(/Reasoning effort/i),
    ).toBeInTheDocument();
    expect(
      requestOptionsSection.getByLabelText(/Timeout/i),
    ).toBeInTheDocument();
    expect(
      requestOptionsSection.getByLabelText(/Retries/i),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("switch", { name: /Prompt suggestions/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Capabilities", {
        selector: '[data-slot="card-title"]',
      }),
    ).not.toBeInTheDocument();

    const advancedSection = getSettingsCard("Advanced Provider Overrides");
    expect(
      advancedSection.getByLabelText(/Provider API version/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Usage ID/i)).not.toBeInTheDocument();
  });

  it("populates provider and model dropdowns from the catalog and filters unsupported models", async () => {
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "Anthropic" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "OpenRouter" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("option", { name: "Claude Sonnet 4.5" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Claude Basic" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Claude No Tools" }),
    ).not.toBeInTheDocument();
  });

  it("shows catalog API key help and selected model details", async () => {
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    expect(await screen.findByText(/ANTHROPIC_API_KEY/i)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Tool calling supported/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Reasoning supported/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Structured output supported/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Temperature supported/i }),
    ).toBeChecked();
    expect(screen.getAllByText("Supported", { selector: "span" })).toHaveLength(
      4,
    );
    expect(screen.getByText("200,000 tokens")).toBeInTheDocument();
    expect(screen.getByText("64,000 tokens")).toBeInTheDocument();
    expect(screen.getByText(/\$3 input/i)).toBeInTheDocument();
    expect(screen.getByText(/\$15 output/i)).toBeInTheDocument();
    expect(screen.getByText(/Structured output/i)).toBeInTheDocument();
    expect(screen.getByText(/Temperature/i)).toBeInTheDocument();
  });

  it("allows Ollama without an API key and saves base URL", async () => {
    const user = userEvent.setup();
    setupDefaultMocks({
      ...populatedSettings,
      model_settings: {
        provider: "ollama",
        api_key: null,
        model: "llama3.1",
        base_url: "http://localhost:11434",
      },
    });
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    expect(screen.getByLabelText(/API Key/i)).not.toBeRequired();
    const baseUrlInput = screen.getByLabelText(/Base URL/i);
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "http://localhost:11435");
    await user.tab();

    const { updateUserSettings } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          model_settings: expect.objectContaining({
            provider: "ollama",
            api_key: null,
            base_url: "http://localhost:11435",
          }),
        }),
      );
    });
    expect(vi.mocked(updateUserSettings).mock.calls[0][0]).not.toHaveProperty(
      "openhands_base_url",
    );
  });

  it("shows 'Not configured' when no skills folder path", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("calls model connection validation when Test button is clicked", async () => {
    const user = userEvent.setup();
    const { toast } = await import("@/lib/toast");
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    const testButtons = screen.getAllByRole("button", { name: /Test/i });
    // First "Test" button is the Anthropic API key test button
    await user.click(testButtons[0]);

    const { testModelConnection } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(testModelConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key: "sk-ant-existing-key",
          model: "claude-sonnet-4-5",
        }),
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Valid/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows an error toast when model connection validation fails", async () => {
    const user = userEvent.setup();
    const { toast } = await import("@/lib/toast");
    vi.mocked(_testModelConnection).mockRejectedValueOnce(
      new Error("Invalid API key"),
    );
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);
    await user.click(screen.getByRole("button", { name: /^Test$/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Invalid API key",
        expect.objectContaining({ duration: Infinity }),
      );
    });
  });

  it("auto-saves when prompt suggestions toggle is changed", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    const promptSuggestionsSwitch = screen.getByRole("switch", {
      name: /Prompt suggestions/i,
    });
    await user.click(promptSuggestionsSwitch);

    const { updateUserSettings } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({ refine_prompt_suggestions: false }),
      );
    });
  });

  it("auto-saves on API key blur", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    const apiKeyInput = screen.getByPlaceholderText("sk-ant-...");
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, "sk-ant-new-key");
    await user.tab(); // blur the input

    const { updateUserSettings } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          model_settings: expect.objectContaining({
            api_key: "sk-ant-new-key",
          }),
        }),
      );
    });
    expect(vi.mocked(updateUserSettings).mock.calls[0][0]).not.toHaveProperty(
      "anthropic_api_key",
    );
  });

  it("shows Saved indicator after auto-save", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    const promptSuggestionsSwitch = screen.getByRole("switch", {
      name: /Prompt suggestions/i,
    });
    await user.click(promptSuggestionsSwitch);

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("shows error toast on auto-save failure", async () => {
    const user = userEvent.setup();
    const { toast } = await import("@/lib/toast");
    const { updateUserSettings } = await import("@/lib/tauri");
    setupDefaultMocks(populatedSettings);
    // Override updateUserSettings to fail
    vi.mocked(updateUserSettings).mockRejectedValue("DB error");
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Models/i);

    const promptSuggestionsSwitch = screen.getByRole("switch", {
      name: /Prompt suggestions/i,
    });
    await user.click(promptSuggestionsSwitch);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to save: DB error",
        expect.objectContaining({ duration: Infinity }),
      );
    });
  });

  it("displays the app version from Tauri", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      const matches = screen.getAllByText("v0.1.0");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows fallback version when getVersion fails", async () => {
    const { mockGetVersion } = await import("@/test/mocks/tauri");
    mockGetVersion.mockRejectedValueOnce(new Error("not available"));
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      const matches = screen.getAllByText("vdev");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders Skills Folder row with Browse button in Storage card", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

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
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("/home/user/my-skills")).toBeInTheDocument();
  });

  it("does not render workspace folder controls in Storage card", async () => {
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.queryByText("Workspace Folder")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Clear/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render Clear button when workspace path is not set", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(
      screen.queryByRole("button", { name: /Clear/i }),
    ).not.toBeInTheDocument();
  });

  it("includes skills_path in auto-save payload when browsing", async () => {
    const user = userEvent.setup();
    setupDefaultMocks({ ...populatedSettings, skills_path: "/output" });
    vi.mocked(mockOpen).mockResolvedValueOnce("/new/skills/path");
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    const { updateUserSettings } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({ skills_path: "/new/skills/path" }),
      );
    });
  });

  it("normalizes duplicate last segment from browse dialog", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    // Simulate macOS dialog returning a doubled path
    vi.mocked(mockOpen).mockResolvedValueOnce("/Users/me/Skills/Skills");
    renderWithQueryClient(<SettingsPage />);

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
    vi.mocked(mockOpen).mockResolvedValueOnce(
      "C:\\Users\\me\\Skill Builder\\Skill Builder\\",
    );
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    await user.click(browseButton);

    const { updateUserSettings } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(
        screen.getByText("C:\\Users\\me\\Skill Builder"),
      ).toBeInTheDocument();
      expect(updateUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          skills_path: "C:\\Users\\me\\Skill Builder",
        }),
      );
    });
  });

  it("strips trailing slash from browse dialog path", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    vi.mocked(mockOpen).mockResolvedValueOnce("/Users/me/Skills/");
    renderWithQueryClient(<SettingsPage />);

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
    renderWithQueryClient(<SettingsPage />);

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
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Data Directory")).toBeInTheDocument();
    expect(
      screen.getByText(
        "/Users/test/Library/Application Support/com.skill-builder.app",
      ),
    ).toBeInTheDocument();
  });

  it("shows 'Unknown' when get_data_dir fails", async () => {
    const { getDataDir } = await import("@/lib/tauri");
    vi.mocked(getDataDir).mockRejectedValueOnce(new Error("no dir"));
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders Log Level select in Logging card", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Logging")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Log Level/i }),
    ).toBeInTheDocument();
  });

  it("calls set_log_level when log level is changed", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const select = screen.getByRole("combobox", { name: /Log Level/i });
    await user.selectOptions(select, "debug");

    const { setLogLevel } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(setLogLevel).toHaveBeenCalledWith("debug");
    });
  });

  it("auto-saves log_level when log level select is changed", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(populatedSettings);
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    const select = screen.getByRole("combobox", { name: /Log Level/i });
    await user.selectOptions(select, "debug");

    const { updateUserSettings } = await import("@/lib/tauri");
    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({ log_level: "debug" }),
      );
    });
  });

  it("renders logging helper text in Logging card", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.getByText("Logging")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Chat transcripts \(JSONL\) are always captured regardless of level\./i,
      ),
    ).toBeInTheDocument();
  });

  it("does not show a log file path fallback message", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Advanced/i);

    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
  });

  it("renders Appearance card with theme buttons", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

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
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("shows sign in button when not logged in", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/GitHub/i);

    expect(screen.getByText("GitHub Account")).toBeInTheDocument();
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Sign in with GitHub/i }),
    ).toBeInTheDocument();
  });

  it("shows checking state while auth status is loading", async () => {
    vi.mocked(_githubGetUser).mockReturnValue(new Promise(() => {}));
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/GitHub/i);

    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(
      screen.getByText("Checking GitHub connection..."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sign in with GitHub/i }),
    ).not.toBeInTheDocument();
  });

  it("shows user info when logged in", async () => {
    vi.mocked(_githubGetUser).mockResolvedValue({
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      email: "octocat@github.com",
    });
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/GitHub/i);

    expect(screen.getByText("GitHub Account")).toBeInTheDocument();
    expect(screen.getByText("@octocat")).toBeInTheDocument();
    expect(screen.getByText("octocat@github.com")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/Last checked/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sign Out/i }),
    ).toBeInTheDocument();
    // Should NOT show "Not connected"
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
  });

  it("auto-switches to skills section when pendingUpgradeOpen is set", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("skills-page")).not.toBeInTheDocument();

    act(() => {
      useSettingsStore
        .getState()
        .setPendingUpgradeOpen({ skills: ["my-skill"] });
    });

    await waitFor(() => {
      expect(screen.getByTestId("skills-page")).toBeInTheDocument();
    });
  });

  it("shows Registries section in Marketplace tab", async () => {
    setupDefaultMocks();
    renderWithQueryClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    await switchToSection(/Marketplace/i);

    expect(screen.getByText("Registries")).toBeInTheDocument();
  });
});
