export type ModelCatalogProvider = {
  id: string;
  name: string;
  env: string[];
  api: string | null;
  doc: string | null;
  models: Record<string, ModelCatalogModel>;
};

export type ModelCatalogModel = {
  id: string;
  name: string;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  cost?: Record<string, unknown>;
  limit?: Record<string, number>;
  modalities?: { input?: string[]; output?: string[] };
};

export type CatalogModelOption = {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  runtimeModelId: string;
  model: ModelCatalogModel;
};

export const REQUIRED_MODEL_CAPABILITIES = {
  reasoning: true,
  tool_call: true,
} as const;

const MODEL_CATALOG_URL = "https://models.dev/api.json";
const OLLAMA_BASE_URL = "http://localhost:11434";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeLimit(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeModalities(
  value: unknown,
): ModelCatalogModel["modalities"] | undefined {
  if (!isRecord(value)) return undefined;

  const input = stringArray(value.input);
  const output = stringArray(value.output);
  if (!input.length && !output.length) return undefined;

  return {
    ...(input.length ? { input } : {}),
    ...(output.length ? { output } : {}),
  };
}

function normalizeModel(
  modelId: string,
  value: unknown,
): ModelCatalogModel | null {
  if (!isRecord(value)) return null;
  if (value.id !== modelId || typeof value.name !== "string") return null;

  const model: ModelCatalogModel = {
    id: value.id,
    name: value.name,
  };

  for (const key of [
    "reasoning",
    "tool_call",
    "structured_output",
    "temperature",
  ] as const) {
    if (typeof value[key] === "boolean") {
      model[key] = value[key];
    }
  }

  if (isRecord(value.cost)) {
    model.cost = value.cost;
  }

  const limit = normalizeLimit(value.limit);
  if (limit) {
    model.limit = limit;
  }

  const modalities = normalizeModalities(value.modalities);
  if (modalities) {
    model.modalities = modalities;
  }

  return model;
}

export function normalizeCatalogProviders(
  catalog: unknown,
): ModelCatalogProvider[] {
  if (!isRecord(catalog)) return [];

  return Object.entries(catalog)
    .map(([providerId, value]) => {
      if (!isRecord(value)) return null;
      if (
        value.id !== providerId ||
        typeof value.name !== "string" ||
        !isRecord(value.models)
      ) {
        return null;
      }

      const models = Object.fromEntries(
        Object.entries(value.models)
          .map(([modelId, modelValue]) => [
            modelId,
            normalizeModel(modelId, modelValue),
          ])
          .filter(
            (entry): entry is [string, ModelCatalogModel] => entry[1] !== null,
          )
          .sort(([left], [right]) => left.localeCompare(right)),
      );

      return {
        id: value.id,
        name: value.name,
        env: stringArray(value.env),
        api: optionalString(value.api),
        doc: optionalString(value.doc),
        models,
      };
    })
    .filter((provider): provider is ModelCatalogProvider => provider !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function modelHasTextOutput(model: ModelCatalogModel): boolean {
  return model.modalities?.output?.includes("text") === true;
}

export function providerHasTextOutputModels(
  provider: ModelCatalogProvider,
): boolean {
  return Object.values(provider.models).some(modelHasTextOutput);
}

export function modelMeetsRequiredCapabilities(
  model: ModelCatalogModel,
): boolean {
  return (
    model.reasoning === REQUIRED_MODEL_CAPABILITIES.reasoning &&
    model.tool_call === REQUIRED_MODEL_CAPABILITIES.tool_call
  );
}

export function getCatalogModelOptions(
  provider: ModelCatalogProvider,
): CatalogModelOption[] {
  return Object.values(provider.models)
    .filter(
      (model) =>
        modelHasTextOutput(model) && modelMeetsRequiredCapabilities(model),
    )
    .map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      modelName: model.name,
      runtimeModelId: `${provider.id}/${model.id}`,
      model,
    }))
    .sort((left, right) =>
      left.runtimeModelId.localeCompare(right.runtimeModelId),
    );
}

export function findCatalogModel(
  catalog: ModelCatalogProvider[],
  runtimeModelId: string,
): CatalogModelOption | null {
  for (const provider of catalog) {
    const option = getCatalogModelOptions(provider).find(
      (modelOption) => modelOption.runtimeModelId === runtimeModelId,
    );
    if (option) return option;
  }
  return null;
}

export function getProviderBaseUrlDefault(
  providerId: string,
  provider?: Pick<ModelCatalogProvider, "api"> | null,
): string | null {
  if (provider?.api) return provider.api;
  if (providerId === "ollama") return OLLAMA_BASE_URL;
  return null;
}

export function getProviderApiKeyLabel(
  provider: Pick<ModelCatalogProvider, "env" | "name">,
): string {
  return provider.env[0] ?? `${provider.name} API key`;
}

export async function fetchModelCatalog(
  fetcher: typeof fetch = fetch,
): Promise<ModelCatalogProvider[]> {
  const response = await fetcher(MODEL_CATALOG_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch model catalog: ${response.status}`);
  }

  return normalizeCatalogProviders(await response.json());
}
