// Schema for clarifications.json — the structured Q&A artifact
// written by the research-orchestrator agent and edited by users in the review step.

export interface ClarificationsFile {
  version: "1";
  metadata: ClarificationsMetadata;
  sections: Section[];
  notes: Note[]; // research notes from research/detailed-research
  answer_evaluator_notes?: Note[]; // gate feedback notes from answer-evaluator
}

export interface ClarificationsWarning {
  code: "scope_guard_triggered" | "all_dimensions_low_score";
  message: string;
}

export interface ClarificationsError {
  code: "missing_user_context" | "invalid_research_output";
  message: string;
}

export interface ClarificationsMetadata {
  title: string;
  question_count: number;
  section_count: number;
  refinement_count: number;
  must_answer_count: number;
  priority_questions: string[];
  duplicates_removed?: number;
  scope_recommendation?: boolean;
  scope_reason?: string;
  scope_next_action?: string;
  research_plan?: ClarificationsResearchPlan;
  warning?: ClarificationsWarning;
  error?: ClarificationsError;
}

export interface ClarificationsResearchPlanDimensionScore {
  name: string;
  score: number;
  reason: string;
  focus: string;
}

export interface ClarificationsResearchPlanSelectedDimension {
  name: string;
  focus: string;
}

export interface ClarificationsResearchPlan {
  purpose: string;
  domain: string;
  topic_relevance: string;
  dimensions_evaluated: number;
  dimensions_selected: number;
  dimension_scores: ClarificationsResearchPlanDimensionScore[];
  selected_dimensions: ClarificationsResearchPlanSelectedDimension[];
}

export interface Section {
  id: number;
  title: string;
  description?: string;
  questions: Question[];
}

export interface Question {
  id: string; // "Q1", "R1.1", "R12.1a"
  title: string;
  must_answer: boolean;
  text: string;
  consolidated_from?: string[];
  choices: Choice[];
  recommendation?: string | null; // recommended choice ID, e.g. "B" (may also be legacy "B — rationale")
  answer_choice: string | null; // "A"/"B"/... | "custom" | null
  answer_text: string | null; // freeform text
  refinements: Question[]; // recursive, same shape
}

/** Extract the recommended choice ID from a recommendation string.
 *  Handles both the current format ("B") and legacy format ("B — rationale text"). */
export function parseRecommendedChoiceId(recommendation: string | null | undefined): string | null {
  if (!recommendation) return null;
  return recommendation.split(/\s*[—–-]\s*/)[0].trim() || null;
}

export interface Choice {
  id: string; // "A", "B", "C", "D", "E"
  text: string;
  is_other: boolean; // true for "Other (please specify)"
}

export interface Note {
  type: string; // "inconsistency" | "blocked" | "deferred" | "critical_gap" | "flag" — agents may produce any type
  title: string;
  body: string;
}

interface LegacyDimension {
  id?: string;
  name?: string;
  description?: string;
  priority?: string;
  questions?: string[];
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
    for (const r of q.refinements) countQuestion(r);
  }

  for (const q of section.questions) countQuestion(q);
  return { answered, total, mustUnanswered };
}

export function getTotalCounts(file: ClarificationsFile) {
  let answered = 0;
  let total = 0;
  let mustUnanswered = 0;

  for (const section of file.sections) {
    const counts = getSectionCounts(section);
    answered += counts.answered;
    total += counts.total;
    mustUnanswered += counts.mustUnanswered;
  }

  return { answered, total, mustUnanswered };
}

export function isQuestionAnswered(q: Question): boolean {
  return q.answer_choice !== null || (q.answer_text !== null && q.answer_text.trim() !== "");
}

/** Normalize a Question tree: ensure every question has a `refinements` array
 *  (agent output may omit it). */
function normalizeQuestion(q: Question): Question {
  return { ...q, refinements: (q.refinements ?? []).map(normalizeQuestion) };
}

/** Parse and normalize JSON clarifications from raw file content.
 *  Ensures every question has a `refinements` array and metadata has `priority_questions`. */
export function parseClarifications(content: string | null): ClarificationsFile | null {
  if (!content) return null;
  try {
    const raw = JSON.parse(content) as ClarificationsFile & {
      dimensions?: LegacyDimension[];
      clarifications?: { dimensions?: LegacyDimension[] };
      metadata?: ClarificationsMetadata & {
        domain?: string;
        skill_name?: string;
        scope_recommendation?: boolean;
        scope_reason?: string;
        scope_next_action?: string;
      };
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

    const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
    const rawQuestionCount = rawSections.reduce((count, section) => {
      const sectionQuestions = (section as { questions?: unknown[] }).questions;
      const questions = Array.isArray(sectionQuestions) ? sectionQuestions : [];
      return count + questions.length;
    }, 0);
    const legacyDimensions = Array.isArray(raw.dimensions)
      ? raw.dimensions
      : (Array.isArray(raw.clarifications?.dimensions) ? raw.clarifications.dimensions : []);

    // Back-compat: some older or non-canonical research flows write
    // `dimensions[]` with string questions. Convert to canonical shape so
    // Step 0/1 can still render and edit questions.
    if (rawQuestionCount === 0 && legacyDimensions.length > 0) {
      const convertedSections: Section[] = legacyDimensions.map((d, sectionIndex) => {
        const sectionId = sectionIndex + 1;
        const sourceQuestions = Array.isArray(d.questions)
          ? d.questions
          : (Array.isArray((d as { clarifications_needed?: string[] }).clarifications_needed)
              ? (d as { clarifications_needed?: string[] }).clarifications_needed ?? []
              : []);
        return {
          id: sectionId,
          title: d.name || `Section ${sectionIndex + 1}`,
          description: d.description,
          questions: sourceQuestions.map((questionText, questionIndex) => ({
            id: `Q${questionIndex + 1}`,
            title: questionText,
            must_answer: false,
            text: questionText,
            choices: [],
            recommendation: null,
            answer_choice: null,
            answer_text: null,
            refinements: [],
          })),
        };
      });

      const questionCount = convertedSections.reduce((count, section) => count + section.questions.length, 0);
      return {
        version: "1",
        metadata: {
          title: raw.metadata?.domain || raw.metadata?.skill_name || "Clarifications",
          question_count: questionCount,
          section_count: convertedSections.length,
          refinement_count: 0,
          must_answer_count: 0,
          priority_questions: [],
          scope_recommendation: !!raw.metadata?.scope_recommendation,
          duplicates_removed: 0,
        },
        sections: convertedSections,
        notes: researchNotes,
        answer_evaluator_notes: migratedEvaluatorNotes,
      };
    }

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
