import { describe, it, expect } from "vitest";
import { resolveModelId } from "../../lib/models.js";

// Cross-layer parity: these aliases and canonical IDs must match
// resolve_model_id() in app/src-tauri/src/commands/workflow.rs (line ~18).
// If model IDs are bumped in Rust, update the TS map and these assertions.
describe("resolveModelId", () => {
  it("maps sonnet alias to canonical ID", () => {
    expect(resolveModelId("sonnet")).toBe("claude-sonnet-4-6");
  });

  it("maps haiku alias to canonical ID", () => {
    expect(resolveModelId("haiku")).toBe("claude-haiku-4-5");
  });

  it("maps opus alias to canonical ID", () => {
    expect(resolveModelId("opus")).toBe("claude-opus-4-6");
  });

  it("passes through full model IDs unchanged", () => {
    expect(resolveModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(resolveModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(resolveModelId("claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  it("passes through unknown aliases unchanged", () => {
    expect(resolveModelId("unknown-model")).toBe("unknown-model");
    expect(resolveModelId("")).toBe("");
  });
});
