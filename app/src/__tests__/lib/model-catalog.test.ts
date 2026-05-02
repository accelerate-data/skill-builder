import { describe, expect, it } from "vitest";
import {
  findCatalogModel,
  getCatalogModelOptions,
  getProviderApiKeyLabel,
  getProviderBaseUrlDefault,
  modelHasTextOutput,
  normalizeCatalogProviders,
  providerHasTextOutputModels,
} from "../../lib/model-catalog.js";

describe("model catalog helpers", () => {
  it("normalizes sorted providers and filters malformed provider entries", () => {
    const providers = normalizeCatalogProviders({
      zed: {
        id: "zed",
        name: "Zed",
        env: ["ZED_API_KEY"],
        api: "https://zed.example/v1",
        doc: "https://zed.example/docs",
        models: {
          "zed-reasoner": {
            id: "zed-reasoner",
            name: "Zed Reasoner",
            modalities: { output: ["text"] },
          },
        },
      },
      malformedProvider: {
        id: "malformedProvider",
        name: "Malformed",
      },
      alpha: {
        id: "alpha",
        name: "Alpha",
        env: "ALPHA_API_KEY",
        api: null,
        models: {
          "alpha-bad-model": {
            id: "alpha-bad-model",
          },
          "alpha-good-model": {
            id: "alpha-good-model",
            name: "Alpha Good Model",
          },
        },
      },
      wrongId: {
        id: "different",
        name: "Wrong ID",
        models: {},
      },
      nullProvider: null,
    });

    expect(providers.map((provider) => provider.id)).toEqual(["alpha", "zed"]);
    expect(providers[0]).toMatchObject({
      id: "alpha",
      name: "Alpha",
      env: [],
      api: null,
      doc: null,
    });
    expect(Object.keys(providers[0].models)).toEqual(["alpha-good-model"]);
  });

  it("detects text output support from model and provider modalities", () => {
    expect(
      modelHasTextOutput({
        id: "text-model",
        name: "Text Model",
        modalities: { output: ["text"] },
      }),
    ).toBe(true);
    expect(
      modelHasTextOutput({
        id: "image-model",
        name: "Image Model",
        modalities: { output: ["image"] },
      }),
    ).toBe(false);
    expect(
      providerHasTextOutputModels({
        id: "provider",
        name: "Provider",
        env: [],
        api: null,
        doc: null,
        models: {
          image: {
            id: "image",
            name: "Image",
            modalities: { output: ["image"] },
          },
          text: {
            id: "text",
            name: "Text",
            modalities: { output: ["text"] },
          },
        },
      }),
    ).toBe(true);
  });

  it("builds runtime model options for models with reasoning, tool calls, and text output", () => {
    const [provider] = normalizeCatalogProviders({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet": {
            id: "claude-sonnet",
            name: "Claude Sonnet",
            reasoning: true,
            tool_call: true,
            modalities: { output: ["text"] },
          },
          "no-reasoning": {
            id: "no-reasoning",
            name: "No Reasoning",
            tool_call: true,
            modalities: { output: ["text"] },
          },
          "no-tools": {
            id: "no-tools",
            name: "No Tools",
            reasoning: true,
            modalities: { output: ["text"] },
          },
          "image-output": {
            id: "image-output",
            name: "Image Output",
            reasoning: true,
            tool_call: true,
            modalities: { output: ["image"] },
          },
        },
      },
    });

    expect(getCatalogModelOptions(provider)).toEqual([
      expect.objectContaining({
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-sonnet",
        modelName: "Claude Sonnet",
        runtimeModelId: "anthropic/claude-sonnet",
      }),
    ]);
  });

  it("finds a catalog model by full runtime model ID", () => {
    const catalog = normalizeCatalogProviders({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet": {
            id: "claude-sonnet",
            name: "Claude Sonnet",
            reasoning: true,
            tool_call: true,
            modalities: { output: ["text"] },
          },
        },
      },
    });

    expect(findCatalogModel(catalog, "anthropic/claude-sonnet")).toMatchObject({
      providerId: "anthropic",
      modelId: "claude-sonnet",
      runtimeModelId: "anthropic/claude-sonnet",
    });
    expect(findCatalogModel(catalog, "anthropic/unknown")).toBeNull();
  });

  it("returns provider API base URL defaults", () => {
    expect(
      getProviderBaseUrlDefault("anthropic", { api: "https://api.example" }),
    ).toBe("https://api.example");
    expect(getProviderBaseUrlDefault("ollama", { api: null })).toBe(
      "http://localhost:11434",
    );
    expect(getProviderBaseUrlDefault("custom", { api: null })).toBeNull();
  });

  it("uses the first env var for the API key label with a provider-name fallback", () => {
    expect(
      getProviderApiKeyLabel({
        env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
        name: "Anthropic",
      }),
    ).toBe("ANTHROPIC_API_KEY");
    expect(getProviderApiKeyLabel({ env: [], name: "OpenAI" })).toBe(
      "OpenAI API key",
    );
  });
});
