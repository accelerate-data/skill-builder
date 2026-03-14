import { describe, it, expect } from "vitest";
import { parseSidecarConfig } from "../config.js";

describe("parseSidecarConfig", () => {
  it("throws on null", () => {
    expect(() => parseSidecarConfig(null)).toThrow("Invalid SidecarConfig: expected object");
  });

  it("throws on non-object", () => {
    expect(() => parseSidecarConfig("string")).toThrow("Invalid SidecarConfig: expected object");
    expect(() => parseSidecarConfig(42)).toThrow("Invalid SidecarConfig: expected object");
  });

  it("throws when prompt is missing", () => {
    expect(() =>
      parseSidecarConfig({ apiKey: "key", cwd: "/tmp" })
    ).toThrow("Invalid SidecarConfig: missing prompt");
  });

  it("throws when apiKey is missing", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", cwd: "/tmp" })
    ).toThrow("Invalid SidecarConfig: missing apiKey");
  });

  it("throws when apiKey is empty string", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "", cwd: "/tmp" })
    ).toThrow("Invalid SidecarConfig: missing apiKey");
  });

  it("throws when cwd is missing", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key" })
    ).toThrow("Invalid SidecarConfig: missing cwd");
  });

  it("throws when requiredPlugins contains non-string", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", requiredPlugins: [1, 2] })
    ).toThrow("Invalid SidecarConfig: requiredPlugins must be string[]");
  });

  it("accepts valid config with all required fields", () => {
    const result = parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp" });
    expect(result.prompt).toBe("hello");
    expect(result.apiKey).toBe("key");
    expect(result.cwd).toBe("/tmp");
  });

  it("accepts valid config with optional requiredPlugins", () => {
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      cwd: "/tmp",
      requiredPlugins: ["computer", "bash"],
    });
    expect(result.requiredPlugins).toEqual(["computer", "bash"]);
  });

  it("accepts empty string cwd (no strict validation)", () => {
    // cwd is type-checked but not value-validated — empty string passes.
    // Callers are responsible for providing a valid directory.
    const result = parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "" });
    expect(result.cwd).toBe("");
  });

  it("passes through extra unknown fields", () => {
    // The parser casts `raw as SidecarConfig` without stripping extra keys.
    // This is intentional: the sidecar may forward fields to the agent runtime.
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      cwd: "/tmp",
      extraField: "should survive",
    });
    expect((result as Record<string, unknown>).extraField).toBe("should survive");
  });
});
