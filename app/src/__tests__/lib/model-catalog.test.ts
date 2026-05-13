import { describe, expect, it } from "vitest";
import {
  filterByCapabilities,
  getCatalogModelOptions,
  getModelsForProvider,
  getProviderApiKeyLabel,
  getProviderBaseUrlDefault,
  modelHasTextOutput,
  modelMeetsRequiredCapabilities,
  resolveSelectedCatalogModel,
  DEFAULT_CAPABILITY_FILTER,
  type ModelCatalogEntry,
} from "../../lib/model-catalog.js";

function makeEntry(overrides: Partial<ModelCatalogEntry>): ModelCatalogEntry {
  return {
    full_id: "test/model",
    provider_id: "test",
    model_id: "model",
    name: "Test Model",
    family: null,
    attachment: false,
    reasoning: true,
    tool_call: true,
    structured_output: null,
    temperature: null,
    knowledge: null,
    release_date: "2024-01-01",
    last_updated: "2024-01-01",
    open_weights: false,
    input_cost_per_token: null,
    output_cost_per_token: null,
    context_limit: null,
    interleaved: null,
    status: null,
    experimental: null,
    input_modalities: ["text"],
    output_modalities: ["text"],
    ...overrides,
  };
}

describe("model catalog helpers", () => {
  it("detects text output support from entry output_modalities", () => {
    expect(
      modelHasTextOutput(makeEntry({ output_modalities: ["text"] })),
    ).toBe(true);
    expect(
      modelHasTextOutput(makeEntry({ output_modalities: ["image"] })),
    ).toBe(false);
    expect(
      modelHasTextOutput(makeEntry({ output_modalities: ["text", "image"] })),
    ).toBe(true);
  });

  it("checks required capabilities", () => {
    expect(
      modelMeetsRequiredCapabilities(makeEntry({ reasoning: true, tool_call: true })),
    ).toBe(true);
    expect(
      modelMeetsRequiredCapabilities(makeEntry({ reasoning: false, tool_call: true })),
    ).toBe(false);
    expect(
      modelMeetsRequiredCapabilities(makeEntry({ reasoning: true, tool_call: false })),
    ).toBe(false);
  });

  it("builds catalog model options filtering for required capabilities and text output", () => {
    const entries = [
      makeEntry({
        full_id: "anthropic/claude-sonnet",
        provider_id: "anthropic",
        model_id: "claude-sonnet",
        name: "Claude Sonnet",
        reasoning: true,
        tool_call: true,
        output_modalities: ["text"],
      }),
      makeEntry({
        full_id: "anthropic/no-reasoning",
        provider_id: "anthropic",
        model_id: "no-reasoning",
        name: "No Reasoning",
        reasoning: false,
        tool_call: true,
        output_modalities: ["text"],
      }),
      makeEntry({
        full_id: "anthropic/image-output",
        provider_id: "anthropic",
        model_id: "image-output",
        name: "Image Output",
        reasoning: true,
        tool_call: true,
        output_modalities: ["image"],
      }),
    ];

    const filtered = filterByCapabilities(entries, DEFAULT_CAPABILITY_FILTER);
    const options = getCatalogModelOptions(filtered);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      full_id: "anthropic/claude-sonnet",
      provider_id: "anthropic",
      model_id: "claude-sonnet",
      name: "Claude Sonnet",
      runtimeModelId: "anthropic/claude-sonnet",
    });
  });

  it("filters entries by provider_id", () => {
    const entries = [
      makeEntry({ provider_id: "anthropic", model_id: "claude-1" }),
      makeEntry({ provider_id: "anthropic", model_id: "claude-2" }),
      makeEntry({ provider_id: "openai", model_id: "gpt-4" }),
    ];

    const anthropicEntries = getModelsForProvider(entries, "anthropic");
    expect(anthropicEntries).toHaveLength(2);
    expect(anthropicEntries.every((e) => e.provider_id === "anthropic")).toBe(true);
  });

  it("resolves selected catalog model by full_id", () => {
    const entries = [
      makeEntry({ full_id: "anthropic/claude-sonnet", model_id: "claude-sonnet" }),
      makeEntry({ full_id: "openai/gpt-4", model_id: "gpt-4" }),
    ];

    expect(resolveSelectedCatalogModel(entries, "anthropic/claude-sonnet")).toMatchObject({
      full_id: "anthropic/claude-sonnet",
    });
    expect(resolveSelectedCatalogModel(entries, "unknown/model")).toBeNull();
    expect(resolveSelectedCatalogModel(entries, null)).toBeNull();
  });

  it("returns provider API base URL defaults", () => {
    expect(getProviderBaseUrlDefault("anthropic", "https://api.example")).toBe("https://api.example");
    expect(getProviderBaseUrlDefault("ollama", null)).toBe("http://localhost:11434");
    expect(getProviderBaseUrlDefault("custom", null)).toBeNull();
  });

  it("uses the first env var for the API key label with a provider-name fallback", () => {
    expect(getProviderApiKeyLabel(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"], "Anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(getProviderApiKeyLabel([], "OpenAI")).toBe("OpenAI API key");
  });

  it("filterByCapabilities narrows results when toggles are disabled", () => {
    const entries = [
      makeEntry({
        full_id: "anthropic/claude-sonnet",
        provider_id: "anthropic",
        model_id: "claude-sonnet",
        name: "Claude Sonnet",
        reasoning: true,
        tool_call: true,
        structured_output: true,
        output_modalities: ["text"],
      }),
      makeEntry({
        full_id: "anthropic/no-reasoning",
        provider_id: "anthropic",
        model_id: "no-reasoning",
        name: "No Reasoning",
        reasoning: false,
        tool_call: true,
        structured_output: false,
        output_modalities: ["text"],
      }),
      makeEntry({
        full_id: "anthropic/no-structured",
        provider_id: "anthropic",
        model_id: "no-structured",
        name: "No Structured",
        reasoning: true,
        tool_call: true,
        structured_output: false,
        output_modalities: ["text"],
      }),
    ];

    const allOn = filterByCapabilities(entries, { reasoning: true, tool_call: true, structured_output: true });
    expect(allOn).toHaveLength(1);
    expect(allOn[0].model_id).toBe("claude-sonnet");

    const noStructured = filterByCapabilities(entries, { reasoning: true, tool_call: true, structured_output: false });
    expect(noStructured).toHaveLength(2);
    expect(noStructured.map((e) => e.model_id)).toContain("claude-sonnet");
    expect(noStructured.map((e) => e.model_id)).toContain("no-structured");

    const noReasoning = filterByCapabilities(entries, { reasoning: false, tool_call: true, structured_output: false });
    expect(noReasoning).toHaveLength(3);
  });
});
