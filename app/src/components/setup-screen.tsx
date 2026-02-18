import { useState, useEffect } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Loader2, Eye, EyeOff, CheckCircle2, FolderSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSettingsStore } from "@/stores/settings-store"
import { getSettings, saveSettings, testApiKey, getDefaultSkillsPath } from "@/lib/tauri"

interface SetupScreenProps {
  /** @deprecated No longer needed -- the parent reads isConfigured from the store. */
  onComplete?: () => void
}

export function SetupScreen({ onComplete }: SetupScreenProps = {}) {
  const existingApiKey = useSettingsStore((s) => s.anthropicApiKey)
  const existingSkillsPath = useSettingsStore((s) => s.skillsPath)
  const [apiKey, setApiKey] = useState(existingApiKey ?? "")
  const [showApiKey, setShowApiKey] = useState(false)
  const [skillsPath, setSkillsPath] = useState(existingSkillsPath ?? "")
  const [testing, setTesting] = useState(false)
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const setStoreSettings = useSettingsStore((s) => s.setSettings)

  // Only fetch default skills path if no existing value
  useEffect(() => {
    if (!existingSkillsPath) {
      getDefaultSkillsPath()
        .then((path) => setSkillsPath(path))
        .catch(() => {})
    }
  }, [existingSkillsPath])

  const handleTestApiKey = async () => {
    if (!apiKey) return
    setTesting(true)
    setApiKeyValid(null)
    try {
      await testApiKey(apiKey)
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
      let normalized = folder.replace(/\/+$/, "")
      const parts = normalized.split("/")
      if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
        normalized = parts.slice(0, -1).join("/")
      }
      setSkillsPath(normalized)
    }
  }

  const handleContinue = async () => {
    if (!apiKey || !skillsPath) return
    setSaving(true)
    try {
      const existing = await getSettings()
      await saveSettings({
        ...existing,
        anthropic_api_key: apiKey,
        skills_path: skillsPath,
      })
      setStoreSettings({
        anthropicApiKey: apiKey,
        skillsPath,
      })
      onComplete?.()
    } catch (err) {
      toast.error(
        `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      )
    } finally {
      setSaving(false)
    }
  }

  const canContinue = !!apiKey && !!skillsPath && !saving

  return (
    <div
      data-testid="setup-screen"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
    >
      {/* Gradient backdrop */}
      <div className="absolute inset-0 bg-background">
        <div className="absolute inset-0 opacity-30 dark:opacity-20">
          <div className="absolute -top-1/4 -left-1/4 h-3/4 w-3/4 rounded-full bg-[oklch(0.7_0.12_230)] blur-[120px]" />
          <div className="absolute -right-1/4 -bottom-1/4 h-3/4 w-3/4 rounded-full bg-[oklch(0.7_0.10_300)] blur-[120px]" />
        </div>
      </div>

      {/* Card */}
      <div className="relative z-10 flex w-full max-w-md flex-col gap-6 rounded-xl border bg-card p-10 shadow-lg">
        <div className="flex flex-col gap-1.5 text-center">
          <img src="/icon-256.png" alt="Skill Builder" className="mx-auto mb-2 size-14" />
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Skill Builder</h1>
          <p className="text-sm text-muted-foreground">
            Set up your API key and skills folder to get started.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          {/* API Key */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-api-key">Anthropic API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="setup-api-key"
                  type={showApiKey ? "text" : "password"}
                  placeholder="sk-ant-..."
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setApiKeyValid(null)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
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
            <p className="text-xs text-muted-foreground">
              Get your key at{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                console.anthropic.com
              </a>
            </p>
          </div>

          {/* Skills Folder */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-skills-path">Skills Folder</Label>
            <div className="flex gap-2">
              <Input
                id="setup-skills-path"
                placeholder="~/skill-builder"
                value={skillsPath}
                onChange={(e) => setSkillsPath(e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={handleBrowseSkillsPath}>
                <FolderSearch className="size-4" />
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Where your built skills will be stored.
            </p>
          </div>
        </div>

        <Button
          size="lg"
          onClick={handleContinue}
          disabled={!canContinue}
          className="w-full"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Get Started
        </Button>
      </div>
    </div>
  )
}
