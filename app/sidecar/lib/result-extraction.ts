/**
 * Pure utility functions for extracting structured results from agent output.
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

/**
 * Attempts to parse a text block as JSON, stripping markdown code fences
 * (```json ... ``` or ``` ... ```) if present.
 * Returns the parsed value or undefined if parsing fails.
 */
export function tryParseJsonFromText(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}
