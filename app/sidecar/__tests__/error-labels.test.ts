import { describe, it, expect } from "vitest";
import { RESULT_ERROR_LABELS, ASSISTANT_ERROR_LABELS } from "../error-labels.js";

describe("RESULT_ERROR_LABELS", () => {
  it("contains expected error codes", () => {
    expect(RESULT_ERROR_LABELS).toHaveProperty("error_max_turns");
    expect(RESULT_ERROR_LABELS).toHaveProperty("error_max_budget_usd");
    expect(RESULT_ERROR_LABELS).toHaveProperty("error_during_execution");
    expect(RESULT_ERROR_LABELS).toHaveProperty("error_max_structured_output_retries");
    expect(RESULT_ERROR_LABELS).toHaveProperty("error_authentication");
  });

  it("values are non-empty strings", () => {
    for (const val of Object.values(RESULT_ERROR_LABELS)) {
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
    }
  });
});

describe("ASSISTANT_ERROR_LABELS", () => {
  it("contains expected error codes", () => {
    expect(ASSISTANT_ERROR_LABELS).toHaveProperty("authentication_failed");
    expect(ASSISTANT_ERROR_LABELS).toHaveProperty("billing_error");
    expect(ASSISTANT_ERROR_LABELS).toHaveProperty("rate_limit");
    expect(ASSISTANT_ERROR_LABELS).toHaveProperty("invalid_request");
    expect(ASSISTANT_ERROR_LABELS).toHaveProperty("server_error");
  });

  it("values are non-empty strings", () => {
    for (const val of Object.values(ASSISTANT_ERROR_LABELS)) {
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
    }
  });
});
