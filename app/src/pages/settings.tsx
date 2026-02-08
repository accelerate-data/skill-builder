import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Loader2, Eye, EyeOff, Save, CheckCircle2, XCircle, ExternalLink } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import type { AppSettings } from "@/lib/types"
import { checkNode, type NodeStatus } from "@/lib/tauri"

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    anthropic_api_key: null,
    github_token: null,
    github_repo: null,
    workspace_path: null,
    auto_commit: false,
    auto_push: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null)
  const [testingGh, setTestingGh] = useState(false)
  const [ghTokenValid, setGhTokenValid] = useState<boolean | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showGhToken, setShowGhToken] = useState(false)
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null)
  const [nodeLoading, setNodeLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const result = await invoke<AppSettings>("get_settings")
        setSettings(result)
      } catch {
        // Settings may not exist yet — use defaults
      } finally {
        setLoading(false)
      }
    }
    load()
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
      await invoke("save_settings", { settings })
      setSaved(true)
      toast.success("Settings saved")
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      toast.error(
        `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setSaving(false)
    }
  }

  const handleTestGhToken = async () => {
    if (!settings.github_token) {
      toast.error("Enter a GitHub token first")
      return
    }
    setTestingGh(true)
    setGhTokenValid(null)
    try {
      const user = await invoke<{ login: string }>("get_current_user", {
        token: settings.github_token,
      })
      setGhTokenValid(true)
      toast.success(`Authenticated as ${user.login}`)
    } catch (err) {
      setGhTokenValid(false)
      toast.error(
        `Invalid token: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setTestingGh(false)
    }
  }

  const handleTestApiKey = async () => {
    if (!settings.anthropic_api_key) {
      toast.error("Enter an API key first")
      return
    }
    setTesting(true)
    setApiKeyValid(null)
    try {
      await invoke("test_api_key", { apiKey: settings.anthropic_api_key })
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
                  value={settings.anthropic_api_key || ""}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      anthropic_api_key: e.target.value || null,
                    }))
                  }
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
                disabled={testing || !settings.anthropic_api_key}
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

      {/* GitHub Token */}
      <Card>
        <CardHeader>
          <CardTitle>GitHub Token</CardTitle>
          <CardDescription>
            Personal access token for git operations.{" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=Skill+Builder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Create one <ExternalLink className="size-3" />
            </a>
            {" "}with <code className="text-xs bg-muted px-1 rounded">repo</code> scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showGhToken ? "text" : "password"}
                placeholder="ghp_..."
                value={settings.github_token || ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    github_token: e.target.value || null,
                  }))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => setShowGhToken(!showGhToken)}
              >
                {showGhToken ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </Button>
            </div>
            <Button
              variant={ghTokenValid ? "default" : "outline"}
              size="sm"
              onClick={handleTestGhToken}
              disabled={testingGh || !settings.github_token}
              className={ghTokenValid ? "bg-green-600 hover:bg-green-700 text-white" : ""}
            >
              {testingGh ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : ghTokenValid ? (
                <CheckCircle2 className="size-3.5" />
              ) : null}
              {ghTokenValid ? "Valid" : "Test"}
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

      <Card>
        <CardHeader>
          <CardTitle>GitHub Repository</CardTitle>
          <CardDescription>
            Configure your GitHub repository for skill storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="repo">Repository</Label>
            <Input
              id="repo"
              placeholder="e.g., myuser/skill-repo"
              value={settings.github_repo || ""}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  github_repo: e.target.value || null,
                }))
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-path">Workspace Path</Label>
            <Input
              id="workspace-path"
              placeholder="~/skill-builder-workspace/repo-name"
              value={settings.workspace_path || ""}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  workspace_path: e.target.value || null,
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Local directory where skill files are stored
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto-commit">Auto-commit</Label>
              <p className="text-xs text-muted-foreground">
                Automatically commit after each workflow step
              </p>
            </div>
            <Switch
              id="auto-commit"
              checked={settings.auto_commit}
              onCheckedChange={(checked) =>
                setSettings((s) => ({ ...s, auto_commit: checked }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto-push">Auto-push</Label>
              <p className="text-xs text-muted-foreground">
                Push to GitHub after each commit
              </p>
            </div>
            <Switch
              id="auto-push"
              checked={settings.auto_push}
              onCheckedChange={(checked) =>
                setSettings((s) => ({ ...s, auto_push: checked }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className={saved ? "bg-green-600 hover:bg-green-700 text-white" : ""}
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
