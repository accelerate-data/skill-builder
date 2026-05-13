import type { ModelCatalogEntry, ProviderCatalogRow } from "@/lib/tauri-command-types";
import type { ModelFilter } from "@/lib/tauri-command-types";
import { getCachedModelCatalog, getCachedModelProviders, filterModels as invokeFilterModels } from "@/lib/tauri";

export type { ModelCatalogEntry, ProviderCatalogRow };

export type CatalogModelOption = {
  full_id: string;
  provider_id: string;
  model_id: string;
  name: string;
  runtimeModelId: string;
  entry: ModelCatalogEntry;
};

export const REQUIRED_MODEL_CAPABILITIES = {
  reasoning: true,
  tool_call: true,
} as const;

const OLLAMA_BASE_URL = "http://localhost:11434";

export function modelHasTextOutput(entry: ModelCatalogEntry): boolean {
  return entry.output_modalities.includes("text");
}

export function modelMeetsRequiredCapabilities(entry: ModelCatalogEntry): boolean {
  return (
    entry.reasoning === REQUIRED_MODEL_CAPABILITIES.reasoning &&
    entry.tool_call === REQUIRED_MODEL_CAPABILITIES.tool_call
  );
}

export function getCatalogModelOptions(
  entries: ModelCatalogEntry[],
): CatalogModelOption[] {
  return entries
    .filter(
      (entry) =>
        modelHasTextOutput(entry) && modelMeetsRequiredCapabilities(entry),
    )
    .map((entry) => ({
      full_id: entry.full_id,
      provider_id: entry.provider_id,
      model_id: entry.model_id,
      name: entry.name,
      runtimeModelId: entry.full_id,
      entry,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getModelsForProvider(
  entries: ModelCatalogEntry[],
  providerId: string,
): ModelCatalogEntry[] {
  return entries.filter((e) => e.provider_id === providerId);
}

export function resolveSelectedCatalogModel(
  entries: ModelCatalogEntry[],
  fullId: string | null,
): ModelCatalogEntry | null {
  if (!fullId) return null;
  return entries.find((e) => e.full_id === fullId) ?? null;
}

export function getProviderBaseUrlDefault(
  providerId: string,
  providerApiBaseUrl: string | null,
): string | null {
  if (providerApiBaseUrl) return providerApiBaseUrl;
  if (providerId === "ollama") return OLLAMA_BASE_URL;
  return null;
}

export function getProviderApiKeyLabel(
  envVars: string[],
  providerName: string,
): string {
  return envVars[0] ?? `${providerName} API key`;
}

export async function fetchCachedModelCatalog(): Promise<ModelCatalogEntry[]> {
  return getCachedModelCatalog();
}

export async function fetchCachedModelProviders(): Promise<ProviderCatalogRow[]> {
  return getCachedModelProviders();
}

export async function filterModels(
  entries: ModelCatalogEntry[],
  filters: ModelFilter[],
): Promise<ModelCatalogEntry[]> {
  return invokeFilterModels(entries, filters);
}
