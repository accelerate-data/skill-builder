import { describe, expect, it } from "vitest";
import {
  normalizePromptfooResult,
  normalizePromptfooResults,
} from "../result-normalizer.js";

describe("result normalizer", () => {
  it("normalizes case results from Promptfoo-like output", () => {
    expect(
      normalizePromptfooResult({
        vars: { caseId: "case-1", candidateId: "baseline" },
        success: false,
        score: 0.25,
        response: { output: { text: "actual output" } },
        failureReason: "missing expected phrase",
      }),
    ).toEqual({
      caseId: "case-1",
      candidateId: "baseline",
      passed: false,
      score: 0.25,
      output: { text: "actual output" },
      reason: "missing expected phrase",
    });
  });

  it("summarizes pass and fail counts", () => {
    expect(
      normalizePromptfooResults("performance", [
        {
          vars: { caseId: "case-1", candidateId: "baseline" },
          success: true,
          response: { text: "ok" },
        },
        {
          vars: { caseId: "case-2", candidateId: "baseline" },
          success: false,
          response: { text: "not ok" },
        },
      ]),
    ).toEqual({
      mode: "performance",
      total: 2,
      passed: 1,
      failed: 1,
      results: [
        {
          caseId: "case-1",
          candidateId: "baseline",
          passed: true,
          score: 1,
          output: "ok",
        },
        {
          caseId: "case-2",
          candidateId: "baseline",
          passed: false,
          score: 0,
          output: "not ok",
        },
      ],
    });
  });

  it("requires case and candidate identifiers", () => {
    expect(() =>
      normalizePromptfooResult({
        vars: { caseId: "case-1" },
        success: true,
      }),
    ).toThrow("Promptfoo result missing candidateId");
  });
});
