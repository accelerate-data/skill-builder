/**
 * Promptfoo provider for scope advisor smoke tests.
 *
 * Tests the prompt quality of the review_skill_scope Tauri command by sending
 * the exact same prompt the Rust command builds to Sonnet via `claude -p`.
 * Uses Claude Code's existing session auth — no ANTHROPIC_API_KEY required.
 */

import { spawnSync } from "node:child_process";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

function hasApiAccess() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.FORCE_PLUGIN_TESTS || CLAUDE_BIN);
}

/**
 * Build the exact prompt the Rust `review_skill_scope` command sends to Sonnet.
 * Keep in sync with app/src-tauri/src/commands/skill/scope_review.rs.
 */
function buildScopeReviewPrompt({ skillName, description, purpose, industry, documentContext }) {
  const industryContext = industry
    ? `\nIndustry context: ${industry}`
    : "";
  const docContext = documentContext
    ? `\n\n## Reference Documents\n\n${documentContext}`
    : "";

  return `You are evaluating whether a Claude skill is well-defined. These skills are used to build data warehouses and lakehouses — OLAP systems, not OLTP. The data source is valuable context but not compulsory.

CORE TEST: Does the description describe exactly the process named by the skill? If yes → focused. If it wanders into a second process → fail.

## Name rule
A good name uses the gerund pattern: verb-ing + specific object (kebab-case).
Pass: forecasting-churned-customers, validating-grain-feed-compliance
Fail: sales-analysis (not gerund), analyzing-data (object too vague)

## Description rule
A good description serves ONE overarching process — the same process named by the skill.
Number of nouns does not matter — many nouns are fine if they all fall under one process.
Pass: validating-grain-feed-compliance covers quality testing + traceability docs + supplier audits → all serve one process → pass
Fail: description spans two distinct processes → split
Always fail: nouns from different business functions → split
Use general business knowledge for process boundaries. Uploaded documents can override.

## Four cases — pick exactly one status and follow its action

CASE 1 — name fails (not gerund OR too vague), description is already specific and focused → status: "name-needs-improvement"
Name fails when: not gerund (e.g. sales-analysis, procurement-process), or gerund but object too vague (e.g. analyzing-data)
Description must be good: specific nouns, one process, clear trigger
Example: name=sales-analysis, desc="Forecasts which customers are at risk of churning based on CRM health scores" → name not gerund, description already focused
Action: derive the correct gerund name from the description. Return exactly 1 suggestion with new name + ORIGINAL description unchanged.
Reason: state why name fails and that description was kept as-is.
NOTE: if description is also vague, use CASE 3 instead.

CASE 2 — the skill covers a recognizable business domain that spans multiple distinct processes → status: "too-broad"
This applies even if the description does not explicitly list the sub-processes. If the name or description references a broad business function (e.g. recruitment, sales, procurement, supply chain) and you can infer from business knowledge what distinct processes it covers, it is too-broad — not vague.
Example A: name=sales-analysis, description="Analyzes revenue, pipeline health, and rep performance" (explicitly lists processes)
Example B: name=understand-recruitment-processes, description="understand recruitment processes of the company" (umbrella term — you can infer hiring, onboarding, interview scheduling, etc.)
Action: split into 3-5 focused skills. Anchor suggested names to the original name where possible.
Reason: name the distinct processes found (whether explicitly listed or inferred).

CASE 3 — both name and description are so vague that you cannot identify even the business domain → status: "both-need-improvement"
The name and description give no signal about what area of the business is involved. You cannot infer sub-processes because there is no domain anchor.
Example: name=analyzing-data, description="Analyzes data for the team" — data about what? Which team? No domain signal at all.
Action: make 3-5 best-guess suggestions.
Reason: be transparent — state that both are too vague and suggestions may not match intent.
KEY DISTINCTION: if you can name the business domain (recruitment, sales, procurement, etc.) → use CASE 2 (too-broad). Only use CASE 3 when the domain itself is unclear.

CASE 4 — name is focused, description wanders into one or more extra processes → status: "description-needs-improvement"
Example: name=forecasting-churned-customers, description="Forecasts churn risk and tracks renewal pipeline health"
Action: produce 1 suggestion per process found — (1) original name + description trimmed to match, then one additional suggestion per stray process (new gerund name + description for each).
Reason: name each stray process found.

Use industry and document context to override a generic breadth signal.

Skill to evaluate:
- Name: ${skillName}
- Description: ${description}
- Purpose: ${purpose}${industryContext}${docContext}

All suggested names MUST use the gerund pattern: verb-ing + specific object (kebab-case).
Gerund examples: forecasting-churned-customers ✓ vs churn-forecast ✗, analyzing-rep-performance ✓ vs rep-performance-analysis ✗

Rules for names: present-participle verb + specific object, kebab-case, no generic nouns (data/metrics/analysis), no acronyms unless industry-standard (mrr, arr, crm).

Rules for suggested descriptions: third person, one overarching process, specific nouns, one trigger (no OR listing). Each suggested description must itself pass the same evaluation criteria.

Respond in English only.

Respond with JSON only (no markdown fences, no extra text):
{"status": string, "reason": string, "suggested_skills": [{"name": string, "description": string}]}`;
}

