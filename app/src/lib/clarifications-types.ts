// Schema for clarifications.json — the structured Q&A artifact
// written by the research-orchestrator agent and edited by users in the review step.
//
// Type definitions are generated from Rust contracts.
// Run `cd app/src-tauri && cargo run --bin codegen` to regenerate.

export type {
  ClarificationsFile,
  ClarificationsMetadata,
  ClarificationsWarning,
  ClarificationsError,
  Section,
  Choice,
  Note,
} from "@/generated/contracts";

// Import concrete types needed by helper functions below
import type {
  ClarificationsFile,
  Section,
  Note,
  RefinementsDto,
  ClarificationsDto,
  ClarificationQuestionDto,
} from "@/generated/contracts";
import type { Question as BaseQuestion } from "@/generated/contracts";

/**
 * Extended Question type that includes per-question verdict fields
 * populated by the answer-evaluator gate (stored in the DB, not notes).
 */
export type Question = BaseQuestion & {
  answer_verdict?: string | null;
  answer_verdict_reason?: string | null;
};

/** Extract the recommended choice ID from a recommendation string.
 *  Handles both the current format ("B") and legacy format ("B — rationale text"). */
export function parseRecommendedChoiceId(recommendation: string | null | undefined): string | null {
  if (!recommendation) return null;
  return recommendation.split(/\s*[—–-]\s*/)[0].trim() || null;
}

// Derived helpers

export type SectionStatus = "complete" | "partial" | "blocked";

export function getSectionStatus(section: Section): SectionStatus {
  const { answered, total, mustUnanswered } = getSectionCounts(section);
  if (mustUnanswered > 0) return "blocked";
  if (answered === total) return "complete";
  return "partial";
}

export function getSectionCounts(section: Section) {
  let answered = 0;
  let total = 0;
  let mustUnanswered = 0;

  for (const q of section.questions ?? []) {
    total++;
    if (isQuestionAnswered(q as Question)) answered++;
    else if (q.must_answer) mustUnanswered++;
  }
  return { answered, total, mustUnanswered };
}

export function getTotalCounts(file: ClarificationsFile) {
  let answered = 0;
  let total = 0;
  let mustUnanswered = 0;

  for (const section of file.sections ?? []) {
    const counts = getSectionCounts(section);
    answered += counts.answered;
    total += counts.total;
    mustUnanswered += counts.mustUnanswered;
  }

  return { answered, total, mustUnanswered };
}

export function isQuestionAnswered(q: Question): boolean {
  return (q.answer_choice != null && q.answer_choice !== "") ||
    (q.answer_text != null && q.answer_text.trim() !== "");
}

/** Parse and normalize JSON clarifications from raw file content.
 *  Ensures metadata has `priority_questions`. */
export function parseClarifications(content: string | null): ClarificationsFile | null {
  if (!content) return null;
  try {
    const raw = JSON.parse(content) as ClarificationsFile & {
      answer_evaluator_notes?: Note[];
    };
    const rawNotes = raw.notes ?? [];
    const explicitEvaluatorNotes = Array.isArray(raw.answer_evaluator_notes)
      ? raw.answer_evaluator_notes
      : [];
    const migratedEvaluatorNotes = explicitEvaluatorNotes.length > 0
      ? explicitEvaluatorNotes
      : rawNotes.filter((note) => note.type === "answer_feedback");
    const researchNotes = rawNotes.filter((note) => note.type !== "answer_feedback");

    return {
      ...raw,
      metadata: {
        ...raw.metadata,
        priority_questions: raw.metadata?.priority_questions ?? [],
      },
      sections: raw.sections ?? [],
      notes: researchNotes,
      answer_evaluator_notes: migratedEvaluatorNotes,
    };
  } catch {
    return null;
  }
}

/** Convert a ClarificationsDto (from the DB query) into a ClarificationsFile shape
 *  for display in the editor. */
