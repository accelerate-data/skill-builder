import { useEffect, useMemo, useState } from "react";
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
import { testModelConnection } from "@/lib/tauri";
import { modelSettingsRequireApiKey } from "@/lib/models";
import {
  fetchModelCatalog,
  findCatalogModel,
  getCatalogModelOptions,
  getProviderApiKeyLabel,
  getProviderBaseUrlDefault,
  type CatalogModelOption,
  type ModelCatalogProvider,
} from "@/lib/model-catalog";

interface ModelsSectionProps {
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

function getProviderModelId(
  providerId: string,
  runtimeModelId: string | null,
): string | null {
  if (!runtimeModelId) return null;
  const prefix = `${providerId}/`;
  return runtimeModelId.startsWith(prefix)
    ? runtimeModelId.slice(prefix.length)
    : runtimeModelId;
}

function formatTokenCount(value?: number): string {
  return typeof value === "number"
    ? `${value.toLocaleString()} tokens`
    : "Not specified";
}

function formatPricing(cost?: Record<string, unknown>): string {
  if (!cost) return "Not listed";

  const input = typeof cost.input === "number" ? `$${cost.input} input` : null;
  const output =
    typeof cost.output === "number" ? `$${cost.output} output` : null;
  const parts = [input, output].filter(Boolean);
  if (!parts.length) return "Not listed";
  return `${parts.join(" / ")} per 1M tokens`;
}

function resolveSelectedCatalogModel(
  catalog: ModelCatalogProvider[],
  providerId: string,
  modelId: string | null,
): CatalogModelOption | null {
  if (!modelId) return null;

  const direct = findCatalogModel(catalog, modelId);
  if (direct) return direct;

  const provider = catalog.find(
    (catalogProvider) => catalogProvider.id === providerId,
  );
  if (!provider) return null;

  const providerModelId = getProviderModelId(providerId, modelId);
  return (
    getCatalogModelOptions(provider).find(
      (option) => option.modelId === providerModelId,
    ) ?? null
  );
}

function ModelDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 rounded-md border p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ModelDetailBooleanRow({
  label,
  value,
}: {
  label: string;
  value?: boolean;
}) {
  const known = typeof value === "boolean";
  return (
    <div className="flex justify-between gap-4 rounded-md border p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-right">
        {known ? (
          <input
            type="checkbox"
            checked={value}
            readOnly
            disabled
            aria-label={`${label} ${value ? "supported" : "not supported"}`}
          />
        ) : null}
        <span>
          {known ? (value ? "Supported" : "Not supported") : "Not listed"}
        </span>
      </span>
    </div>
  );
}

export function ModelsSection({
  modelSettings,
  updateModelSettings,
  saveModelSettings,
  refinePromptSuggestions,
  setRefinePromptSuggestions,
  maxDimensions,
  setMaxDimensions,
  autoSave,
}: ModelsSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogProvider[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);

  const provider = modelSettings.provider ?? "";
  const selectedProvider = catalog.find(
    (catalogProvider) => catalogProvider.id === provider,
  );
  const catalogProviders = useMemo(
    () =>
      catalog.filter(
        (catalogProvider) => getCatalogModelOptions(catalogProvider).length > 0,
      ),
    [catalog],
  );
  const showSelectedProviderFallback =
    catalogProviders.length > 0 &&
    Boolean(provider) &&
    !selectedProvider &&
    provider !== "custom";
  const modelOptions = selectedProvider
    ? getCatalogModelOptions(selectedProvider)
    : [];
  const selectedCatalogModel = resolveSelectedCatalogModel(
    catalog,
    provider,
    modelSettings.model,
  );
  const selectedModelValue = selectedCatalogModel?.runtimeModelId ?? "";
  const showCatalogPicker = Boolean(selectedProvider && modelOptions.length);
  const apiKeyLabel = selectedProvider
    ? getProviderApiKeyLabel(selectedProvider)
    : "Provider API key";
  const apiKeyRequired = modelSettingsRequireApiKey(
    provider,
    modelSettings.model,
    modelSettings.base_url,
  );

  useEffect(() => {
    let cancelled = false;

    fetchModelCatalog()
      .then((providers) => {
        if (cancelled) return;
        setCatalog(providers);
        setCatalogFailed(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("settings: model catalog fetch failed", err);
        setCatalog([]);
        setCatalogFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleTestApiKey = async () => {
    if (apiKeyRequired && !modelSettings.api_key) {
      toast.error("Enter an API key first", { duration: Infinity });
      return;
    }
    setTesting(true);
    setApiKeyValid(null);
    try {
      await testModelConnection(modelSettings);
      setApiKeyValid(true);
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
          <CardTitle>Provider</CardTitle>
          <CardDescription>
            Choose the provider and connection settings used by OpenHands.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="model-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(val) => {
                const nextProvider = catalog.find(
                  (catalogProvider) => catalogProvider.id === val,
                );
                const nextModel = nextProvider
                  ? (getCatalogModelOptions(nextProvider)[0]?.runtimeModelId ??
                    null)
                  : (modelSettings.model ??
                    PROVIDER_DEFAULT_MODELS[val] ??
                    null);
                const nextBaseUrl = getProviderBaseUrlDefault(
                  val,
                  nextProvider,
                );
                const patch = {
                  provider: val,
                  model: nextModel,
                  base_url: nextBaseUrl,
                };
                updateModelSettings(patch);
                saveModelSettings(patch);
              }}
            >
              <SelectTrigger id="model-provider" className="w-64">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {catalogProviders.length ? (
                  catalogProviders.map((catalogProvider) => (
                    <SelectItem
                      key={catalogProvider.id}
                      value={catalogProvider.id}
                    >
                      {catalogProvider.name}
                    </SelectItem>
                  ))
                ) : (
                  <>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                  </>
                )}
                {showSelectedProviderFallback ? (
                  <SelectItem value={provider}>{provider}</SelectItem>
                ) : null}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="model-api-key">API Key</Label>
            <span className="text-sm text-muted-foreground">{apiKeyLabel}</span>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="model-api-key"
                  type={showApiKey ? "text" : "password"}
                  placeholder="Provider API key"
                  value={modelSettings.api_key ?? ""}
                  required={apiKeyRequired}
                  onChange={(e) => {
                    updateModelSettings({ api_key: e.target.value });
                    setApiKeyValid(null);
                  }}
                  onBlur={(e) =>
                    saveModelSettings({ api_key: clean(e.target.value) })
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
                disabled={testing || (apiKeyRequired && !modelSettings.api_key)}
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
              placeholder={
                provider === "ollama" ? "http://localhost:11434" : "Optional"
              }
              value={modelSettings.base_url ?? ""}
              onChange={(e) =>
                updateModelSettings({ base_url: e.target.value })
              }
              onBlur={(e) =>
                saveModelSettings({ base_url: clean(e.target.value) })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Select a model that meets the required OpenHands runtime
            capabilities.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Required capabilities</Label>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked readOnly disabled />
                <span>Reasoning</span>
                <span className="text-xs">Required</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked readOnly disabled />
                <span>Tool calling</span>
                <span className="text-xs">Required</span>
              </label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-id">Model</Label>
            {showCatalogPicker ? (
              <Select
                value={selectedModelValue}
                onValueChange={(val) => {
                  updateModelSettings({ model: val });
                  saveModelSettings({ model: val });
                }}
              >
                <SelectTrigger id="model-id" className="w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((option) => (
                    <SelectItem
                      key={option.runtimeModelId}
                      value={option.runtimeModelId}
                    >
                      {option.modelName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="model-id"
                placeholder={
                  PROVIDER_DEFAULT_MODELS[provider] ?? "provider/model-id"
                }
                value={modelSettings.model ?? ""}
                onChange={(e) => updateModelSettings({ model: e.target.value })}
                onBlur={(e) =>
                  saveModelSettings({ model: clean(e.target.value) })
                }
              />
            )}
            {modelSettings.model ? (
              <span className="text-xs text-muted-foreground">
                {modelSettings.model}
              </span>
            ) : null}
            {catalogFailed ? (
              <span className="text-xs text-muted-foreground">
                Model catalog is unavailable. Enter any OpenHands-compatible
                model ID.
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model Details</CardTitle>
          <CardDescription>
            Catalog metadata for the selected model.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          {selectedCatalogModel ? (
            <>
              <ModelDetailBooleanRow
                label="Tool calling"
                value={selectedCatalogModel.model.tool_call}
              />
              <ModelDetailBooleanRow
                label="Reasoning"
                value={selectedCatalogModel.model.reasoning}
              />
              <ModelDetailBooleanRow
                label="Structured output"
                value={selectedCatalogModel.model.structured_output}
              />
              <ModelDetailBooleanRow
                label="Temperature"
                value={selectedCatalogModel.model.temperature}
              />
              <ModelDetailRow
                label="Context window"
                value={formatTokenCount(
                  selectedCatalogModel.model.limit?.context ??
                    selectedCatalogModel.model.limit?.input,
                )}
              />
              <ModelDetailRow
                label="Max output"
                value={formatTokenCount(
                  selectedCatalogModel.model.limit?.output,
                )}
              />
              <ModelDetailRow
                label="Pricing"
                value={formatPricing(selectedCatalogModel.model.cost)}
              />
            </>
          ) : (
            <ModelDetailRow
              label="Catalog metadata"
              value="Unavailable for this model"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Request Options</CardTitle>
          <CardDescription>
            Generic request options passed to the OpenHands LLM configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
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
          <div className="grid gap-2">
            <Label htmlFor="timeout-seconds">Timeout</Label>
            <Input
              id="timeout-seconds"
              type="number"
              min={1}
              value={modelSettings.timeout_seconds ?? ""}
              onChange={(e) =>
                updateModelSettings({
                  timeout_seconds: Number(e.target.value) || null,
                })
              }
              onBlur={(e) =>
                saveModelSettings({
                  timeout_seconds: Number(e.target.value) || null,
                })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="num-retries">Retries</Label>
            <Input
              id="num-retries"
              type="number"
              min={0}
              value={modelSettings.num_retries ?? ""}
              onChange={(e) =>
                updateModelSettings({
                  num_retries: Number(e.target.value) || null,
                })
              }
              onBlur={(e) =>
                saveModelSettings({
                  num_retries: Number(e.target.value) || null,
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App Behavior</CardTitle>
          <CardDescription>
            Skill Builder behavior outside provider and model configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <CardTitle>Advanced Provider Overrides</CardTitle>
          <CardDescription>
            Optional provider API overrides for compatible backends.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="api-version">Provider API version</Label>
            <Input
              id="api-version"
              placeholder="Optional"
              value={modelSettings.api_version ?? ""}
              onChange={(e) =>
                updateModelSettings({ api_version: e.target.value })
              }
              onBlur={(e) =>
                saveModelSettings({ api_version: clean(e.target.value) })
              }
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
