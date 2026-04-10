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
 * Attempts to parse JSON from a text block. Tries in order:
 * 1. Direct JSON.parse (text is pure JSON)
 * 2. Strip wrapping code fences (```json ... ``` or ``` ... ```)
 * 3. Extract a fenced JSON code block from surrounding text (e.g. preamble
 *    before ```json\n{...}\n```) — handles the common case where the agent
 *    wraps structured output in explanatory markdown
 * 4. Extract the first top-level JSON object ({...}) from the text
 *
 * Returns the parsed value or undefined if no valid JSON is found.
 */
export function tryParseJsonFromText(text: string): unknown {
  // 1. Direct parse
  try {
    return JSON.parse(text.trim());
  } catch {
    // continue
  }

  // 2. Entire text is a code-fenced block
  const stripped = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  if (stripped !== text.trim()) {
    try {
      return JSON.parse(stripped);
    } catch {
      // continue
    }
  }

  // 3. Extract fenced JSON block from surrounding text
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 4. Extract first top-level JSON object by brace-matching
  const startIdx = text.indexOf("{");
  if (startIdx !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(startIdx, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  return undefined;
}
