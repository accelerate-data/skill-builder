import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Loader2, Eye, EyeOff, Save, CheckCircle2, XCircle, ExternalLink, FolderOpen } from "lucide-react"
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
import type { AppSettings } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"
import { checkNode, type NodeStatus } from "@/lib/tauri"

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    anthropic_api_key: null,
    workspace_path: null,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null)
  const [nodeLoading, setNodeLoading] = useState(true)
  const setStoreSettings = useSettingsStore((s) => s.setSettings)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await invoke<AppSettings>("get_settings")
          if (!cancelled) {
            setSettings(result)
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

  const handleBrowseFolder = async () => {
    const selected = await open({ directory: true, title: "Select workspace folder" })
    if (selected) {
      setSettings((s) => ({ ...s, workspace_path: selected }))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await invoke("save_settings", { settings })
      setSaved(true)
      setSaving(false)
      setTimeout(() => setSaved(false), 3000)

      // Sync Zustand store so other pages see updated settings
      setStoreSettings({
        anthropicApiKey: settings.anthropic_api_key,
        workspacePath: settings.workspace_path,
      })

      toast.success("Settings saved")
    } catch (err) {
      setSaving(false)
      toast.error(
        `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`
      )
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

      <Card>
        <CardHeader>
          <CardTitle>Workspace Folder</CardTitle>
          <CardDescription>
            Local directory where skills are created and stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-path">Folder Path</Label>
            <div className="flex gap-2">
              <Input
                id="workspace-path"
                placeholder="Select a folder..."
                value={settings.workspace_path || ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    workspace_path: e.target.value || null,
                  }))
                }
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleBrowseFolder}
              >
                <FolderOpen className="size-4" />
                Browse
              </Button>
            </div>
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
