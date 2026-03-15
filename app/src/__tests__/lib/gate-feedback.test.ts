import { describe, it, expect } from "vitest";
import { buildGateFeedbackNotes } from "@/lib/gate-feedback";
import type { AnswerEvaluationOutput, PerQuestionEntry } from "@/lib/types";

function makeEvaluation(perQuestion: PerQuestionEntry[]): AnswerEvaluationOutput {
  return {
    verdict: "mixed",
    answered_count: 3,
    empty_count: 0,
    vague_count: 1,
    contradictory_count: 0,
    total_count: 4,
    reasoning: "Test evaluation",
    per_question: perQuestion,
  };
}

describe("buildGateFeedbackNotes", () => {
  it("returns empty array when all verdicts are clear", () => {
    const eval_ = makeEvaluation([
      { question_id: "q1", verdict: "clear" },
      { question_id: "q2", verdict: "clear" },
    ]);
    expect(buildGateFeedbackNotes(eval_)).toEqual([]);
  });

  it("maps vague verdict to feedback note with fallback body", () => {
    const eval_ = makeEvaluation([
      { question_id: "q1", verdict: "vague" },
    ]);
    const notes = buildGateFeedbackNotes(eval_);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("answer_feedback");
    expect(notes[0].title).toBe("Vague answer: q1");
    expect(notes[0].body).toContain("too general");
  });

  it("maps contradictory verdict with contradicts field", () => {
    const eval_ = makeEvaluation([
      { question_id: "q2", verdict: "contradictory", contradicts: "q1" },
    ]);
    const notes = buildGateFeedbackNotes(eval_);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Contradictory answer: q2");
    expect(notes[0].body).toContain("conflicts with q1");
  });

  it("maps not_answered verdict", () => {
    const eval_ = makeEvaluation([
      { question_id: "q3", verdict: "not_answered" },
    ]);
    const notes = buildGateFeedbackNotes(eval_);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Not answered: q3");
    expect(notes[0].body).toContain("unanswered");
  });

  it("maps needs_refinement verdict", () => {
    const eval_ = makeEvaluation([
      { question_id: "q4", verdict: "needs_refinement" },
    ]);
    const notes = buildGateFeedbackNotes(eval_);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Needs refinement: q4");
    expect(notes[0].body).toContain("more concrete detail");
  });

  it("uses custom reason when provided", () => {
    const eval_ = makeEvaluation([
      { question_id: "q1", verdict: "vague", reason: "Be more specific about the data model." },
    ]);
    const notes = buildGateFeedbackNotes(eval_);
    expect(notes[0].body).toBe("Be more specific about the data model.");
  });

  it("ignores blank reason and uses fallback", () => {
    const eval_ = makeEvaluation([
      { question_id: "q1", verdict: "vague", reason: "   " },
    ]);
    const notes = buildGateFeedbackNotes(eval_);
    expect(notes[0].body).toContain("too general");
  });

  it("filters mixed verdicts, keeping only actionable ones", () => {
    const eval_ = makeEvaluation([
      { question_id: "q1", verdict: "clear" },
      { question_id: "q2", verdict: "vague" },
      { question_id: "q3", verdict: "clear" },
      { question_id: "q4", verdict: "not_answered" },
      { question_id: "q5", verdict: "needs_refinement" },
    ]);
    const notes = buildGateFeedbackNotes(eval_);
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.title)).toEqual([
      "Vague answer: q2",
      "Not answered: q4",
      "Needs refinement: q5",
    ]);
  });

  it("handles empty per_question array", () => {
    const eval_ = makeEvaluation([]);
    expect(buildGateFeedbackNotes(eval_)).toEqual([]);
  });

  it("handles missing per_question (undefined)", () => {
    const eval_ = { ...makeEvaluation([]), per_question: undefined } as unknown as AnswerEvaluationOutput;
    expect(buildGateFeedbackNotes(eval_)).toEqual([]);
  });
});
