/**
 * Promptfoo provider for scope advisor smoke tests.
 *
 * Tests the prompt quality of the review_skill_scope Tauri command by calling
 * the Anthropic API directly with the exact same prompt the Rust command builds.
 * Each scenario is a single-turn API call — no agent loop, no Claude CLI.
 */

import Anthropic from "@anthropic-ai/sdk";

function hasApiAccess() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.FORCE_PLUGIN_TESTS);
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

  return `You are evaluating whether a Claude skill is too broad.

A skill is too broad when its description touches more than one distinct domain object.

Examples:
- "analyzes revenue, headcount, and marketing spend" → three unrelated domain objects → too broad
- "forecasts churned customers using CRM data" → one domain object → focused

Use industry and document context to override a generic breadth signal. If the documents show that a topic in this company is one tightly scoped workflow, it may be focused — not broad.

Skill to evaluate:
- Name: ${skillName}
- Description: ${description}
- Purpose: ${purpose}${industryContext}${docContext}

When is_too_broad is true, suggest 3-5 focused replacements. All suggested names MUST use the gerund pattern: verb-ing + object (kebab-case).

Gerund naming examples (correct vs incorrect):
- forecasting-churned-customers ✓ vs churn-forecast ✗
- calculating-opportunity-mrr ✓ vs opportunity-mrr-calculation ✗
- analyzing-rep-performance ✓ vs rep-performance-analysis ✗
- segmenting-enterprise-accounts ✓ vs enterprise-account-segmentation ✗

Rules for names:
- Start with a present-participle verb (forecasting, calculating, analyzing, segmenting, tracking, reporting)
- Follow with a specific object — not a generic noun like data, metrics, analysis
- Kebab-case throughout
- No acronyms unless industry-standard (e.g. mrr, arr, crm)

Respond in English only.

Respond with JSON only (no markdown fences, no extra text):
{"is_too_broad": boolean, "reason": string, "suggested_skills": [{"name": string, "description": string}]}`;
}

async function callSonnet(promptText) {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: promptText }],
  });
  const text = (message.content[0].text ?? "").trim();
  // Strip markdown fences if the model wrapped its response
  return text
    .replace(/^```json\n?/, "")
    .replace(/^```\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

/** Returns true if name matches the gerund kebab-case pattern: verb-ing + at-least-one-segment */
function isGerundName(name) {
  return /^[a-z]+-ing(-[a-z0-9]+)+$/.test(name);
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
async function runTooBroad() {
  const prompt = buildScopeReviewPrompt({
    skillName: "sales-analysis",
    description:
      "Analyzes revenue trends, sales rep performance, pipeline health, and customer churn. " +
      "Uses Salesforce CRM and Marketo data to generate reports across all commercial functions.",
    purpose: "domain",
    industry: null,
    documentContext: null,
  });
  const raw = await callSonnet(prompt);
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
async function runFocused() {
  const prompt = buildScopeReviewPrompt({
    skillName: "forecasting-churned-customers",
    description:
      "Forecasts which customers are at risk of churning based on Salesforce activity signals " +
      "and health scores. Outputs a ranked list of at-risk accounts for the customer success team to action.",
    purpose: "domain",
    industry: "SaaS",
    documentContext: null,
  });
  const raw = await callSonnet(prompt);
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
async function runContextOverride() {
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
  const raw = await callSonnet(prompt);
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
async function runGerundNames() {
  const prompt = buildScopeReviewPrompt({
    skillName: "sales-analysis",
    description:
      "Analyzes revenue, headcount changes, marketing spend effectiveness, and customer " +
      "churn rates across all business units.",
    purpose: "domain",
    industry: null,
    documentContext: null,
  });
  const raw = await callSonnet(prompt);
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
async function runNonEnglish() {
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
  const raw = await callSonnet(prompt);
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
      const result = await handler();
      return { output: JSON.stringify(result) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
