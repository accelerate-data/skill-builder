import { describe, it, expect } from "vitest";
import {
  formatProviderModelId,
  requireSettingsModel,
} from "../../lib/models.js";

describe("Settings model helpers", () => {
  it("passes the selected Settings model through unchanged", () => {
    expect(requireSettingsModel("claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  it("requires a selected Settings model before invoking agents", () => {
    expect(() => requireSettingsModel(null)).toThrow(
      "Select a model in Settings",
    );
    expect(() => requireSettingsModel("")).toThrow(
      "Select a model in Settings",
    );
  });

  it("formats provider IDs without family-specific aliases", () => {
    expect(formatProviderModelId("claude-opus-4-6")).toBe("Claude Opus 4 6");
  });
});
