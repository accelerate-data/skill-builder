export function allTrue(values) {
  return Object.values(values).every((value) => value === true);
}

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const map = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map[key] = value;
  }
  return map;
}

export function assessClarificationsSchema(clarifications) {
  return {
    version: clarifications?.version === "1",
    metadata: Boolean(clarifications?.metadata),
    questionCountNumber: typeof clarifications?.metadata?.question_count === "number",
    sectionCountNumber: typeof clarifications?.metadata?.section_count === "number",
    sectionsArray: Array.isArray(clarifications?.sections),
    notesArray: Array.isArray(clarifications?.notes),
  };
}

export function assessAnswerEvaluationSchema(evaluation) {
  const requiredFields = [
    "total_count",
    "answered_count",
    "empty_count",
    "vague_count",
    "contradictory_count",
    "per_question",
    "verdict",
    "reasoning",
  ];
  const perQuestion = Array.isArray(evaluation?.per_question)
    ? evaluation.per_question
    : [];
  const contradictoryEntries = perQuestion.filter((entry) => entry?.verdict === "contradictory");
  const vagueEntries = perQuestion.filter((entry) => entry?.verdict === "vague");
  return {
    hasRequiredFields: requiredFields.every((field) =>
      Object.prototype.hasOwnProperty.call(evaluation ?? {}, field),
    ),
    verdictValid: ["sufficient", "mixed", "insufficient"].includes(evaluation?.verdict),
    perQuestionArray: Array.isArray(evaluation?.per_question),
    contradictoryEntriesHaveFields: contradictoryEntries.every(
      (entry) =>
        typeof entry?.reason === "string" &&
        entry.reason.trim().length > 0 &&
        typeof entry?.contradicts === "string" &&
        entry.contradicts.trim().length > 0,
    ),
    vagueEntriesHaveReason: vagueEntries.every(
      (entry) => typeof entry?.reason === "string" && entry.reason.trim().length > 0,
    ),
  };
}

export function assessDecisionsCanonical(markdown) {
  const frontmatter = parseFrontmatter(markdown);
  return {
    frontmatter: /^---\n[\s\S]*?\n---/m.test(markdown),
    heading: /^### D\d+:/m.test(markdown),
    originalQuestion: /\*\*Original question:\*\*/.test(markdown),
    decision: /\*\*Decision:\*\*/.test(markdown),
    implication: /\*\*Implication:\*\*/.test(markdown),
    status: /\*\*Status:\*\*/.test(markdown),
    decisionCountField: Object.prototype.hasOwnProperty.call(frontmatter, "decision_count"),
    conflictsResolvedField: Object.prototype.hasOwnProperty.call(frontmatter, "conflicts_resolved"),
    roundField: Object.prototype.hasOwnProperty.call(frontmatter, "round"),
  };
}

export function assessDecisionsJsonSchema(payload) {
  const metadata = payload?.metadata ?? {};
  const decisions = Array.isArray(payload?.decisions) ? payload.decisions : [];
  return {
    version: payload?.version === "1",
    metadataObject: typeof payload?.metadata === "object" && payload?.metadata !== null && !Array.isArray(payload.metadata),
    decisionCountNumber: typeof metadata?.decision_count === "number",
    conflictsResolvedNumber: typeof metadata?.conflicts_resolved === "number",
    roundNumber: typeof metadata?.round === "number",
    decisionsArray: Array.isArray(payload?.decisions),
    decisionsHaveRequiredFields: decisions.every((decision) =>
      typeof decision?.id === "string"
      && typeof decision?.title === "string"
      && typeof decision?.original_question === "string"
      && typeof decision?.decision === "string"
      && typeof decision?.implication === "string"
      && ["resolved", "conflict-resolved", "needs-review"].includes(decision?.status),
    ),
  };
}

export function assessInvocationContracts(expected, observed) {
  const normalize = (value) => {
    const lower = String(value ?? "").toLowerCase().trim();
    if (!lower) return "";
    if (lower.includes("read user-context")) return "read-user-context";
    if (lower.includes("read-user-context")) return "read-user-context";
    if (lower.includes("read:user-context.md")) return "read-user-context";
    if (lower.includes("read:user-context-md")) return "read-user-context";
    if (lower.includes("read decisions")) return "read-decisions";
    if (lower.includes("read decisions.json")) return "read-decisions";
    if (lower.includes("read:decisions.json")) return "read-decisions";
    if (lower.includes("read:decisions-json")) return "read-decisions";
    if (lower.includes("read-decisions-json")) return "read-decisions";
    if (lower.includes("skip-clarifications-read")) return "skip-clarifications-read";
    if (lower.includes("read clarifications")) return "read-clarifications";
    if (lower.includes("invoke-research-skill")) return "invoke-research-skill";
    if (lower.includes("write-research-plan")) return "write-research-plan";
    if (lower.includes("write-clarifications")) return "write-clarifications";
    if (lower.includes("write skill") || lower.includes("write-skill")) return "write-skill";
    if (lower.includes("write:skill.md") || lower.includes("write:skill-md")) return "write-skill";
    if (lower.includes("wrote skill.md") || lower.includes("wrote skill-md")) return "write-skill";
    if (lower.includes("write references")) return "write-references";
    if (lower.startsWith("write-references/")) return "write-references";
    if (lower.startsWith("wrote references/")) return "write-references";
    if (lower.includes("write:references/") || lower.includes("write:references-")) return "write-references";
    if (lower.includes("wrote references/") || lower.includes("wrote references-")) return "write-references";
    if (lower.includes("write-evaluations") || lower.includes("evaluations.md")) return "write-evaluations";
    if (lower.includes("return-evaluations-markdown")) return "write-evaluations";
    if (lower.includes("wrote context/evaluations.md") || lower.includes("wrote context-evaluations-md")) return "write-evaluations";
    if (
      lower.startsWith("write-")
      && !lower.startsWith("write-skill")
      && !lower.startsWith("write-evaluations")
      && !lower.startsWith("write-clarifications")
      && !lower.startsWith("write-research-plan")
    ) {
      return "write-references";
    }
    return lower
      .replace(/[/.]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  };
  const expectedNorm = expected.map(normalize).filter(Boolean);
  const observedNorm = observed.map(normalize).filter(Boolean);
  const observedSet = new Set(observedNorm);
  const expectedSet = new Set(expectedNorm);
  const missing = expectedNorm.filter((value) => !observedSet.has(value));
  const unexpected = observedNorm.filter((value) => !expectedSet.has(value));
  let orderCursor = 0;
  for (const value of observedNorm) {
    if (value === expectedNorm[orderCursor]) orderCursor += 1;
  }
  return {
    invocationPresence: missing.length === 0,
    invocationOrder: orderCursor === expectedNorm.length,
    unexpectedCalls: unexpected,
    missingCalls: missing,
  };
}
