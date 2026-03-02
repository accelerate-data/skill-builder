import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import { Loader2, Eye, EyeOff, CheckCircle2, XCircle, PlugZap, FolderOpen, FolderSearch, Trash2, FileText, Github, LogOut, Monitor, Sun, Moon, Info, ArrowLeft, Plus } from "lucide-react"
import { useTheme } from "next-themes"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { AppSettings, MarketplaceRegistry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useSettingsStore, type ModelInfo } from "@/stores/settings-store"
import { useAuthStore } from "@/stores/auth-store"
import { getDataDir, checkMarketplaceUrl, parseGitHubUrl } from "@/lib/tauri"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { GitHubLoginDialog } from "@/components/github-login-dialog"
import { AboutDialog } from "@/components/about-dialog"
import { FeedbackDialog } from "@/components/feedback-dialog"
import { SkillsLibraryTab } from "@/components/skills-library-tab"

/** Must match DEFAULT_MARKETPLACE_URL in app/src-tauri/src/commands/settings.rs */
const DEFAULT_MARKETPLACE_URL = "hbanerjee74/skills"

const sections = [
  { id: "general", label: "General" },
  { id: "marketplace", label: "Marketplace" },
  { id: "skill-building", label: "Skill Building" },
  { id: "skills", label: "Skills" },
  { id: "github", label: "GitHub" },
  { id: "advanced", label: "Advanced" },
] as const

type SectionId = typeof sections[number]["id"]

type RegistryTestState = "checking" | "valid" | "invalid" | undefined

