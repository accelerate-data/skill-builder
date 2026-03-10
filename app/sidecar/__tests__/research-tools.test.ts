import { describe, expect, it } from "vitest";
import {
  buildInvalidResearchOutputEnvelope,
  deriveCountsFromResearchOutput,
  normalizePluginResearchResult,
} from "../research-tools.js";

function makeResearchOutput(overrides?: Record<string, unknown>) {
  return {
    version: "1",
    metadata: {
      question_count: 7,
      section_count: 2,
      must_answer_count: 3,
      priority_questions: ["Q1"],
      scope_recommendation: false,
      warning: null,
      error: null,
      research_plan: {
        purpose: "domain",
        domain: "finance",
        topic_relevance: "relevant",
        dimensions_evaluated: 12,
        dimensions_selected: 4,
        dimension_scores: [],
        selected_dimensions: [],
      },
    },
    sections: [],
    notes: [],
    answer_evaluator_notes: [],
    ...overrides,
  };
}

describe("deriveCountsFromResearchOutput", () => {
  it("derives counts from canonical research output", () => {
    const counts = deriveCountsFromResearchOutput(makeResearchOutput());
    expect(counts).toEqual({ question_count: 7, dimensions_selected: 4 });
  });

  it("throws when metadata is missing", () => {
    expect(() =>
      deriveCountsFromResearchOutput({ version: "1", sections: [] }),
    ).toThrow("research_output.metadata must be an object");
  });

  it("throws when counts are not integers", () => {
    const invalid = makeResearchOutput({
      metadata: {
        question_count: "7",
        research_plan: { dimensions_selected: 4 },
      },
    });
    expect(() => deriveCountsFromResearchOutput(invalid)).toThrow(
      "research_output.metadata.question_count must be an integer",
    );
  });
});

describe("normalizePluginResearchResult", () => {
  it("normalizes valid plugin output and returns canonical envelope", () => {
    const envelope = normalizePluginResearchResult({
      research_output: makeResearchOutput(),
      question_count: 7,
      dimensions_selected: 4,
    });
    expect(envelope.status).toBe("research_complete");
    expect(envelope.question_count).toBe(7);
    expect(envelope.dimensions_selected).toBe(4);
  });

  it("rejects mismatched explicit counts", () => {
    expect(() =>
      normalizePluginResearchResult({
        research_output: makeResearchOutput(),
        question_count: 999,
        dimensions_selected: 4,
      }),
    ).toThrow(
      "plugin_result.question_count must match research_output.metadata.question_count",
    );
  });

  it("rejects missing research output object", () => {
    expect(() => normalizePluginResearchResult({ question_count: 1 })).toThrow(
      "plugin_result.research_output must be an object",
    );
  });
});

describe("buildInvalidResearchOutputEnvelope", () => {
  it("returns deterministic minimal fallback envelope", () => {
    const envelope = buildInvalidResearchOutputEnvelope("bad plugin payload");
    expect(envelope.status).toBe("research_complete");
    expect(envelope.question_count).toBe(0);
    expect(envelope.dimensions_selected).toBe(0);
    expect(envelope.research_output.metadata).toMatchObject({
      scope_recommendation: false,
      scope_reason: "bad plugin payload",
      error: {
        code: "invalid_research_output",
        message: "bad plugin payload",
      },
    });
  });
});
