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
  Choice,
} from "@/generated/contracts";
import type { Question as BaseQuestion } from "@/generated/contracts";
import type {
  ClarificationsDto,
  ClarificationQuestionDto,
  ClarificationChoiceDto,
} from "@/generated/contracts";

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

  function countQuestion(q: Question) {
    total++;
    if (isQuestionAnswered(q)) answered++;
    else if (q.must_answer) mustUnanswered++;
    for (const r of q.refinements ?? []) countQuestion(r);
  }

  for (const q of section.questions ?? []) countQuestion(q);
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

/** Normalize a Question tree: ensure every question has a `refinements` array
 *  (agent output may omit it). */
function normalizeQuestion(q: Question): Question {
  return { ...q, refinements: (q.refinements ?? []).map(normalizeQuestion) };
}

/** Convert a ClarificationChoiceDto to a Choice. */
function dtoToChoice(choice: ClarificationChoiceDto): Choice {
  return { id: choice.choice_id, text: choice.text, is_other: choice.is_other };
}

/** Convert a ClarificationQuestionDto (possibly recursive) to a Question. */
function dtoToQuestion(q: ClarificationQuestionDto): Question {
  return {
    id: q.question_id,
    title: q.title,
    text: q.text,
    must_answer: q.must_answer,
    answer_choice: q.answer_choice ?? undefined,
    answer_text: q.answer_text ?? undefined,
    recommendation: q.recommendation ?? undefined,
    answer_verdict: q.answer_verdict ?? undefined,
    answer_verdict_reason: q.answer_verdict_reason ?? undefined,
    choices: q.choices.map(dtoToChoice),
    refinements: (q.refinements ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(dtoToQuestion),
  };
}

/**
 * Convert a ClarificationsDto (DB row) to a ClarificationsFile (JSON schema shape).
 * Use this to feed components that still consume ClarificationsFile.
 */
export function clarificationsDtoToFile(dto: ClarificationsDto): ClarificationsFile {
  const researchNotes: Note[] = dto.notes
    .filter((n) => n.note_type !== "answer_feedback")
    .map((n) => ({ type: n.note_type, title: n.title, body: n.body }));

  const evaluatorNotes: Note[] = dto.notes
    .filter((n) => n.note_type === "answer_feedback")
    .map((n) => ({ type: n.note_type, title: n.title, body: n.body }));

  const sections: Section[] = dto.sections.map((sec) => ({
    id: sec.section_id,
    title: sec.title,
    description: sec.description ?? undefined,
    questions: dto.questions
      .filter((q) => q.section_id === sec.section_id && q.parent_question_id == null)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(dtoToQuestion),
  }));

  return {
    metadata: {
      title: dto.title,
      question_count: dto.question_count,
      section_count: dto.section_count,
      refinement_count: dto.refinement_count,
      must_answer_count: dto.must_answer_count,
      scope_recommendation: dto.scope_recommendation ?? null,
      scope_reason: dto.scope_reason ?? null,
      scope_next_action: dto.scope_next_action ?? null,
      priority_questions: [],
    },
    sections,
    notes: researchNotes,
    answer_evaluator_notes: evaluatorNotes,
  };
}

/** Parse and normalize JSON clarifications from raw file content.
 *  Ensures every question has a `refinements` array and metadata has `priority_questions`. */
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
      sections: (raw.sections ?? []).map((s) => ({
        ...s,
        questions: (s.questions ?? []).map(normalizeQuestion),
      })),
      notes: researchNotes,
      answer_evaluator_notes: migratedEvaluatorNotes,
    };
  } catch {
    return null;
  }
}
