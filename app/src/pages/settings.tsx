import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import { Loader2, Eye, EyeOff, Save, CheckCircle2, XCircle, ExternalLink, FolderOpen, FolderSearch, Trash2 } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import type { AppSettings } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"
import { checkNode, type NodeStatus } from "@/lib/tauri"

const MODEL_OPTIONS = [
  { value: "sonnet", label: "Claude Sonnet 4.5", description: "Fast and capable" },
  { value: "haiku", label: "Claude Haiku 4.5", description: "Fastest, lower cost" },
  { value: "opus", label: "Claude Opus 4.6", description: "Most capable" },
] as const

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [skillsPath, setSkillsPath] = useState<string | null>(null)
  const [preferredModel, setPreferredModel] = useState<string>("sonnet")
  const [debugMode, setDebugMode] = useState(false)
  const [extendedContext, setExtendedContext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null)
  const [nodeLoading, setNodeLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const setStoreSettings = useSettingsStore((s) => s.setSettings)

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
            setDebugMode(result.debug_mode ?? false)
            setExtendedContext(result.extended_context ?? false)
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
    const check = async () => {
      setNodeLoading(true)
      try {
        const result = await checkNode()
        setNodeStatus(result)
      } catch {
        setNodeStatus({ available: false, version: null, meets_minimum: false, error: "Failed to check Node.js" })
      } finally {
        setNodeLoading(false)
      }
    }
    check()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await invoke("save_settings", {
        settings: {
          anthropic_api_key: apiKey,
          workspace_path: workspacePath,
          skills_path: skillsPath,
          preferred_model: preferredModel,
          debug_mode: debugMode,
          extended_context: extendedContext,
          splash_shown: false,
        },
      })
      setSaved(true)
      setSaving(false)
      setTimeout(() => setSaved(false), 1000)

      // Sync Zustand store so other pages see updated settings
      setStoreSettings({
        anthropicApiKey: apiKey,
        workspacePath,
        skillsPath,
        preferredModel,
        debugMode,
        extendedContext,
      })

      toast.success("Settings saved", { duration: 1500 })
    } catch (err) {
      setSaving(false)
      toast.error(
        `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const handleTestApiKey = async () => {
    if (!apiKey) {
      toast.error("Enter an API key first")
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
        `Invalid API key: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setTesting(false)
    }
  }

  const handleBrowseSkillsPath = async () => {
    const folder = await open({ directory: true, title: "Select Skills Folder" })
    if (folder) setSkillsPath(folder)
  }

  const handleClearWorkspace = async () => {
    if (!window.confirm("This will delete all working files and skill data from the workspace. Finished skills in your Skills Folder will not be affected.\n\nAre you sure?")) {
      return
    }
    setClearing(true)
    try {
      await invoke("clear_workspace")
      toast.success("Workspace cleared", { duration: 1500 })
    } catch (err) {
      toast.error(`Failed to clear workspace: ${err instanceof Error ? err.message : String(err)}`)
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
      <h1 className="text-2xl font-semibold">Settings</h1>

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
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Model used for chat sessions. Workflow steps use per-agent models defined in agent files.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-select">Chat Model</Label>
            <select
              id="model-select"
              value={preferredModel}
              onChange={(e) => setPreferredModel(e.target.value)}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.description}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Debug Mode</CardTitle>
          <CardDescription>
            Auto-answer clarification questions with recommended choices during human review steps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="debug-mode">Auto-answer with recommendations</Label>
            <Switch
              id="debug-mode"
              checked={debugMode}
              onCheckedChange={setDebugMode}
            />
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
              onCheckedChange={setExtendedContext}
            />
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
            Skills and working files are stored in this directory. This is managed automatically.
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
          <CardTitle>Node.js Runtime</CardTitle>
          <CardDescription>
            Required for running AI agents. Minimum version: 18.0.0
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nodeLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking Node.js...
            </div>
          ) : nodeStatus?.available && nodeStatus.meets_minimum ? (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle2 className="size-3" />
                Available
              </Badge>
              <span className="text-sm text-muted-foreground">
                v{nodeStatus.version}
              </span>
            </div>
          ) : nodeStatus?.available && !nodeStatus.meets_minimum ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="size-3" />
                  Version too old
                </Badge>
                <span className="text-sm text-muted-foreground">
                  v{nodeStatus.version} (need 18.0.0+)
                </span>
              </div>
              <a
                href="https://nodejs.org"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Download Node.js
                <ExternalLink className="size-3" />
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="size-3" />
                  Not found
                </Badge>
                {nodeStatus?.error && (
                  <span className="text-sm text-muted-foreground">
                    {nodeStatus.error}
                  </span>
                )}
              </div>
              <a
                href="https://nodejs.org"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Download Node.js
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          variant={saved ? "default" : "outline"}
          className={saved ? "bg-green-600 hover:bg-green-600 text-white border-green-600" : ""}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {saved ? "Saved" : "Save Settings"}
        </Button>
      </div>
    </div>
  )
}