export function clarificationsDtoToFile(dto: ClarificationsDto): ClarificationsFile {
  return {
    version: dto.version,
    metadata: {
      title: dto.title,
      question_count: dto.question_count,
      section_count: dto.section_count,
      refinement_count: dto.refinement_count,
      must_answer_count: dto.must_answer_count,
      priority_questions: [],
      scope_recommendation: dto.scope_recommendation,
      scope_reason: dto.scope_reason,
      scope_next_action: dto.scope_next_action,
    },
    sections: dto.sections.map((s) => ({
      id: s.section_id,
      title: s.title,
      description: s.description,
      questions: dto.questions
        .filter((q) => q.section_id === s.section_id && !q.parent_question_id)
        .map((q) => questionDtoToQuestion(q)),
    })),
    notes: dto.notes.map((n) => ({
      type: n.note_type,
      title: n.title,
      body: n.body,
    })),
  };
}

function questionDtoToQuestion(q: ClarificationQuestionDto): Question {
  return {
    id: q.question_id,
    title: q.title,
    text: q.text,
    must_answer: q.must_answer,
    choices: q.choices.map((c) => ({
      id: c.choice_id,
      text: c.text,
      is_other: c.is_other,
    })),
    recommendation: q.recommendation,
    answer_choice: q.answer_choice,
    answer_text: q.answer_text,
    answer_verdict: q.answer_verdict,
    answer_verdict_reason: q.answer_verdict_reason,
  };
}

/** Convert a RefinementsDto (from the DB query) into a ClarificationsFile shape
 *  so it can be merged with clarifications for display. */
function refinementsDtoToFile(dto: RefinementsDto): ClarificationsFile {
  return {
    version: dto.version,
    metadata: {
      title: dto.title,
      question_count: dto.question_count,
      section_count: dto.section_count,
      refinement_count: dto.refinement_count,
      must_answer_count: dto.must_answer_count,
      priority_questions: [],
      scope_recommendation: dto.scope_recommendation,
      scope_reason: dto.scope_reason,
      scope_next_action: dto.scope_next_action,
    },
    sections: dto.sections.map((s) => ({
      id: s.section_id,
      title: s.title,
      description: s.description,
      questions: dto.questions
        .filter((q) => q.section_id === s.section_id)
        .map((q) => ({
          id: q.question_id,
          title: q.title,
          text: q.text,
          must_answer: q.must_answer,
          choices: q.choices.map((c) => ({
            id: c.choice_id,
            text: c.text,
            is_other: c.is_other,
          })),
          recommendation: q.recommendation,
          answer_choice: q.answer_choice,
          answer_text: q.answer_text,
        })),
    })),
    notes: dto.notes.map((n) => ({
      type: n.note_type,
      title: n.title,
      body: n.body,
    })),
  };
}

/** Merge clarifications and refinements into a single ClarificationsFile for display.
 *  Refinements appear as a separate "Refinements" section appended at the end. */
export function mergeClarificationsAndRefinements(
  clarifications: ClarificationsFile | null,
  refinements: RefinementsDto | null,
): ClarificationsFile | null {
  if (!clarifications && !refinements) return null;
  if (!clarifications) {
    if (!refinements) return null;
    return refinementsDtoToFile(refinements);
  }
  if (!refinements) return clarifications;

  const refinementFile = refinementsDtoToFile(refinements);

  const mergedSections: Section[] = [
    ...(clarifications.sections ?? []).map((s) => ({ ...s })),
  ];

  const refinementSections = refinementFile.sections ?? [];
  if (refinementSections.length > 0) {
    mergedSections.push({
      id: Date.now(),
      title: "Refinements",
      description: "Detailed follow-up questions from step 1",
      questions: refinementSections.flatMap((s) => s.questions ?? []),
    });
  }

  return {
    ...clarifications,
    sections: mergedSections,
    notes: [...(clarifications.notes ?? []), ...(refinementFile.notes ?? [])],
    metadata: {
      ...clarifications.metadata,
      refinement_count: refinements.refinement_count,
    },
  };
}
