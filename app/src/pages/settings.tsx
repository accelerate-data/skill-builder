import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import { Loader2, Eye, EyeOff, CheckCircle2, XCircle, FolderOpen, FolderSearch, Trash2, FileText, Github, LogOut, Monitor, Sun, Moon, Info, ArrowLeft } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { AppSettings } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useSettingsStore, type ModelInfo } from "@/stores/settings-store"
import { useAuthStore } from "@/stores/auth-store"
import { getDataDir, checkMarketplaceUrl } from "@/lib/tauri"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { GitHubLoginDialog } from "@/components/github-login-dialog"
import { AboutDialog } from "@/components/about-dialog"
import { FeedbackDialog } from "@/components/feedback-dialog"
import { SkillsLibraryTab } from "@/components/skills-library-tab"

const sections = [
  { id: "general", label: "General" },
  { id: "skill-building", label: "Skill Building" },
  { id: "skills", label: "Skills" },
  { id: "github", label: "GitHub" },
  { id: "advanced", label: "Advanced" },
] as const

type SectionId = typeof sections[number]["id"]

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
  const [marketplaceUrl, setMarketplaceUrl] = useState("")
  const [marketplaceTesting, setMarketplaceTesting] = useState(false)
  const [marketplaceValid, setMarketplaceValid] = useState<boolean | null>(null)
  const [urlCheckState, setUrlCheckState] = useState<"idle" | "checking" | "valid" | "invalid">("idle")
  const [autoUpdate, setAutoUpdate] = useState(false)
  const setStoreSettings = useSettingsStore((s) => s.setSettings)
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
            setMarketplaceUrl(result.marketplace_url ?? "")
            setAutoUpdate(result.auto_update ?? false)
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
    marketplaceUrl: string | null;
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
      marketplace_url: overrides.marketplaceUrl !== undefined ? overrides.marketplaceUrl : (useSettingsStore.getState().marketplaceUrl ?? null),
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
        marketplaceUrl: settings.marketplace_url,
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

  const handleTestMarketplace = async () => {
    setMarketplaceTesting(true)
    setMarketplaceValid(null)
    setUrlCheckState("checking")
    try {
      await checkMarketplaceUrl(marketplaceUrl.trim())
      setMarketplaceValid(true)
      setUrlCheckState("valid")
      toast.success("Marketplace is accessible")
    } catch (err) {
      console.error("settings: marketplace test failed", err)
      setMarketplaceValid(false)
      setUrlCheckState("invalid")
      toast.error(
        `Cannot access marketplace: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      )
    } finally {
      setMarketplaceTesting(false)
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
            <span className="flex items-center gap-1 text-sm text-green-600 animate-in fade-in duration-200">
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
                      className={apiKeyValid ? "bg-green-600 hover:bg-green-700 text-white" : ""}
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

            <Card>
              <CardHeader>
                <CardTitle>Marketplace URL</CardTitle>
                <CardDescription>
                  GitHub repository URL for importing skills from a shared marketplace. Example: https://github.com/your-org/skill-library
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="marketplace-url">Repository URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="marketplace-url"
                      placeholder="https://github.com/owner/skill-library"
                      value={marketplaceUrl}
                      onChange={(e) => {
                        setMarketplaceUrl(e.target.value)
                        setMarketplaceValid(null)
                        setUrlCheckState("idle")
                      }}
                      onBlur={(e) => autoSave({ marketplaceUrl: e.target.value.trim() || null })}
                      className="text-sm"
                    />
                    {marketplaceUrl && (
                      <Button
                        variant={marketplaceValid ? "default" : "outline"}
                        size="sm"
                        onClick={handleTestMarketplace}
                        disabled={marketplaceTesting}
                        className={marketplaceValid ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                      >
                        {marketplaceTesting ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : marketplaceValid ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : null}
                        {marketplaceValid ? "Valid" : "Test"}
                      </Button>
                    )}
                    {urlCheckState === "checking" && <Loader2 className="size-4 animate-spin text-muted-foreground self-center" />}
                    {urlCheckState === "valid" && <CheckCircle2 className="size-4 text-green-500 self-center" />}
                    {urlCheckState === "invalid" && <XCircle className="size-4 text-destructive self-center" />}
                  </div>
                  {marketplaceValid === false && (
                    <p className="text-xs text-destructive">
                      Could not reach this URL. Check it is a public GitHub repository.
                    </p>
                  )}
                </div>
                {marketplaceUrl && (
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="auto-update">Auto-update</Label>
                      <span className="text-sm text-muted-foreground">Automatically apply marketplace updates at startup.</span>
                    </div>
                    <Switch
                      id="auto-update"
                      checked={autoUpdate}
                      onCheckedChange={(checked) => { setAutoUpdate(checked); autoSave({ autoUpdate: checked }); }}
                    />
                  </div>
                )}
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
