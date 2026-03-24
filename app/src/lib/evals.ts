/**
 * evals.ts — Data and Calculation layer for test case management.
 *
 * FP-style: pure functions only. No side effects, no React, no Tauri calls.
 * All Actions (IPC, state mutation) stay in the component layer.
 */

import type { SkillEvalContext, TestCase } from "@/lib/types";

// --- Data ---

export const EMPTY_TEST_CASE: TestCase = {
  id: 0,
  eval_name: "",
  slug: "",
  prompt: "",
  files: [],
  expectations: [""],
};

// --- Calculations ---

/**
 * Generate a URL-safe slug from a display name.
 * Lowercases, collapses non-alphanumeric runs to "-", trims leading/trailing dashes.
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Truncate a prompt string to `maxLen` characters for list display.
 * Appends "…" when truncated.
 */
export function truncatePrompt(prompt: string, maxLen = 60): string {
  if (prompt.length <= maxLen) return prompt;
  return prompt.slice(0, maxLen) + "…";
}

/**
 * Apply a name change to the form, auto-generating the slug on create.
 * On edit (isEdit=true) the slug is left unchanged.
 */
export function applyNameChange(form: TestCase, name: string, isEdit: boolean): TestCase {
  return {
    ...form,
    eval_name: name,
    slug: isEdit ? form.slug : toSlug(name),
  };
}

/**
 * Update a single expectation at `idx`, leaving all others unchanged.
 */
export function applyExpectationChange(form: TestCase, idx: number, value: string): TestCase {
  const expectations = [...form.expectations];
  expectations[idx] = value;
  return { ...form, expectations };
}

/**
 * Append an empty expectation row to the form.
 */
export function addExpectation(form: TestCase): TestCase {
  return { ...form, expectations: [...form.expectations, ""] };
}

/**
 * Remove the expectation at `idx`.
 */
export function removeExpectation(form: TestCase, idx: number): TestCase {
  return {
    ...form,
    expectations: form.expectations.filter((_, i) => i !== idx),
  };
}

/**
 * Validate the test case form.
 * Returns an error message string if invalid, or null if the form is ready to save.
 */
export function validateTestCaseForm(form: TestCase): string | null {
  if (!form.eval_name.trim()) {
    return "Eval name is required.";
  }
  const nonEmpty = form.expectations.filter((e) => e.trim());
  if (nonEmpty.length === 0) {
    return "At least one expectation is required.";
  }
  return null;
}

/**
 * Prepare form data for persistence: filters out blank expectation rows.
 */
export function prepareForSave(form: TestCase): TestCase {
  return {
    ...form,
    expectations: form.expectations.filter((e) => e.trim()),
  };
}

/**
 * Return the display label for an iteration badge.
 * The highest-numbered iteration is labelled "latest"; others are "#N".
 */
export function iterationLabel(iteration: number, latestIteration: number): string {
  return iteration === latestIteration ? "latest" : `#${iteration}`;
}

/**
 * Derive a skill-aware placeholder string for the eval intent input.
 * Parses the `description:` field from the skill's YAML frontmatter and
 * returns a concrete example like "e.g. <scenario derived from description>".
 * Falls back to a generic placeholder when the description cannot be parsed.
 */
export function suggestEvalPlaceholder(skillContent: string): string {
  const frontmatterMatch = skillContent.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (frontmatterMatch) {
    const descMatch = frontmatterMatch[1].match(/^description:\s*(.+)/m);
    if (descMatch) {
      const description = descMatch[1].trim().replace(/^["']|["']$/g, "");
      // Take text up to the first period, semicolon, or 80 chars
      const firstClause = description.split(/[.;]/)[0].trim();
      const truncated = firstClause.length > 80 ? firstClause.slice(0, 80) + "…" : firstClause;
      return `e.g. ${truncated}`;
    }
  }
  return "e.g. a user runs a typical workflow end-to-end";
}

/**
 * Build the prompt sent to the skill-evals-generator agent (Mode 1: generate from intent).
 * Pure function — no side effects.
 */
export function buildEvalGenPrompt(
  ctx: SkillEvalContext,
  skillName: string,
  skillsPath: string,
  userIntent: string,
): string {
  const existingNames = ctx.existing_evals.length > 0
    ? ctx.existing_evals.map((e) => `- ${e.eval_name}`).join("\n")
    : "None yet.";

  const skillContent = ctx.skill_content.trim() || "(no SKILL.md found — infer from skill name)";

  return `You are generating one eval (test case) for the "${skillName}" Claude skill.

## Skill Definition

${skillContent}

## Existing Evals (do NOT duplicate these scenarios)

${existingNames}

## Scenario to Evaluate

${userIntent}

## Task

Generate exactly 1 eval that covers the scenario above.

Write the eval as a JSON file to \`${skillsPath}/${skillName}/evals/pending-eval.json\` with this exact structure:

\`\`\`json
{
  "eval_name": "<short descriptive name, 3-6 words>",
  "slug": "<kebab-case of eval_name>",
  "prompt": "<realistic user task prompt, 1-3 sentences>",
  "expectations": [
    "<atomic verifiable assertion 1>",
    "<atomic verifiable assertion 2>"
  ]
}
\`\`\`

Rules:
- The scenario must differ from all existing evals listed above
- The prompt must be a concrete, realistic request a user would send
- Include 2–4 expectations; each must be a single, objectively verifiable statement
- Write ONLY the JSON file — no other output, no explanation
`;
}

/**
 * Build the prompt sent to the skill-evals-generator agent (Mode 2: re-generate from updated intent).
 * Used when the user edits the intent and clicks the refresh button.
 * Pure function — no side effects.
 */
export function buildRegenPrompt(
  intent: string,
  skillContent: string,
  skillName: string,
  skillsPath: string,
): string {
  const content = skillContent.trim() || "(no SKILL.md found — infer from skill name)";

  return `You are re-generating an eval (test case) for the "${skillName}" Claude skill based on an updated scenario intent.

## Skill Definition

${content}

## Updated Scenario Intent

${intent}

## Task

Generate exactly 1 eval that covers the updated scenario above.

Write the eval as a JSON file to \`${skillsPath}/${skillName}/evals/pending-eval.json\` with this exact structure:

\`\`\`json
{
  "eval_name": "<short descriptive name, 3-6 words>",
  "slug": "<kebab-case of eval_name>",
  "prompt": "<realistic user task prompt, 1-3 sentences>",
  "expectations": [
    "<atomic verifiable assertion 1>",
    "<atomic verifiable assertion 2>"
  ]
}
\`\`\`

Rules:
- The prompt must be a concrete, realistic request a user would send for the scenario above
- Include 2–4 expectations; each must be a single, objectively verifiable statement
- Write ONLY the JSON file — no other output, no explanation
`;
}
