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
import type { ModelSettings, ProviderOverride } from "@/lib/types";
import type { ModelSettingsPatch } from "@/hooks/use-settings-form";
import { testModelConnection } from "@/lib/tauri";
import { modelSettingsRequireApiKey } from "@/lib/models";
import {
  fetchCachedModelCatalog,
  fetchCachedModelProviders,
  getCatalogModelOptions,
  getModelsForProvider,
  getProviderBaseUrlDefault,
  getProviderApiKeyLabel,
  resolveSelectedCatalogModel,
  filterByCapabilities,
  type ModelCatalogEntry,
  type ProviderCatalogRow,
  type CapabilityFilter,
  DEFAULT_CAPABILITY_FILTER,
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

function clean(value: string): string | null {
  return value.trim() || null;
}

function formatTokenCount(value?: number): string {
  return typeof value === "number"
    ? `${value.toLocaleString()} tokens`
    : "Not specified";
}

function formatPricing(
  inputCost?: number | null,
  outputCost?: number | null,
): string {
  const parts: string[] = [];
  if (typeof inputCost === "number") {
    parts.push(`$${inputCost} input`);
  }
  if (typeof outputCost === "number") {
    parts.push(`$${outputCost} output`);
  }
  if (!parts.length) return "Not listed";
  return `${parts.join(" / ")} per 1M tokens`;
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

function getDefaultProviderOverride(): ProviderOverride {
  return {
    api_key: null,
    base_url_override: null,
    api_version: null,
    temperature: null,
    max_output_tokens: null,
    timeout_seconds: 300,
    num_retries: 5,
    reasoning_effort: "auto",
    extra_headers: null,
    input_cost_per_token: null,
    output_cost_per_token: null,
    usage_id: "workflow",
  };
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
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [providers, setProviders] = useState<ProviderCatalogRow[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>(DEFAULT_CAPABILITY_FILTER);

  const providerId = modelSettings.provider_id ?? "";
  const catalogEntriesForProvider = useMemo(
    () => getModelsForProvider(catalog, providerId),
    [catalog, providerId],
  );
  const filteredEntries = useMemo(
    () => filterByCapabilities(catalogEntriesForProvider, capabilityFilter),
    [catalogEntriesForProvider, capabilityFilter],
  );
  const modelOptions = useMemo(
    () => getCatalogModelOptions(filteredEntries),
    [filteredEntries],
  );
  const selectedCatalogModel = resolveSelectedCatalogModel(
    catalog,
    modelSettings.model_id,
  );
  const selectedModelValue = selectedCatalogModel?.full_id ?? "";
  const showCatalogPicker = Boolean(providerId && modelOptions.length);

  const providerEntry = useMemo(() => {
    if (!providerId || !catalog.length) return null;
    const providerRow = providers.find((p) => p.provider_id === providerId);
    const first = catalog.find((e) => e.provider_id === providerId);
    if (!first) return null;
    return {
      id: first.provider_id,
      name: providerRow?.name ?? first.provider_id,
      api_base_url: providerRow?.api_base_url ?? null,
      env: [],
    };
  }, [catalog, providers, providerId]);

  const activeOverride = useMemo((): ProviderOverride => {
    if (providerId && modelSettings.provider_overrides[providerId]) {
      return modelSettings.provider_overrides[providerId];
    }
    return getDefaultProviderOverride();
  }, [providerId, modelSettings.provider_overrides]);

  const effectiveBaseUrl = activeOverride.base_url_override ?? null;
  const apiKeyLabel = providerEntry
    ? getProviderApiKeyLabel(providerEntry.env, providerEntry.name)
    : "Provider API key";
  const apiKeyRequired = modelSettingsRequireApiKey(
    providerId,
    modelSettings.model_id,
    effectiveBaseUrl,
  );

  useEffect(() => {
    let cancelled = false;

    setCatalogLoading(true);
    Promise.all([fetchCachedModelCatalog(), fetchCachedModelProviders()])
      .then(([entries, providerRows]) => {
        if (cancelled) return;
        setCatalog(entries);
        setProviders(providerRows);
        setCatalogFailed(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("settings: model catalog fetch failed", err);
        setCatalog([]);
        setProviders([]);
        setCatalogFailed(true);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleTestApiKey = async () => {
    if (apiKeyRequired && !activeOverride.api_key) {
      toast.error("Enter an API key first", { duration: Infinity });
      return;
    }
    setTesting(true);
    setApiKeyValid(null);
    try {
      await testModelConnection({
        provider_id: providerId,
        model_id: modelSettings.model_id,
        provider_overrides: {
          ...(providerId ? { [providerId]: activeOverride } : {}),
        },
      });
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

  const handleProviderChange = (val: string) => {
    const existingOverride = modelSettings.provider_overrides[val];
    const nextOverride = existingOverride ?? getDefaultProviderOverride();
    const providerModels = getModelsForProvider(catalog, val);
    const options = getCatalogModelOptions(providerModels);
    const firstModel = options[0]?.full_id ?? null;
    const providerRow = providers.find((p) => p.provider_id === val);
    const catalogBaseUrl = providerRow?.api_base_url ?? null;
    const effectiveBaseUrl = nextOverride.base_url_override ?? getProviderBaseUrlDefault(val, catalogBaseUrl);

    const mergedOverride = {
      ...nextOverride,
      ...(effectiveBaseUrl && !nextOverride.base_url_override ? { base_url_override: effectiveBaseUrl } : {}),
    };

    const nextOverrides = {
      ...modelSettings.provider_overrides,
      [val]: mergedOverride,
    };

    const patch = {
      provider_id: val,
      model_id: firstModel,
      provider_overrides: nextOverrides,
    };
    updateModelSettings(patch);
    saveModelSettings(patch);
  };

  const handleModelChange = (val: string) => {
    const patch = { model_id: val };
    updateModelSettings(patch);
    saveModelSettings(patch);
  };

  const handleOverrideFieldChange = (
    field: keyof ProviderOverride,
    value: string | number | null,
  ) => {
    const currentOverride = { ...activeOverride };
    const nextOverride = { ...currentOverride, [field]: value };
    const nextOverrides = {
      ...modelSettings.provider_overrides,
      [providerId]: nextOverride,
    };
    updateModelSettings({ provider_overrides: nextOverrides });
  };

  const handleOverrideFieldSave = (
    field: keyof ProviderOverride,
    value: string | number | null,
  ) => {
    const currentOverride = { ...activeOverride };
    const nextOverride = { ...currentOverride, [field]: value };
    const nextOverrides = {
      ...modelSettings.provider_overrides,
      [providerId]: nextOverride,
    };
    saveModelSettings({ provider_overrides: nextOverrides });
  };

  const uniqueProviders = useMemo(() => {
    const seen = new Set<string>();
    return catalog.filter((entry) => {
      if (seen.has(entry.provider_id)) return false;
      seen.add(entry.provider_id);
      return true;
    });
  }, [catalog]);

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
              value={providerId}
              onValueChange={handleProviderChange}
            >
              <SelectTrigger id="model-provider" className="w-64">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {uniqueProviders.length ? (
                  uniqueProviders.map((p) => (
                    <SelectItem key={p.provider_id} value={p.provider_id}>
                      {p.provider_id}
                    </SelectItem>
                  ))
                ) : catalogLoading ? (
                  <SelectItem value="" disabled>Loading...</SelectItem>
                ) : (
                  <>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                  </>
                )}
                {providerId && !uniqueProviders.find((p) => p.provider_id === providerId) ? (
                  <SelectItem value={providerId}>{providerId}</SelectItem>
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
                  value={activeOverride.api_key ?? ""}
                  required={apiKeyRequired}
                  onChange={(e) => {
                    handleOverrideFieldChange("api_key", e.target.value);
                    setApiKeyValid(null);
                  }}
                  onBlur={(e) =>
                    handleOverrideFieldSave("api_key", clean(e.target.value))
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
                disabled={testing || (apiKeyRequired && !activeOverride.api_key)}
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
                providerId === "ollama" ? "http://localhost:11434" : "Optional"
              }
              value={activeOverride.base_url_override ?? ""}
              onChange={(e) =>
                handleOverrideFieldChange("base_url_override", e.target.value)
              }
              onBlur={(e) =>
                handleOverrideFieldSave("base_url_override", clean(e.target.value))
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
                <input
                  type="checkbox"
                  checked={capabilityFilter.reasoning}
                  onChange={(e) =>
                    setCapabilityFilter((prev) => ({ ...prev, reasoning: e.target.checked }))
                  }
                />
                <span>Reasoning</span>
                {!capabilityFilter.reasoning && (
                  <span className="text-xs text-muted-foreground">Optional</span>
                )}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={capabilityFilter.tool_call}
                  onChange={(e) =>
                    setCapabilityFilter((prev) => ({ ...prev, tool_call: e.target.checked }))
                  }
                />
                <span>Tool calling</span>
                {!capabilityFilter.tool_call && (
                  <span className="text-xs text-muted-foreground">Optional</span>
                )}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={capabilityFilter.structured_output}
                  onChange={(e) =>
                    setCapabilityFilter((prev) => ({ ...prev, structured_output: e.target.checked }))
                  }
                />
                <span>Structured output</span>
                {!capabilityFilter.structured_output && (
                  <span className="text-xs text-muted-foreground">Optional</span>
                )}
              </label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-id">Model</Label>
            {showCatalogPicker ? (
              <Select
                value={selectedModelValue}
                onValueChange={handleModelChange}
              >
                <SelectTrigger id="model-id" className="w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((option) => (
                    <SelectItem
                      key={option.full_id}
                      value={option.full_id}
                    >
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="model-id"
                placeholder="provider/model-id"
                value={modelSettings.model_id ?? ""}
                onChange={(e) => updateModelSettings({ model_id: e.target.value })}
                onBlur={(e) =>
                  saveModelSettings({ model_id: clean(e.target.value) })
                }
              />
            )}
            {modelSettings.model_id ? (
              <span className="text-xs text-muted-foreground">
                {modelSettings.model_id}
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
                value={selectedCatalogModel.tool_call}
              />
              <ModelDetailBooleanRow
                label="Reasoning"
                value={selectedCatalogModel.reasoning}
              />
              <ModelDetailBooleanRow
                label="Structured output"
                value={selectedCatalogModel.structured_output ?? undefined}
              />
              <ModelDetailBooleanRow
                label="Temperature"
                value={selectedCatalogModel.temperature ?? undefined}
              />
              <ModelDetailRow
                label="Context window"
                value={formatTokenCount(
                  selectedCatalogModel.context_limit ?? undefined,
                )}
              />
              <ModelDetailRow
                label="Pricing"
                value={formatPricing(
                  selectedCatalogModel.input_cost_per_token,
                  selectedCatalogModel.output_cost_per_token,
                )}
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
              value={activeOverride.reasoning_effort ?? "auto"}
              onValueChange={(val) => {
                handleOverrideFieldChange("reasoning_effort", val);
                handleOverrideFieldSave("reasoning_effort", val);
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
              value={activeOverride.timeout_seconds ?? ""}
              onChange={(e) =>
                handleOverrideFieldChange(
                  "timeout_seconds",
                  Number(e.target.value) || null,
                )
              }
              onBlur={(e) =>
                handleOverrideFieldSave(
                  "timeout_seconds",
                  Number(e.target.value) || null,
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="num-retries">Retries</Label>
            <Input
              id="num-retries"
              type="number"
              min={0}
              value={activeOverride.num_retries ?? ""}
              onChange={(e) =>
                handleOverrideFieldChange(
                  "num_retries",
                  Number(e.target.value) || null,
                )
              }
              onBlur={(e) =>
                handleOverrideFieldSave(
                  "num_retries",
                  Number(e.target.value) || null,
                )
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
              value={activeOverride.api_version ?? ""}
              onChange={(e) =>
                handleOverrideFieldChange("api_version", e.target.value)
              }
              onBlur={(e) =>
                handleOverrideFieldSave("api_version", clean(e.target.value))
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
