type JsonObject = Record<string, unknown>;

export type ResearchEnvelope = {
  status: "research_complete";
  dimensions_selected: number;
  question_count: number;
  research_output: JsonObject;
};

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function asInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value as number;
}

/**
 * Deterministically derive envelope counts from canonical research_output.
 */
export function deriveCountsFromResearchOutput(researchOutput: unknown): {
  question_count: number;
  dimensions_selected: number;
} {
  const root = asObject(researchOutput, "research_output");
  const metadata = asObject(root.metadata, "research_output.metadata");
  const researchPlan = asObject(
    metadata.research_plan,
    "research_output.metadata.research_plan",
  );

  return {
    question_count: asInteger(
      metadata.question_count,
      "research_output.metadata.question_count",
    ),
    dimensions_selected: asInteger(
      researchPlan.dimensions_selected,
      "research_output.metadata.research_plan.dimensions_selected",
    ),
  };
}

/**
 * Normalize plugin output into the orchestrator envelope.
 * If explicit counts are present, they must match derived values.
 */
export function normalizePluginResearchResult(
  pluginResult: unknown,
): ResearchEnvelope {
  const payload = asObject(pluginResult, "plugin_result");
  const researchOutput = asObject(payload.research_output, "plugin_result.research_output");
  const derived = deriveCountsFromResearchOutput(researchOutput);

  const explicitQuestionCount = payload.question_count;
  if (explicitQuestionCount !== undefined) {
    const parsed = asInteger(explicitQuestionCount, "plugin_result.question_count");
    if (parsed !== derived.question_count) {
      throw new Error(
        "plugin_result.question_count must match research_output.metadata.question_count",
      );
    }
  }

  const explicitDimensionsSelected = payload.dimensions_selected;
  if (explicitDimensionsSelected !== undefined) {
    const parsed = asInteger(
      explicitDimensionsSelected,
      "plugin_result.dimensions_selected",
    );
    if (parsed !== derived.dimensions_selected) {
      throw new Error(
        "plugin_result.dimensions_selected must match research_output.metadata.research_plan.dimensions_selected",
      );
    }
  }

  return {
    status: "research_complete",
    dimensions_selected: derived.dimensions_selected,
    question_count: derived.question_count,
    research_output: researchOutput,
  };
}

/**
 * Deterministic fallback payload for invalid plugin/tool output.
 */
export function buildInvalidResearchOutputEnvelope(reason: string): ResearchEnvelope {
  return {
    status: "research_complete",
    dimensions_selected: 0,
    question_count: 0,
    research_output: {
      version: "1",
      metadata: {
        question_count: 0,
        section_count: 0,
        must_answer_count: 0,
        priority_questions: [],
        scope_recommendation: false,
        scope_reason: reason,
        warning: null,
        error: {
          code: "invalid_research_output",
          message: reason,
        },
        research_plan: {
          purpose: "",
          domain: "",
          topic_relevance: "not_relevant",
          dimensions_evaluated: 0,
          dimensions_selected: 0,
          dimension_scores: [],
          selected_dimensions: [],
        },
      },
      sections: [],
      notes: [],
      answer_evaluator_notes: [],
    },
  };
}
