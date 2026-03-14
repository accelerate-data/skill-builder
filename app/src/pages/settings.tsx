import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { toast } from "@/lib/toast"
import { CheckCircle2, ArrowLeft } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import type { AppSettings, MarketplaceRegistry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useSettingsStore, type ModelInfo } from "@/stores/settings-store"
import { GitHubLoginDialog } from "@/components/github-login-dialog"
import { AboutDialog } from "@/components/about-dialog"
import { FeedbackDialog } from "@/components/feedback-dialog"
import { ImportedSkillsTab } from "@/components/imported-skills-tab"
import { GeneralSection } from "@/components/settings/general-section"
import { SdkSection } from "@/components/settings/sdk-section"
import { MarketplaceSection } from "@/components/settings/marketplace-section"
import { GitHubSection } from "@/components/settings/github-section"
import { AdvancedSection } from "@/components/settings/advanced-section"

const sections = [
  { id: "general", label: "General" },
  { id: "skill-building", label: "Claude SDK" },
  { id: "skills", label: "Import" },
  { id: "marketplace", label: "Marketplace" },
  { id: "github", label: "GitHub" },
  { id: "advanced", label: "Advanced" },
] as const

type SectionId = typeof sections[number]["id"]

export default function SettingsPage() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SectionId>("general")
  const [apiKey, setApiKey] = useState<string | null>(useSettingsStore.getState().anthropicApiKey ?? null)
  const workspacePath = useSettingsStore.getState().workspacePath ?? null
  const [skillsPath, setSkillsPath] = useState<string | null>(useSettingsStore.getState().skillsPath ?? null)
  const [preferredModel, setPreferredModel] = useState<string>(useSettingsStore.getState().preferredModel ?? "")
  const [logLevel, setLogLevel] = useState(useSettingsStore.getState().logLevel ?? "info")
  const [extendedThinking, setExtendedThinking] = useState(useSettingsStore.getState().extendedThinking ?? false)
  const [interleavedThinkingBeta, setInterleavedThinkingBeta] = useState(useSettingsStore.getState().interleavedThinkingBeta ?? true)
  const [sdkEffort, setSdkEffort] = useState<string>(useSettingsStore.getState().sdkEffort ?? "")
  const [refinePromptSuggestions, setRefinePromptSuggestions] = useState(useSettingsStore.getState().refinePromptSuggestions ?? true)
  const [maxDimensions, setMaxDimensions] = useState(useSettingsStore.getState().maxDimensions ?? 5)
  const [industry, setIndustry] = useState(useSettingsStore.getState().industry ?? "")
  const [functionRole, setFunctionRole] = useState(useSettingsStore.getState().functionRole ?? "")
  const [saved, setSaved] = useState(false)
  const [appVersion, setAppVersion] = useState<string>("dev")
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(useSettingsStore.getState().autoUpdate ?? false)
  const setStoreSettings = useSettingsStore((s) => s.setSettings)
  const pendingUpgrade = useSettingsStore((s) => s.pendingUpgradeOpen)

  // Auto-navigate to the skills section when a pending upgrade is set
  useEffect(() => {
    if (pendingUpgrade) {
      setActiveSection("skills")
    }
  }, [pendingUpgrade])

  useEffect(() => {
    // Fetch available models once (if we have an API key)
    const key = apiKey || useSettingsStore.getState().anthropicApiKey
    if (key) {
      fetchModels(key)
    }
  }, [])

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion("dev"))
  }, [])

  const fetchModels = async (key: string) => {
    try {
      const models = await invoke<ModelInfo[]>("list_models", { apiKey: key })
      setStoreSettings({ availableModels: models ?? [] })
    } catch (err) {
      console.warn("[settings] Could not fetch model list:", err)
    }
  }

  const autoSave = async (overrides: Partial<{
    apiKey: string | null;
    skillsPath: string | null;
    preferredModel: string;
    logLevel: string;
    extendedThinking: boolean;
    interleavedThinkingBeta: boolean;
    sdkEffort: string | null;
    refinePromptSuggestions: boolean;
    maxDimensions: number;
    marketplaceRegistries?: MarketplaceRegistry[];
    industry: string | null;
    functionRole: string | null;
    autoUpdate: boolean;
  }>) => {
    const settings: AppSettings = {
      anthropic_api_key: overrides.apiKey !== undefined ? overrides.apiKey : apiKey,
      workspace_path: workspacePath,
      skills_path: overrides.skillsPath !== undefined ? overrides.skillsPath : skillsPath,
      preferred_model: overrides.preferredModel !== undefined ? overrides.preferredModel : preferredModel,
      log_level: overrides.logLevel !== undefined ? overrides.logLevel : logLevel,
      extended_context: false,
      extended_thinking: overrides.extendedThinking !== undefined ? overrides.extendedThinking : extendedThinking,
      interleaved_thinking_beta: overrides.interleavedThinkingBeta !== undefined ? overrides.interleavedThinkingBeta : interleavedThinkingBeta,
      sdk_effort: overrides.sdkEffort !== undefined ? overrides.sdkEffort : (sdkEffort || null),
      // Fallback model follows the selected Skill Building model.
      fallback_model: overrides.preferredModel !== undefined ? overrides.preferredModel : preferredModel,
      refine_prompt_suggestions: overrides.refinePromptSuggestions !== undefined ? overrides.refinePromptSuggestions : refinePromptSuggestions,
      max_dimensions: overrides.maxDimensions !== undefined ? overrides.maxDimensions : maxDimensions,
      splash_shown: false,
      // Preserve OAuth fields — these are managed by the auth flow, not settings
      github_oauth_token: useSettingsStore.getState().githubOauthToken ?? null,
      github_user_login: useSettingsStore.getState().githubUserLogin ?? null,
      github_user_avatar: useSettingsStore.getState().githubUserAvatar ?? null,
      github_user_email: useSettingsStore.getState().githubUserEmail ?? null,
      marketplace_registries: overrides.marketplaceRegistries !== undefined ? overrides.marketplaceRegistries : (useSettingsStore.getState().marketplaceRegistries ?? []),
      marketplace_initialized: useSettingsStore.getState().marketplaceInitialized ?? false,
      industry: overrides.industry !== undefined ? overrides.industry : (industry || null),
      function_role: overrides.functionRole !== undefined ? overrides.functionRole : (functionRole || null),
      dashboard_view_mode: useSettingsStore.getState().dashboardViewMode ?? null,
      auto_update: overrides.autoUpdate !== undefined ? overrides.autoUpdate : autoUpdate,
    }
    try {
      await invoke("save_settings", { settings })
      // Sync Zustand store so other pages see updated settings
      setStoreSettings({
        anthropicApiKey: settings.anthropic_api_key,
        workspacePath: settings.workspace_path,
        skillsPath: settings.skills_path,
        preferredModel: settings.preferred_model,
        logLevel: settings.log_level,
        extendedThinking: settings.extended_thinking,
        interleavedThinkingBeta: settings.interleaved_thinking_beta,
        sdkEffort: settings.sdk_effort,
        refinePromptSuggestions: settings.refine_prompt_suggestions,
        maxDimensions: settings.max_dimensions,
        marketplaceRegistries: settings.marketplace_registries,
        industry: settings.industry,
        functionRole: settings.function_role,
        autoUpdate: settings.auto_update,
      })
      const changed = Object.entries(overrides)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
      console.log(`[settings] Saved: ${changed}`)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error("settings: auto-save failed", err)
      toast.error(`Failed to save: ${err}`, {
        duration: Infinity,
        cause: err,
        context: { operation: "settings_auto_save" },
      })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate({ to: "/" })}
            title="Back to Dashboard"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">Settings</h1>
          <span className="text-sm text-muted-foreground">v{appVersion}</span>
          {saved && (
            <span className="flex items-center gap-1 text-sm animate-in fade-in duration-200" style={{ color: "var(--color-seafoam)" }}>
              <CheckCircle2 className="size-3.5" />
              Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FeedbackDialog />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-48 shrink-0 flex-col space-y-1 overflow-y-auto border-r p-4">
          {sections.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors text-left",
                activeSection === id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          {activeSection === "general" && (
            <GeneralSection
              industry={industry}
              setIndustry={setIndustry}
              functionRole={functionRole}
              setFunctionRole={setFunctionRole}
              appVersion={appVersion}
              onAboutOpen={() => setAboutDialogOpen(true)}
              autoSave={autoSave}
            />
          )}

          {activeSection === "skill-building" && (
            <SdkSection
              apiKey={apiKey}
              setApiKey={setApiKey}
              preferredModel={preferredModel}
              setPreferredModel={setPreferredModel}
              extendedThinking={extendedThinking}
              setExtendedThinking={setExtendedThinking}
              interleavedThinkingBeta={interleavedThinkingBeta}
              setInterleavedThinkingBeta={setInterleavedThinkingBeta}
              sdkEffort={sdkEffort}
              setSdkEffort={setSdkEffort}
              refinePromptSuggestions={refinePromptSuggestions}
              setRefinePromptSuggestions={setRefinePromptSuggestions}
              maxDimensions={maxDimensions}
              setMaxDimensions={setMaxDimensions}
              autoSave={autoSave}
            />
          )}

          {activeSection === "skills" && (
            <div className="space-y-6 p-6">
              <ImportedSkillsTab />
            </div>
          )}

          {activeSection === "marketplace" && (
            <MarketplaceSection
              autoUpdate={autoUpdate}
              setAutoUpdate={setAutoUpdate}
              autoSave={autoSave}
            />
          )}

          {activeSection === "github" && (
            <GitHubSection onLoginOpen={() => setLoginDialogOpen(true)} />
          )}

          {activeSection === "advanced" && (
            <AdvancedSection
              logLevel={logLevel}
              setLogLevel={setLogLevel}
              skillsPath={skillsPath}
              setSkillsPath={setSkillsPath}
              autoSave={autoSave}
            />
          )}
        </div>
      </div>

      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
      <GitHubLoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </div>
  )
}
