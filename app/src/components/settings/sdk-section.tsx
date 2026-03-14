import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "@/lib/toast"
import { Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSettingsStore, type ModelInfo } from "@/stores/settings-store"

interface SdkSectionProps {
  apiKey: string | null
  setApiKey: (v: string | null) => void
  preferredModel: string
  setPreferredModel: (v: string) => void
  extendedThinking: boolean
  setExtendedThinking: (v: boolean) => void
  interleavedThinkingBeta: boolean
  setInterleavedThinkingBeta: (v: boolean) => void
  sdkEffort: string
  setSdkEffort: (v: string) => void
  refinePromptSuggestions: boolean
  setRefinePromptSuggestions: (v: boolean) => void
  maxDimensions: number
  setMaxDimensions: (v: number) => void
  autoSave: (overrides: Record<string, unknown>) => void
}

export function SdkSection({
  apiKey,
  setApiKey,
  preferredModel,
  setPreferredModel,
  extendedThinking,
  setExtendedThinking,
  interleavedThinkingBeta,
  setInterleavedThinkingBeta,
  sdkEffort,
  setSdkEffort,
  refinePromptSuggestions,
  setRefinePromptSuggestions,
  maxDimensions,
  setMaxDimensions,
  autoSave,
}: SdkSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null)
  const availableModels = useSettingsStore((s) => s.availableModels)
  const setStoreSettings = useSettingsStore((s) => s.setSettings)

  const fetchModels = async (key: string) => {
    try {
      const models = await invoke<ModelInfo[]>("list_models", { apiKey: key })
      setStoreSettings({ availableModels: models ?? [] })
    } catch (err) {
      console.warn("[settings] Could not fetch model list:", err)
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

  return (
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
          <CardTitle>Model</CardTitle>
          <CardDescription>
            The Claude model used for all agents — skill building, refining, and testing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Select
              value={preferredModel || (availableModels.length > 0 ? availableModels[0].id : "")}
              onValueChange={(val) => { setPreferredModel(val); autoSave({ preferredModel: val }); }}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="interleaved-thinking-beta">Interleaved thinking beta</Label>
              <span className="text-sm text-muted-foreground">Enable interleaved thinking beta when thinking is enabled on supported non-Opus models.</span>
            </div>
            <Switch
              id="interleaved-thinking-beta"
              checked={interleavedThinkingBeta}
              onCheckedChange={(checked) => { setInterleavedThinkingBeta(checked); autoSave({ interleavedThinkingBeta: checked }); }}
            />
          </div>

          <div className="grid gap-2">
            <Label>Reasoning effort</Label>
            <Select
              value={sdkEffort || "_default"}
              onValueChange={(val) => {
                const effort = val === "_default" ? "" : val
                setSdkEffort(effort)
                autoSave({ sdkEffort: effort || null })
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">Default</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="max">Max</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="refine-prompt-suggestions">Refine prompt suggestions</Label>
              <span className="text-sm text-muted-foreground">Enable SDK prompt suggestions during refine chat sessions.</span>
            </div>
            <Switch
              id="refine-prompt-suggestions"
              checked={refinePromptSuggestions}
              onCheckedChange={(checked) => { setRefinePromptSuggestions(checked); autoSave({ refinePromptSuggestions: checked }); }}
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
  )
}
