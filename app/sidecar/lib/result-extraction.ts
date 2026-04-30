/**
 * Pure utility functions for rendering structured results.
 *
 * @module result-extraction
 */

/**
 * Extracts display-ready markdown from a structured output payload.
 * Joins all `*_markdown` string fields with a divider so the frontend
 * never needs to inspect structuredOutput directly.
 */
export function extractResultMarkdown(structuredOutput: unknown): string | undefined {
  if (typeof structuredOutput !== "object" || structuredOutput === null) return undefined;
  const obj = structuredOutput as Record<string, unknown>;
  const sections = Object.entries(obj)
    .filter(([key, val]) => key.endsWith("_markdown") && typeof val === "string" && val.length > 0)
    .map(([, val]) => val as string);
  return sections.length > 0 ? sections.join("\n\n---\n\n") : undefined;
}
