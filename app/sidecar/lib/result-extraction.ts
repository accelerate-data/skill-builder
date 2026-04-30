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

/**
 * Extracts a JSON value from runtime text output.
 *
 * Coding-agent runtimes do not all support provider-native structured output.
 * The one-shot boundary therefore accepts JSON returned as plain text, including
 * fenced JSON preceded by short narration. Validation stays in the typed Rust
 * workflow materializers.
 */
export function extractJsonFromText(text: string): unknown | undefined {
  const fullText = parseJson(text);
  if (fullText !== undefined) return fullText;

  for (const candidate of fencedJsonCandidates(text)) {
    const parsed = parseJson(candidate);
    if (parsed !== undefined) return parsed;
  }

  for (const candidate of balancedJsonCandidates(text)) {
    const parsed = parseJson(candidate);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text.trim());
  } catch {
    return undefined;
  }
}

function fencedJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fencePattern = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    candidates.push(match[1] ?? "");
  }
  return candidates.sort((a, b) => b.length - a.length);
}

function balancedJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const openers = new Set(["{", "["]);
  const matching: Record<string, string> = { "{": "}", "[": "]" };

  for (let start = 0; start < text.length; start += 1) {
    const first = text[start];
    if (!openers.has(first)) continue;

    const stack: string[] = [matching[first]];
    let inString = false;
    let escaped = false;

    for (let idx = start + 1; idx < text.length; idx += 1) {
      const char = text[idx];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (openers.has(char)) {
        stack.push(matching[char]);
      } else if (char === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          candidates.push(text.slice(start, idx + 1));
          break;
        }
      }
    }
  }

  return candidates.sort((a, b) => b.length - a.length);
}
