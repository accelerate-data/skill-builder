import { describe, expect, it } from "vitest";
import { extractStructuredResultPayload } from "@/lib/agent-results";
import { makeDisplayItem } from "@/test/fixtures";

describe("extractStructuredResultPayload", () => {
  it("returns null when there is no result item", () => {
    const payload = extractStructuredResultPayload([
      makeDisplayItem({ type: "output", outputText: "hello" }),
    ]);

    expect(payload).toBeNull();
  });

  it("returns structuredOutput from the latest result item", () => {
    const structured = { status: "validation_complete", ok: true };
    const payload = extractStructuredResultPayload([
      makeDisplayItem({
        type: "result",
        outputText_result: "{\"status\":\"old\"}",
        structuredOutput: { status: "old" },
      }),
      makeDisplayItem({
        type: "result",
        outputText_result: "Validation complete",
        structuredOutput: structured,
      }),
    ]);

    expect(payload).toEqual(structured);
  });

  it("does not parse outputText_result when structuredOutput is absent", () => {
    const payload = extractStructuredResultPayload([
      makeDisplayItem({
        type: "result",
        outputText_result: "{\"status\":\"validation_complete\"}",
      }),
    ]);

    expect(payload).toBeNull();
  });
});
