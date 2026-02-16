import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { Loader2, Eye, EyeOff, CheckCircle2, ExternalLink, FolderOpen, FolderSearch, Trash2, FileText, Github, LogOut, Monitor, Sun, Moon, Info } from "lucide-react"
import { useTheme } from "next-themes"
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
import { useSettingsStore } from "@/stores/settings-store"
import { useAuthStore } from "@/stores/auth-store"
import { getDataDir } from "@/lib/tauri"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { GitHubLoginDialog } from "@/components/github-login-dialog"
import { AboutDialog } from "@/components/about-dialog"

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [skillsPath, setSkillsPath] = useState<string | null>(null)
  const [preferredModel, setPreferredModel] = useState<string>("sonnet")
  const [logLevel, setLogLevel] = useState("info")
  const [extendedContext, setExtendedContext] = useState(false)
  const [extendedThinking, setExtendedThinking] = useState(false)
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
  const setStoreSettings = useSettingsStore((s) => s.setSettings)
  const { user, isLoggedIn, logout } = useAuthStore()
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
            setExtendedContext(result.extended_context ?? false)
            setExtendedThinking(result.extended_thinking ?? false)
            setLoading(false)
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

  const autoSave = async (overrides: Partial<{
    apiKey: string | null;
    skillsPath: string | null;
    preferredModel: string;
    logLevel: string;
    extendedContext: boolean;
    extendedThinking: boolean;
  }>) => {
    const settings: AppSettings = {
      anthropic_api_key: overrides.apiKey !== undefined ? overrides.apiKey : apiKey,
      workspace_path: workspacePath,
      skills_path: overrides.skillsPath !== undefined ? overrides.skillsPath : skillsPath,
      preferred_model: overrides.preferredModel !== undefined ? overrides.preferredModel : preferredModel,
      log_level: overrides.logLevel !== undefined ? overrides.logLevel : logLevel,
      extended_context: overrides.extendedContext !== undefined ? overrides.extendedContext : extendedContext,
      extended_thinking: overrides.extendedThinking !== undefined ? overrides.extendedThinking : extendedThinking,
      splash_shown: false,
      // Preserve OAuth fields — these are managed by the auth flow, not settings
      github_oauth_token: useSettingsStore.getState().githubOauthToken ?? null,
      github_user_login: useSettingsStore.getState().githubUserLogin ?? null,
      github_user_avatar: useSettingsStore.getState().githubUserAvatar ?? null,
      github_user_email: useSettingsStore.getState().githubUserEmail ?? null,
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
        extendedContext: settings.extended_context,
        extendedThinking: settings.extended_thinking,
      })
      console.log("[settings] Settings saved")
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
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
    } catch (err) {
      setApiKeyValid(false)
      toast.error(
        `Invalid API key: ${err instanceof Error ? err.message : String(err)}`,
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
      toast.error(`Failed to clear workspace: ${err instanceof Error ? err.message : String(err)}`, { duration: Infinity })
    } finally {
      setClearing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <span className="text-sm text-muted-foreground">Skill Builder v{appVersion}</span>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600 animate-in fade-in duration-200">
            <CheckCircle2 className="size-3.5" />
            Saved
          </span>
        )}
      </div>

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
          <CardTitle>Extended Context</CardTitle>
          <CardDescription>
            Enable 1M token context window for all agents. Requires a compatible API plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="extended-context">Extended context (1M tokens)</Label>
            <Switch
              id="extended-context"
              checked={extendedContext}
              onCheckedChange={(checked) => { setExtendedContext(checked); autoSave({ extendedContext: checked }); }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extended Thinking</CardTitle>
          <CardDescription>
            Enable deeper reasoning for agents. Increases cost by ~$1-2 per skill build.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="extended-thinking">Extended thinking (deeper reasoning)</Label>
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

      <Card>
        <CardHeader>
          <CardTitle>Log Level</CardTitle>
          <CardDescription>
            Controls how much detail is written to the app log file.
            Each level includes everything above it: Error &lt; Warn &lt; Info &lt; Debug.
            Chat transcripts (JSONL) are always captured regardless of this setting.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log File</CardTitle>
          <CardDescription>
            Application logs are written here. The log file is recreated each time the app starts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <code className="text-sm text-muted-foreground flex-1">
              {logFilePath || "Not available"}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (logFilePath) {
                  revealItemInDir(logFilePath).catch(() => {
                    toast.error("Failed to open log directory")
                  })
                }
              }}
              disabled={!logFilePath}
            >
              <ExternalLink className="size-4" />
              Open
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skills Folder</CardTitle>
          <CardDescription>
            Persistent folder for finished skill outputs (SKILL.md, references, .skill packages). Not affected by workspace clearing.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace Folder</CardTitle>
          <CardDescription>
            Working files are stored in this directory and is managed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Directory</CardTitle>
          <CardDescription>
            Internal storage for the app database and configuration. Not intended for direct editing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            <code className="text-sm text-muted-foreground flex-1">
              {dataDir || "Unknown"}
            </code>
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

      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
      <GitHubLoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </div>
  )
}