function callSonnet(promptText) {
  const env = { ...process.env, CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined };
  const result = spawnSync(
    CLAUDE_BIN,
    ["-p", "--model", process.env.SCOPE_ADVISOR_MODEL ?? "claude-sonnet-4-6"],
    {
      input: promptText,
      encoding: "utf8",
      env,
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.error) throw new Error(`claude process error: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    throw new Error(`claude exited ${result.status}: ${stderr || stdout || "(no output)"}`);
  }
  const text = (result.stdout ?? "").trim();
  // Strip markdown fences if the model wrapped its response
  return text
    .replace(/^```json\n?/, "")
    .replace(/^```\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

/** Returns true if name starts with a gerund word (ends in -ing) followed by at least one kebab segment */
function isGerundName(name) {
  // e.g. forecasting-churned-customers, analyzing-rep-performance
  return /^[a-z]+ing(-[a-z0-9]+)+$/.test(name);
}

/** Returns true if name is ASCII lowercase + hyphens only (no non-English characters) */
function isEnglishKebab(name) {
  return /^[a-z-]+$/.test(name);
}

function finalizeScenario(scenario, contracts) {
  const failures = Object.entries(contracts)
    .filter(([, v]) => v !== true)
    .map(([k]) => k);
  return { scenario, ok: failures.length === 0, ...contracts, failures };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(raw, scenario) {
  try {
    return { parsed: JSON.parse(raw), parseSuccess: true };
  } catch {
    return { parsed: null, parseSuccess: false };
  }
}

// ---------------------------------------------------------------------------
// Scenario handlers — four evaluation cases + focused + context-override + non-english
// ---------------------------------------------------------------------------

/**
 * Case 2: both name and description span multiple distinct processes.
 * Expected: status="too-broad", 3–5 split suggestions, all gerund-named.
 */
function runTooBroad() {
  const prompt = buildScopeReviewPrompt({
    skillName: "sales-analysis",
    description:
      "Analyzes revenue trends, sales rep performance, pipeline health, and customer churn. " +
      "Uses Salesforce CRM and Marketo data to generate reports across all commercial functions.",
    purpose: "domain",
    industry: null,
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  const { parsed, parseSuccess } = parseResult(raw, "scope-advisor-too-broad");
  if (!parseSuccess) return finalizeScenario("scope-advisor-too-broad", { parseSuccess: false });
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  const allGerund = suggestions.length > 0 && suggestions.every((s) => isGerundName(s.name));
  return finalizeScenario("scope-advisor-too-broad", {
    parseSuccess: true,
    statusIsString: typeof parsed.status === "string",
    statusIsTooBoard: parsed.status === "too-broad",
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
    suggestedSkillsArray: Array.isArray(parsed.suggested_skills),
    suggestionCountAtLeastThree: suggestions.length >= 3,
    allNamesGerund: allGerund,
  });
}

/**
 * Case 1: name not gerund, description already focused.
 * Expected: status="name-needs-improvement", exactly 1 suggestion, original description preserved.
 */
function runNameNeedsImprovement() {
  const originalDescription =
    "Forecasts which customers are at risk of churning based on Salesforce health scores. " +
    "Use when the customer success team needs a prioritised list of at-risk accounts.";
  const prompt = buildScopeReviewPrompt({
    skillName: "sales-analysis",
    description: originalDescription,
    purpose: "domain",
    industry: "SaaS",
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  const { parsed, parseSuccess } = parseResult(raw, "scope-advisor-name-needs-improvement");
  if (!parseSuccess) return finalizeScenario("scope-advisor-name-needs-improvement", { parseSuccess: false });
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  const oneSuggestion = suggestions.length === 1;
  const suggestionGerund = oneSuggestion && isGerundName(suggestions[0].name);
  const descriptionPreserved = oneSuggestion && suggestions[0].description === originalDescription;
  return finalizeScenario("scope-advisor-name-needs-improvement", {
    parseSuccess: true,
    statusIsNameNeedsImprovement: parsed.status === "name-needs-improvement",
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
    exactlyOneSuggestion: oneSuggestion,
    suggestionNameIsGerund: suggestionGerund,
    originalDescriptionPreserved: descriptionPreserved,
  });
}

/**
 * Case 4: name focused and gerund, description wanders into a second process.
 * Expected: status="description-needs-improvement", 2+ suggestions (one per process).
 */
function runDescriptionNeedsImprovement() {
  const prompt = buildScopeReviewPrompt({
    skillName: "forecasting-churned-customers",
    description:
      "Forecasts which customers are at risk of churning based on health scores " +
      "and tracks renewal pipeline health across enterprise accounts.",
    purpose: "domain",
    industry: "SaaS",
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  const { parsed, parseSuccess } = parseResult(raw, "scope-advisor-description-needs-improvement");
  if (!parseSuccess) return finalizeScenario("scope-advisor-description-needs-improvement", { parseSuccess: false });
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  const allGerund = suggestions.length > 0 && suggestions.every((s) => isGerundName(s.name));
  return finalizeScenario("scope-advisor-description-needs-improvement", {
    parseSuccess: true,
    statusIsDescriptionNeedsImprovement: parsed.status === "description-needs-improvement",
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
    atLeastTwoSuggestions: suggestions.length >= 2,
    allNamesGerund: allGerund,
  });
}

/**
 * Case 3: both name and description so vague that the business domain itself is unclear.
 * Expected: status="both-need-improvement", 3–5 suggestions, caveat in reason.
 */
function runBothNeedImprovement() {
  const prompt = buildScopeReviewPrompt({
    skillName: "analyzing-data",
    description: "Analyzes data for the team.",
    purpose: "domain",
    industry: null,
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  const { parsed, parseSuccess } = parseResult(raw, "scope-advisor-both-need-improvement");
  if (!parseSuccess) return finalizeScenario("scope-advisor-both-need-improvement", { parseSuccess: false });
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  const allGerund = suggestions.length > 0 && suggestions.every((s) => isGerundName(s.name));
  return finalizeScenario("scope-advisor-both-need-improvement", {
    parseSuccess: true,
    statusIsBothNeedImprovement: parsed.status === "both-need-improvement",
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
    suggestionCountAtLeastThree: suggestions.length >= 3,
    allNamesGerund: allGerund,
  });
}

/**
 * Focused: both name and description pass all rules.
 * Expected: status="focused", empty suggested_skills.
 */
function runFocused() {
  const prompt = buildScopeReviewPrompt({
    skillName: "forecasting-churned-customers",
    description:
      "Forecasts which customers are at risk of churning based on Salesforce activity signals " +
      "and health scores. Use when the customer success team needs a prioritised list of at-risk accounts.",
    purpose: "domain",
    industry: "SaaS",
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  const { parsed, parseSuccess } = parseResult(raw, "scope-advisor-focused");
  if (!parseSuccess) return finalizeScenario("scope-advisor-focused", { parseSuccess: false });
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  return finalizeScenario("scope-advisor-focused", {
    parseSuccess: true,
    statusIsFocused: parsed.status === "focused",
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
    emptySuggestions: suggestions.length === 0,
  });
}

/**
 * Context override: description looks broad generically but a reference document
 * establishes it as one tightly scoped workflow. Expected: status="focused".
 */
function runContextOverride() {
  const prompt = buildScopeReviewPrompt({
    skillName: "reporting-arr-waterfall",
    description: "Reports on revenue metrics and growth for the finance team.",
    purpose: "domain",
    industry: "SaaS",
    documentContext:
      "### ARR Reporting Standards\n" +
      "In this company, revenue metrics refers exclusively to the ARR waterfall report: " +
      "new ARR, expansion ARR, contraction ARR, and churned ARR. This is a single weekly report " +
      "produced from Salesforce Opportunities data. No other revenue concepts are in scope.",
  });
  const raw = callSonnet(prompt);
  const { parsed, parseSuccess } = parseResult(raw, "scope-advisor-context-override");
  if (!parseSuccess) return finalizeScenario("scope-advisor-context-override", { parseSuccess: false });
  return finalizeScenario("scope-advisor-context-override", {
    parseSuccess: true,
    contextOverrideWorks: parsed.status === "focused",
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
  });
}

/**
 * Non-English input (French): all suggested names must be English gerund kebab-case.
 */
function runNonEnglish() {
  const prompt = buildScopeReviewPrompt({
    skillName: "analyse-des-ventes",
    description:
      "Analyse les tendances de revenus, les performances des représentants commerciaux, " +
      "la santé du pipeline et le taux de désabonnement des clients.",
    purpose: "domain",
    industry: null,
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  const { parsed, parseSuccess } = parseResult(raw, "scope-advisor-non-english");
  if (!parseSuccess) return finalizeScenario("scope-advisor-non-english", { parseSuccess: false });
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  const allEnglish = suggestions.every((s) => isEnglishKebab(s.name));
  const allGerund = suggestions.length > 0 && suggestions.every((s) => isGerundName(s.name));
  return finalizeScenario("scope-advisor-non-english", {
    parseSuccess: true,
    statusNotFocused: parsed.status !== "focused",
    hasSuggestions: suggestions.length >= 3,
    allNamesEnglish: allEnglish,
    allNamesGerund: allGerund,
  });
}

// ---------------------------------------------------------------------------
// Provider export
// ---------------------------------------------------------------------------

const scenarioHandlers = {
  "scope-advisor-too-broad": runTooBroad,
  "scope-advisor-name-needs-improvement": runNameNeedsImprovement,
  "scope-advisor-description-needs-improvement": runDescriptionNeedsImprovement,
  "scope-advisor-both-need-improvement": runBothNeedImprovement,
  "scope-advisor-focused": runFocused,
  "scope-advisor-context-override": runContextOverride,
  "scope-advisor-non-english": runNonEnglish,
};

export default class ScopeAdvisorProvider {
  id() {
    return "scope-advisor-smoke";
  }

  async callApi(prompt, context) {
    if (!hasApiAccess()) {
      return {
        error:
          "Missing API auth. Set ANTHROPIC_API_KEY or FORCE_PLUGIN_TESTS=1 before running scope advisor smoke tests.",
      };
    }

    const scenario = String(context?.vars?.scenario ?? prompt ?? "").trim();
    const handler = scenarioHandlers[scenario];
    if (!handler) {
      return {
        error: `Unknown scenario '${scenario}'. Expected one of: ${Object.keys(scenarioHandlers).join(", ")}`,
      };
    }

    try {
      const result = handler();
      return { output: JSON.stringify(result) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
