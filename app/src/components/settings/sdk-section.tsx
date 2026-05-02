import { useState } from "react";
import { toast } from "@/lib/toast";
import { Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelSettings } from "@/lib/types";
import type { ModelSettingsPatch } from "@/hooks/use-settings-form";
import { testApiKey } from "@/lib/tauri";

interface SdkSectionProps {
  modelSettings: ModelSettings;
  updateModelSettings: (patch: ModelSettingsPatch) => void;
  saveModelSettings: (patch: ModelSettingsPatch) => void;
  refinePromptSuggestions: boolean;
  setRefinePromptSuggestions: (v: boolean) => void;
  maxDimensions: number;
  setMaxDimensions: (v: number) => void;
  autoSave: (overrides: {
    refinePromptSuggestions?: boolean;
    maxDimensions?: number;
  }) => void | Promise<void>;
}

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  google: "gemini-2.5-pro",
  ollama: "llama3.1",
};

function clean(value: string): string | null {
  return value.trim() || null;
}

export function SdkSection({
  modelSettings,
  updateModelSettings,
  saveModelSettings,
  refinePromptSuggestions,
  setRefinePromptSuggestions,
  maxDimensions,
  setMaxDimensions,
  autoSave,
}: SdkSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null);

  const provider = modelSettings.provider ?? "anthropic";
  const apiKeyRequired = provider !== "ollama";

  const handleTestApiKey = async () => {
    if (!modelSettings.api_key) {
      toast.error("Enter an API key first", { duration: Infinity });
      return;
    }
    setTesting(true);
    setApiKeyValid(null);
    try {
      await testApiKey(modelSettings.api_key);
      setApiKeyValid(true);
      toast.success("API key is valid");
    } catch (err) {
      console.error("settings: API key test failed", err);
      setApiKeyValid(false);
      toast.error(err instanceof Error ? err.message : String(err), {
        duration: Infinity,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Models</h2>
        <p className="text-sm text-muted-foreground">
          Configure the language model used by workflow agents.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Workflow agents run in the app workspace using OpenHands. Model
            settings are stored in Skill Builder settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="model-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(val) => {
                const nextModel = modelSettings.model ?? PROVIDER_DEFAULT_MODELS[val] ?? null;
                updateModelSettings({ provider: val, model: nextModel });
                saveModelSettings({ provider: val, model: nextModel });
              }}
            >
              <SelectTrigger id="model-provider" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-id">Model</Label>
            <Input
              id="model-id"
              placeholder={PROVIDER_DEFAULT_MODELS[provider] ?? "provider/model-id"}
              value={modelSettings.model ?? ""}
              onChange={(e) => updateModelSettings({ model: e.target.value })}
              onBlur={(e) => saveModelSettings({ model: clean(e.target.value) })}
            />
            {modelSettings.model ? (
              <span className="text-xs text-muted-foreground">
                {modelSettings.model}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="model-api-key">API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="model-api-key"
                  type={showApiKey ? "text" : "password"}
                  placeholder={provider === "anthropic" ? "sk-ant-..." : "Provider API key"}
                  value={modelSettings.api_key ?? ""}
                  required={apiKeyRequired}
                  onChange={(e) => {
                    updateModelSettings({ api_key: e.target.value });
                    setApiKeyValid(null);
                  }}
                  onBlur={(e) => saveModelSettings({ api_key: clean(e.target.value) })}
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
                disabled={testing || !modelSettings.api_key}
                className={apiKeyValid ? "text-white" : ""}
                style={
                  apiKeyValid
                    ? { background: "var(--color-seafoam)", color: "white" }
                    : undefined
                }
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

          <div className="grid gap-2">
            <Label htmlFor="model-base-url">Base URL</Label>
            <Input
              id="model-base-url"
              placeholder={provider === "ollama" ? "http://localhost:11434" : "Optional"}
              value={modelSettings.base_url ?? ""}
              onChange={(e) => updateModelSettings({ base_url: e.target.value })}
              onBlur={(e) => saveModelSettings({ base_url: clean(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model Details</CardTitle>
          <CardDescription>
            Runtime capabilities are resolved by OpenHands for the selected
            model.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div className="flex justify-between gap-4 rounded-md border p-3">
            <span className="text-muted-foreground">Tool calling</span>
            <span>Detected at runtime</span>
          </div>
          <div className="flex justify-between gap-4 rounded-md border p-3">
            <span className="text-muted-foreground">Reasoning</span>
            <span>Auto</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Request Settings</CardTitle>
          <CardDescription>
            Generic request options passed to the OpenHands LLM configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="timeout-seconds">Timeout</Label>
            <Input
              id="timeout-seconds"
              type="number"
              min={1}
              value={modelSettings.timeout_seconds ?? ""}
              onChange={(e) => updateModelSettings({ timeout_seconds: Number(e.target.value) || null })}
              onBlur={(e) => saveModelSettings({ timeout_seconds: Number(e.target.value) || null })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="num-retries">Retries</Label>
            <Input
              id="num-retries"
              type="number"
              min={0}
              value={modelSettings.num_retries ?? ""}
              onChange={(e) => updateModelSettings({ num_retries: Number(e.target.value) || null })}
              onBlur={(e) => saveModelSettings({ num_retries: Number(e.target.value) || null })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
          <CardDescription>
            Model capability preferences. Unsupported options are ignored by the
            runtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Reasoning effort</Label>
            <Select
              value={modelSettings.reasoning_effort ?? "auto"}
              onValueChange={(val) => {
                updateModelSettings({ reasoning_effort: val });
                saveModelSettings({ reasoning_effort: val });
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="refine-prompt-suggestions">
                Prompt suggestions
              </Label>
              <span className="text-sm text-muted-foreground">
                Allow refine chat sessions to request prompt suggestions when
                supported.
              </span>
            </div>
            <Switch
              id="refine-prompt-suggestions"
              checked={refinePromptSuggestions}
              onCheckedChange={(checked) => {
                setRefinePromptSuggestions(checked);
                autoSave({ refinePromptSuggestions: checked });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
          <CardDescription>
            Optional model API overrides.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="api-version">API version</Label>
            <Input
              id="api-version"
              placeholder="Optional"
              value={modelSettings.api_version ?? ""}
              onChange={(e) => updateModelSettings({ api_version: e.target.value })}
              onBlur={(e) => saveModelSettings({ api_version: clean(e.target.value) })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="usage-id">Usage ID</Label>
            <Input
              id="usage-id"
              placeholder="workflow"
              value={modelSettings.usage_id ?? ""}
              onChange={(e) => updateModelSettings({ usage_id: e.target.value })}
              onBlur={(e) => saveModelSettings({ usage_id: clean(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Research Scope Limit</CardTitle>
          <CardDescription>
            Maximum number of research dimensions before suggesting narrower
            skills. Lower values produce more focused skills.
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
                const val = Math.max(
                  1,
                  Math.min(18, parseInt(e.target.value) || 5),
                );
                setMaxDimensions(val);
              }}
              onBlur={() => autoSave({ maxDimensions })}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">
              {maxDimensions <= 3
                ? "Narrow focus"
                : maxDimensions <= 5
                  ? "Balanced (default)"
                  : maxDimensions <= 8
                    ? "Broad research"
                    : "Very broad"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
