/**
 * evals.ts — Data and Calculation layer for test case management.
 *
 * FP-style: pure functions only. No side effects, no React, no Tauri calls.
 * All Actions (IPC, state mutation) stay in the component layer.
 */

import type { PendingEval, SkillEvalContext, TestCase } from "@/lib/types";

// --- Data ---

export const EMPTY_TEST_CASE: TestCase = {
  id: 0,
  eval_name: "",
  slug: "",
  prompt: "",
  files: [],
  expectations: [""],
};

// --- Path helpers (templates from plugin-paths.json) ---

import pluginPaths from "../../plugin-paths.json";

function resolveTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

export function workspaceSkillDir(workspacePath: string, pluginSlug: string, skillName: string): string {
  return resolveTemplate(pluginPaths.workspace_skill_dir, {
    workspace: workspacePath,
    plugin_slug: pluginSlug,
    skill_name: skillName,
  });
}

// --- Calculations ---

/**
 * Merge queued (not-yet-saved) evals into a skill context so the generator
 * knows about them and avoids duplicating scenarios.
 */
export function mergeQueuedEvals(ctx: SkillEvalContext, queue: TestCase[]): SkillEvalContext {
  return {
    ...ctx,
    existing_evals: [...ctx.existing_evals, ...queue],
  };
}

/**
 * Convert a PendingEval (agent output) into a TestCase with default id/files.
 */
export function pendingToTestCase(pending: PendingEval): TestCase {
  return { id: 0, files: [], ...pending };
}

/**
 * Compute total grading count for an eval run.
 * With comparison mode each eval is graded twice (primary + baseline).
 */
export function totalRunCount(
  evalCount: number,
  runsPerEval: number,
  comparisonMode: string | undefined,
): number {
  return evalCount * runsPerEval * (comparisonMode ? 2 : 1);
}

/**
 * Build the refine pre-fill message from failed eval grading paths.
 * One line per path, blank line between evals.
 */
export function buildRefineMessage(
  failedPaths: Array<{ eval_name: string; grading_paths: string[] }>,
): string {
  return failedPaths
    .map(({ eval_name, grading_paths }) =>
      grading_paths.map((p) => `eval \`${eval_name}\`: ${p}`).join("\n"),
    )
    .join("\n\n");
}

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