function RegistryTestIcon({ state }: { state: RegistryTestState }) {
  if (state === "checking") return <Loader2 className="size-3.5 animate-spin" />
  if (state === "valid") return <CheckCircle2 className="size-3.5" style={{ color: "var(--color-seafoam)" }} />
  if (state === "invalid") return <XCircle className="size-3.5 text-destructive" />
  return <PlugZap className="size-3.5" />
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SectionId>("general")
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [skillsPath, setSkillsPath] = useState<string | null>(null)
  const [preferredModel, setPreferredModel] = useState<string>("sonnet")
  const [logLevel, setLogLevel] = useState("info")
  const [extendedThinking, setExtendedThinking] = useState(false)
  const [maxDimensions, setMaxDimensions] = useState(5)
  const [industry, setIndustry] = useState("")
  const [functionRole, setFunctionRole] = useState("")
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [appVersion, setAppVersion] = useState<string>("dev")
  const [dataDir, setDataDir] = useState<string | null>(null)
  const [logFilePath, setLogFilePath] = useState<string | null>(null)
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(false)
  const setStoreSettings = useSettingsStore((s) => s.setSettings)
  const marketplaceRegistries = useSettingsStore((s) => s.marketplaceRegistries)
  const [addingRegistry, setAddingRegistry] = useState(false)
  const [newRegistryUrl, setNewRegistryUrl] = useState("")
  const [newRegistryAdding, setNewRegistryAdding] = useState(false)
  const [registryTestState, setRegistryTestState] = useState<Record<string, "checking" | "valid" | "invalid">>({})

  const availableModels = useSettingsStore((s) => s.availableModels)
  const pendingUpgrade = useSettingsStore((s) => s.pendingUpgradeOpen)
  const { user, isLoggedIn, logout } = useAuthStore()

  // Auto-navigate to the skills section when a pending upgrade targets settings-skills
  useEffect(() => {
    if (pendingUpgrade?.mode === "settings-skills") {
      setActiveSection("skills")
    }
  }, [pendingUpgrade])
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await invoke<AppSettings>("get_settings")
          if (!cancelled) {
            setApiKey(result.anthropic_api_key)
            setWorkspacePath(result.workspace_path)
            setSkillsPath(result.skills_path)
            setPreferredModel(result.preferred_model || "sonnet")
            setLogLevel(result.log_level ?? "info")
            setExtendedThinking(result.extended_thinking ?? false)
            setMaxDimensions(result.max_dimensions ?? 5)
            setIndustry(result.industry ?? "")
            setFunctionRole(result.function_role ?? "")
            setAutoUpdate(result.auto_update ?? false)
            setStoreSettings({ marketplaceRegistries: result.marketplace_registries ?? [], marketplaceInitialized: result.marketplace_initialized ?? false })
            setLoading(false)
            // Fetch available models once we have an API key
            if (result.anthropic_api_key) {
              fetchModels(result.anthropic_api_key)
            }
          }
          return
        } catch (err) {
          console.error(`Failed to load settings (attempt ${attempt}/3):`, err)
          if (attempt < 3) await new Promise((r) => setTimeout(r, 500))
        }
      }
      // All retries exhausted
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion("dev"))
  }, [])

  useEffect(() => {
    getDataDir()
      .then((dir) => setDataDir(dir))
      .catch(() => setDataDir(null))
  }, [])

  useEffect(() => {
    invoke<string>("get_log_file_path")
      .then(setLogFilePath)
      .catch(() => setLogFilePath(null))
  }, [])

  const fetchModels = async (key: string) => {
    try {
      const models = await invoke<ModelInfo[]>("list_models", { apiKey: key })
      setStoreSettings({ availableModels: models ?? [] })
      // If current preferredModel is a shorthand not in the list, keep it (resolve_model_id handles it)
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
      toast.error(`Failed to save: ${err}`, { duration: Infinity })
    }
  }

  const handleTestApiKey = async () => {
    if (!apiKey) {
      toast.error("Enter an API key first", { duration: Infinity })
      return
    }
    setTesting(true)
    setApiKeyValid(null)
    try {
      await invoke("test_api_key", { apiKey })
      setApiKeyValid(true)
      toast.success("API key is valid")
      fetchModels(apiKey)
    } catch (err) {
      console.error("settings: API key test failed", err)
      setApiKeyValid(false)
      toast.error(
        err instanceof Error ? err.message : String(err),
        { duration: Infinity },
      )
    } finally {
      setTesting(false)
    }
  }

  const handleBrowseSkillsPath = async () => {
    const folder = await open({ directory: true, title: "Select Skills Folder" })
    if (folder) {
      // Normalize: remove trailing slashes, then check for duplicate last segment
      // (macOS file picker can return doubled paths like /foo/Skills/Skills)
      let normalized = folder.replace(/\/+$/, '')
      const parts = normalized.split('/')
      if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
        normalized = parts.slice(0, -1).join('/')
      }
      setSkillsPath(normalized)
      autoSave({ skillsPath: normalized })
    }
  }

  const handleClearWorkspace = async () => {
    if (!window.confirm("This will reset the bundled agent files in your workspace. Your imported skills, CLAUDE.md, and workflow data will not be affected.\n\nAre you sure?")) {
      return
    }
    setClearing(true)
    try {
      await invoke("clear_workspace")
      toast.success("Workspace cleared", { duration: 1500 })
    } catch (err) {
      console.error("settings: clear workspace failed", err)
      toast.error(`Failed to clear workspace: ${err instanceof Error ? err.message : String(err)}`, { duration: Infinity })
    } finally {
      setClearing(false)
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

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
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
          <div className="space-y-6 p-6">
            <Card>
              <CardHeader>
                <CardTitle>API Configuration</CardTitle>
                <CardDescription>
                  Configure your Anthropic API key for skill building.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="api-key">Anthropic API Key</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="api-key"
                        type={showApiKey ? "text" : "password"}
                        placeholder="sk-ant-..."
                        value={apiKey || ""}
                        onChange={(e) => setApiKey(e.target.value || null)}
                        onBlur={(e) => autoSave({ apiKey: e.target.value || null })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? (
                          <EyeOff className="size-3.5" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                      </Button>
                    </div>
                    <Button
                      variant={apiKeyValid ? "default" : "outline"}
                      size="sm"
                      onClick={handleTestApiKey}
                      disabled={testing || !apiKey}
                      className={apiKeyValid ? "text-white" : ""}
                      style={apiKeyValid ? { background: "var(--color-seafoam)", color: "white" } : undefined}
                    >
                      {testing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : apiKeyValid ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : null}
                      {apiKeyValid ? "Valid" : "Test"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Profile</CardTitle>
                <CardDescription>
                  Optional context about you and your work. Agents use this to tailor research and skill content.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="industry">Industry</Label>
                  <Input
                    id="industry"
                    placeholder="e.g., Financial Services, Healthcare, Retail"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    onBlur={() => autoSave({ industry: industry || null })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="function-role">Function / Role</Label>
                  <Input
                    id="function-role"
                    placeholder="e.g., Analytics Engineer, Data Platform Lead"
                    value={functionRole}
                    onChange={(e) => setFunctionRole(e.target.value)}
                    onBlur={() => autoSave({ functionRole: functionRole || null })}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Choose a theme for the application.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 rounded-md bg-muted p-1">
                  {([
                    { value: "system", icon: Monitor, label: "System" },
                    { value: "light", icon: Sun, label: "Light" },
                    { value: "dark", icon: Moon, label: "Dark" },
                  ] as const).map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                        theme === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="size-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          )}

          {activeSection === "skill-building" && (
          <div className="space-y-6 p-6">
            <Card>
              <CardHeader>
                <CardTitle>Model</CardTitle>
                <CardDescription>
                  The Claude model used for all agents — skill building, refining, and testing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <select
                    value={preferredModel}
                    onChange={(e) => { setPreferredModel(e.target.value); autoSave({ preferredModel: e.target.value }); }}
                    className="flex h-9 w-64 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {availableModels.length > 0
                      ? availableModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.displayName}</option>
                        ))
                      : (
                        <>
                          <option value="haiku">Haiku — fastest, lowest cost</option>
                          <option value="sonnet">Sonnet — balanced (default)</option>
                          <option value="opus">Opus — most capable</option>
                        </>
                      )
                    }
                  </select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Agent Features</CardTitle>
                <CardDescription>
                  Configure agent capabilities for skill building.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="extended-thinking">Extended thinking (deeper reasoning)</Label>
                    <span className="text-sm text-muted-foreground">Enable deeper reasoning for agents. Increases cost by ~$1-2 per skill build.</span>
                  </div>
                  <Switch
                    id="extended-thinking"
                    checked={extendedThinking}
                    onCheckedChange={(checked) => { setExtendedThinking(checked); autoSave({ extendedThinking: checked }); }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Research Scope Limit</CardTitle>
                <CardDescription>
                  Maximum number of research dimensions before suggesting narrower skills. Lower values produce more focused skills.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Label htmlFor="max-dimensions">Max dimensions</Label>
                  <Input
                    id="max-dimensions"
                    type="number"
                    min={1}
                    max={18}
                    value={maxDimensions}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(18, parseInt(e.target.value) || 5))
                      setMaxDimensions(val)
                    }}
                    onBlur={() => autoSave({ maxDimensions })}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">
                    {maxDimensions <= 3 ? "Narrow focus" : maxDimensions <= 5 ? "Balanced (default)" : maxDimensions <= 8 ? "Broad research" : "Very broad"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
          )}

          {activeSection === "skills" && (
          <div className="space-y-6 p-6">
            <SkillsLibraryTab />
          </div>
          )}

          {activeSection === "github" && (
          <div className="space-y-6 p-6">
            <Card>
              <CardHeader>
                <CardTitle>GitHub Account</CardTitle>
                <CardDescription>
                  Connect your GitHub account to submit feedback and report issues.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {isLoggedIn && user ? (
                  <>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user.avatar_url} alt={user.login} />
                        <AvatarFallback>{user.login[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">@{user.login}</span>
                        {user.email && (
                          <span className="text-sm text-muted-foreground">{user.email}</span>
                        )}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="w-fit" onClick={logout}>
                      <LogOut className="size-4" />
                      Sign Out
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Not connected</p>
                    <Button variant="outline" size="sm" className="w-fit" onClick={() => setLoginDialogOpen(true)}>
                      <Github className="size-4" />
                      Sign in with GitHub
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

          </div>
          )}

          {activeSection === "marketplace" && (
          <div className="space-y-6 p-6">
            <Card>
              <CardHeader>
                <CardTitle>Registries</CardTitle>
                <CardDescription>
                  GitHub repositories to browse for marketplace skills. The Vibedata Skills registry is built-in and cannot be removed.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-md border">
                  <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                    <span className="flex-1">Registry</span>
                    <span className="w-16">Enabled</span>
                    <span className="w-16" />
                  </div>
                  {marketplaceRegistries.map((registry) => {
                    const isDefault = registry.source_url === DEFAULT_MARKETPLACE_URL
                    const testState = registryTestState[registry.source_url]
                    const isFailed = testState === "invalid"
                    return (
                      <div
                        key={registry.source_url}
                        className={cn(
                          "flex items-center gap-4 border-b last:border-b-0 px-4 py-2 hover:bg-muted/30 transition-colors",
                          isFailed && "opacity-60"
                        )}
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="truncate text-sm font-mono text-muted-foreground">{registry.source_url}</span>
                          {isDefault && (
                            <Badge variant="secondary" className="text-xs shrink-0">Built-in</Badge>
                          )}
                        </div>
                        <div className="w-16 shrink-0 flex items-center gap-2">
                          <Switch
                            checked={registry.enabled && !isFailed}
                            disabled={isFailed}
                            onCheckedChange={(checked) => {
                              console.log(`[settings] registry toggled: url=${registry.source_url}, enabled=${checked}`)
                              const current = useSettingsStore.getState().marketplaceRegistries
                              const updated = current.map(r =>
                                r.source_url === registry.source_url ? { ...r, enabled: checked } : r
                              )
                              autoSave({ marketplaceRegistries: updated })
                            }}
                            aria-label={`Toggle ${registry.source_url}`}
                          />
                        </div>
                        <div className="w-16 shrink-0 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={`Test ${registry.source_url}`}
                            title="Check marketplace.json is reachable"
                            disabled={testState === "checking"}
                            onClick={async () => {
                              setRegistryTestState((s) => ({ ...s, [registry.source_url]: "checking" }))
                              try {
                                await checkMarketplaceUrl(registry.source_url)
                                setRegistryTestState((s) => ({ ...s, [registry.source_url]: "valid" }))
                              } catch (err) {
                                console.error(`[settings] registry test failed for ${registry.source_url}:`, err)
                                setRegistryTestState((s) => ({ ...s, [registry.source_url]: "invalid" }))
                              }
                            }}
                          >
                            <RegistryTestIcon state={testState} />
                          </button>
                          {!isDefault && (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              aria-label={`Remove ${registry.name}`}
                              onClick={() => {
                                console.log(`[settings] registry removed: name=${registry.name}`)
                                const current = useSettingsStore.getState().marketplaceRegistries
                                const updated = current.filter(r => r.source_url !== registry.source_url)
                                autoSave({ marketplaceRegistries: updated })
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {!addingRegistry ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setAddingRegistry(true)}
                  >
                    <Plus className="size-4" />
                    Add registry
                  </Button>
                ) : (
                  <div className="flex flex-col gap-3 rounded-md border p-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="new-registry-url">GitHub repository</Label>
                      <Input
                        id="new-registry-url"
                        placeholder="owner/repo or owner/repo#branch"
                        value={newRegistryUrl}
                        onChange={(e) => setNewRegistryUrl(e.target.value)}
                      />
                      {newRegistryUrl.trim() && marketplaceRegistries.some(r => r.source_url === newRegistryUrl.trim()) && (
                        <p className="text-xs text-destructive">This registry is already added.</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={
                          !newRegistryUrl.trim() ||
                          newRegistryAdding ||
                          marketplaceRegistries.some(r => r.source_url === newRegistryUrl.trim())
                        }
                        onClick={async () => {
                          const url = newRegistryUrl.trim()
                          setNewRegistryAdding(true)

                          // Parse and normalize to canonical shorthand (owner/repo or owner/repo#branch)
                          let info: Awaited<ReturnType<typeof parseGitHubUrl>>
                          try {
                            info = await parseGitHubUrl(url)
                          } catch {
                            toast.error("Invalid GitHub repository format — use owner/repo or owner/repo#branch.")
                            setNewRegistryAdding(false)
                            return
                          }
                          const canonicalUrl = info.branch === "main"
                            ? `${info.owner}/${info.repo}`
                            : `${info.owner}/${info.repo}#${info.branch}`

                          // Block duplicates: same owner/repo regardless of format or branch
                          const isDuplicate = marketplaceRegistries.some(r => {
                            const m = r.source_url.match(/^([^/]+)\/([^/#]+)/)
                            return m && m[1] === info.owner && m[2] === info.repo
                          })
                          if (isDuplicate) {
                            toast.error(`${info.owner}/${info.repo} is already in your registries.`)
                            setNewRegistryAdding(false)
                            return
                          }

                          let name: string
                          try {
                            name = await checkMarketplaceUrl(url)
                          } catch (err) {
                            console.error(`[settings] add registry check failed for ${url}:`, err)
                            setNewRegistryAdding(false)
                            toast.error("Could not reach marketplace.json — check it is a public GitHub repository with a .claude-plugin/marketplace.json file.", { duration: Infinity })
                            return
                          }
                          console.log(`[settings] registry added: name=${name}, url=${canonicalUrl}`)
                          const entry: MarketplaceRegistry = {
                            name,
                            source_url: canonicalUrl,
                            enabled: true,
                          }
                          autoSave({ marketplaceRegistries: [...marketplaceRegistries, entry] })
                          setNewRegistryUrl("")
                          setNewRegistryAdding(false)
                          setAddingRegistry(false)
                        }}
                      >
                        {newRegistryAdding ? <Loader2 className="size-3.5 animate-spin" /> : "Add"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNewRegistryUrl("")
                          setNewRegistryAdding(false)
                          setAddingRegistry(false)
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Auto-update</CardTitle>
                <CardDescription>
                  Automatically apply updates from all enabled registries at startup.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Switch
                  id="auto-update"
                  checked={autoUpdate}
                  onCheckedChange={(checked) => { setAutoUpdate(checked); autoSave({ autoUpdate: checked }); }}
                  aria-label="Enable auto-update"
                />
              </CardContent>
            </Card>
          </div>
          )}

          {activeSection === "advanced" && (
          <div className="space-y-6 p-6">
            <Card>
              <CardHeader>
                <CardTitle>Logging</CardTitle>
                <CardDescription>
                  Configure application logging. Chat transcripts (JSONL) are always captured regardless of level.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="log-level-select">Log Level</Label>
                  <div className="flex items-center gap-3">
                    <select
                      id="log-level-select"
                      value={logLevel}
                      onChange={(e) => {
                        setLogLevel(e.target.value)
                        autoSave({ logLevel: e.target.value })
                        invoke("set_log_level", { level: e.target.value }).catch(() => {})
                      }}
                      className="flex h-9 w-fit rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="error">Error</option>
                      <option value="warn">Warn</option>
                      <option value="info">Info</option>
                      <option value="debug">Debug</option>
                    </select>
                    <span className="text-sm text-muted-foreground">
                      {{ error: "Only errors", warn: "Errors + warnings", info: "Errors + warnings + lifecycle (default)", debug: "Everything (verbose)" }[logLevel]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <code className="text-sm text-muted-foreground flex-1">
                    {logFilePath || "Not available"}
                  </code>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Storage</CardTitle>
                <CardDescription>
                  Manage application directories.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Skills Folder</Label>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-4 text-muted-foreground" />
                    <code className="text-sm text-muted-foreground flex-1">
                      {skillsPath || "Not configured"}
                    </code>
                    <Button variant="outline" size="sm" onClick={handleBrowseSkillsPath}>
                      <FolderSearch className="size-4" />
                      Browse
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Workspace Folder</Label>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-4 text-muted-foreground" />
                    <code className="text-sm text-muted-foreground flex-1">
                      {workspacePath || "Not initialized"}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearWorkspace}
                      disabled={clearing || !workspacePath}
                      className="text-destructive hover:text-destructive"
                    >
                      {clearing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Data Directory</Label>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-4 text-muted-foreground" />
                    <code className="text-sm text-muted-foreground flex-1">
                      {dataDir || "Unknown"}
                    </code>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>About</CardTitle>
                <CardDescription>
                  Skill Builder v{appVersion}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" onClick={() => setAboutDialogOpen(true)}>
                  <Info className="size-4" />
                  About Skill Builder
                </Button>
              </CardContent>
            </Card>
          </div>
          )}
        </div>
      </div>

      )}

      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
      <GitHubLoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </div>
  )
}
