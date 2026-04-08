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

CASE 1 — name too broad/vague, description fits one process → status: "name-needs-improvement"
Example: name=sales-analysis, description="Forecasts which customers are at risk of churning"
Action: derive the correct gerund name DIRECTLY from the description. Return exactly 1 suggestion.
Reason: explain the name does not reflect the process already in the description.

CASE 2 — both name and description span multiple distinct processes → status: "too-broad"
Example: name=sales-analysis, description="Analyzes revenue, pipeline health, and rep performance"
Action: split into 3-5 focused skills. Anchor suggested names to the original name where possible.
Reason: name the distinct processes found.

CASE 3 — both name and description too vague to identify a clear process → status: "both-need-improvement"
Example: name=analyzing-data, description="Analyzes sales metrics for the team"
Action: make 3-5 best-guess suggestions.
Reason: state that both are too vague and suggestions may not match intent.

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
      timeout: 60_000,
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
// Scenario handlers
// ---------------------------------------------------------------------------

/**
 * Clearly broad skill: covers revenue, pipeline health, rep performance, churn.
 * Expected: is_too_broad true, 3–5 suggestions, all contracts pass.
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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return finalizeScenario("scope-advisor-too-broad", { parseSuccess: false });
  }
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  return finalizeScenario("scope-advisor-too-broad", {
    parseSuccess: true,
    isTooBooadBoolean: typeof parsed.is_too_broad === "boolean",
    isToooBroad: parsed.is_too_broad === true,
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
    suggestedSkillsArray: Array.isArray(parsed.suggested_skills),
    suggestionCountAtLeastThree: suggestions.length >= 3,
  });
}

/**
 * Clearly focused skill: single domain object, single data source.
 * Expected: is_too_broad false, empty suggested_skills array.
 */
function runFocused() {
  const prompt = buildScopeReviewPrompt({
    skillName: "forecasting-churned-customers",
    description:
      "Forecasts which customers are at risk of churning based on Salesforce activity signals " +
      "and health scores. Outputs a ranked list of at-risk accounts for the customer success team to action.",
    purpose: "domain",
    industry: "SaaS",
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return finalizeScenario("scope-advisor-focused", { parseSuccess: false });
  }
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  return finalizeScenario("scope-advisor-focused", {
    parseSuccess: true,
    isTooBooadBoolean: typeof parsed.is_too_broad === "boolean",
    isFocused: parsed.is_too_broad === false,
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
    suggestedSkillsArray: Array.isArray(parsed.suggested_skills),
    emptyArray: suggestions.length === 0,
  });
}

/**
 * Skill that looks broad generically ("revenue metrics") but a reference document
 * establishes it as one tightly scoped workflow in this company (ARR waterfall only).
 * Expected: business context overrides generic signal → is_too_broad false.
 */
function runContextOverride() {
  const prompt = buildScopeReviewPrompt({
    skillName: "reporting-arr-waterfall",
    description:
      "Reports on revenue metrics and growth for the finance team.",
    purpose: "domain",
    industry: "SaaS",
    documentContext:
      "### ARR Reporting Standards\n" +
      "In this company, revenue metrics refers exclusively to the ARR waterfall report: " +
      "new ARR, expansion ARR, contraction ARR, and churned ARR. This is a single weekly report " +
      "produced from Salesforce Opportunities data. No other revenue concepts (headcount costs, " +
      "marketing spend, gross margin) are in scope for this report.",
  });
  const raw = callSonnet(prompt);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return finalizeScenario("scope-advisor-context-override", { parseSuccess: false });
  }
  return finalizeScenario("scope-advisor-context-override", {
    parseSuccess: true,
    isTooBooadBoolean: typeof parsed.is_too_broad === "boolean",
    contextOverrideWorks: parsed.is_too_broad === false,
    reasonNonEmpty: typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
  });
}

/**
 * Broad skill: asserts every suggested name uses the gerund verb-ing + object pattern.
 * Separates naming-convention compliance from the too-broad judgment itself.
 */
function runGerundNames() {
  const prompt = buildScopeReviewPrompt({
    skillName: "sales-analysis",
    description:
      "Analyzes revenue, headcount changes, marketing spend effectiveness, and customer " +
      "churn rates across all business units.",
    purpose: "domain",
    industry: null,
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return finalizeScenario("scope-advisor-gerund-names", { parseSuccess: false });
  }
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  const allGerund = suggestions.length > 0 && suggestions.every((s) => isGerundName(s.name));
  const allKebab = suggestions.every((s) => isEnglishKebab(s.name));
  return finalizeScenario("scope-advisor-gerund-names", {
    parseSuccess: true,
    isToooBroad: parsed.is_too_broad === true,
    hasSuggestions: suggestions.length >= 3,
    allNamesGerund: allGerund,
    allNamesKebab: allKebab,
  });
}

/**
 * Non-English input (French): name and description in French.
 * Expected: prompt instructs English-only response; all suggested names must be
 * English gerund kebab-case slugs (no French characters, no non-ASCII).
 */
function runNonEnglish() {
  const prompt = buildScopeReviewPrompt({
    skillName: "analyse-des-ventes",
    description:
      "Analyse les tendances de revenus, les performances des représentants commerciaux, " +
      "la santé du pipeline et le taux de désabonnement des clients. " +
      "Couvre l'ensemble des fonctions commerciales avec des données Salesforce et Marketo.",
    purpose: "domain",
    industry: null,
    documentContext: null,
  });
  const raw = callSonnet(prompt);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return finalizeScenario("scope-advisor-non-english", { parseSuccess: false });
  }
  const suggestions = Array.isArray(parsed.suggested_skills) ? parsed.suggested_skills : [];
  const allEnglish = suggestions.every((s) => isEnglishKebab(s.name));
  const allGerund = suggestions.length > 0 && suggestions.every((s) => isGerundName(s.name));
  return finalizeScenario("scope-advisor-non-english", {
    parseSuccess: true,
    isTooBooadBoolean: typeof parsed.is_too_broad === "boolean",
    isToooBroad: parsed.is_too_broad === true,
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
  "scope-advisor-focused": runFocused,
  "scope-advisor-context-override": runContextOverride,
  "scope-advisor-gerund-names": runGerundNames,
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
