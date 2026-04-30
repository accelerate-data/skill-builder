/**
 * Integration test: verifies whether the SDK populates structured_output
 * when outputFormat is passed with a nested JSON schema.
 *
 * This test guards the previously observed upstream SDK bug:
 *   anthropics/claude-agent-sdk-typescript#277
 *
 * Run with ANTHROPIC_API_KEY set:
 *   ANTHROPIC_API_KEY=sk-... npx vitest run __tests__/sdk-output-format.integration.test.ts
 *
 * If the SDK regresses, the "nested schema" test will fail because the app
 * requires structured_output for outputFormat runs.
 */
import { describe, it, expect } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

/** Flat schema — no nested objects. Used as the control. */
const FLAT_SCHEMA = {
  type: "object" as const,
  properties: {
    status: { type: "string" as const },
    count: { type: "number" as const },
  },
  required: ["status", "count"],
  additionalProperties: false,
};

/** Nested schema — contains an object-typed property inside the top-level object.
 *  This shape previously triggered the SDK bug for non-trivial schemas. */
const NESTED_SCHEMA = {
  type: "object" as const,
  properties: {
    status: { type: "string" as const },
    metadata: {
      type: "object" as const,
      properties: {
        count: { type: "number" as const },
        tags: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["count", "tags"],
      additionalProperties: false,
    },
    items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          value: { type: "number" as const },
        },
        required: ["id", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["status", "metadata", "items"],
  additionalProperties: false,
};

async function runQuery(schema: Record<string, unknown>, prompt: string): Promise<{ subtype: string; structured_output: unknown; result: unknown }> {
  let resultMsg: Record<string, unknown> | null = null;

  for await (const msg of query({
    prompt,
    options: {
      model: "claude-haiku-4-5-20251001",
      outputFormat: { type: "json_schema", schema },
      maxTurns: 2,
      permissionMode: "bypassPermissions" as const,
    },
  })) {
    const m = msg as Record<string, unknown>;
    if (m.type === "result") resultMsg = m;
  }

  if (!resultMsg) throw new Error("No result message from SDK");

  return {
    subtype: String(resultMsg.subtype ?? ""),
    structured_output: resultMsg.structured_output,
    result: resultMsg.result,
  };
}

describe.skipIf(!HAS_API_KEY)("SDK outputFormat — structured_output presence (VU-1015)", () => {
  it("populates structured_output for a flat (non-nested) schema", async () => {
    const { subtype, structured_output } = await runQuery(
      FLAT_SCHEMA,
      'Return JSON with status "ok" and count 1.',
    );

    expect(subtype).toBe("success");
    // If this assertion fails, the SDK is broken even for flat schemas.
    expect(structured_output).not.toBeNull();
    expect(structured_output).not.toBeUndefined();
    expect(structured_output).toMatchObject({ status: expect.any(String), count: expect.any(Number) });
  }, 30_000);

  it("populates structured_output for a nested schema", async () => {
    const { subtype, structured_output } = await runQuery(
      NESTED_SCHEMA,
      'Return JSON: status "complete", metadata with count 2 and tags ["a","b"], items [{id:"x",value:1},{id:"y",value:2}].',
    );

    expect(subtype).toBe("success");
    // This is the canary for the upstream SDK bug (anthropics/claude-agent-sdk-typescript#277).
    // If structured_output is null/undefined here, the SDK has regressed and outputFormat
    // runs must fail rather than parse text fallback.
    expect(structured_output).not.toBeNull();
    expect(structured_output).not.toBeUndefined();
    expect(structured_output).toMatchObject({
      status: expect.any(String),
      metadata: {
        count: expect.any(Number),
        tags: expect.any(Array),
      },
      items: expect.any(Array),
    });
  }, 30_000);
});
