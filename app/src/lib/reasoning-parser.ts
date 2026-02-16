/**
 * Parsing helpers for the reasoning step (Step 4).
 * Provides utilities for parsing decisions.md format, used by
 * the ReasoningReview component.
 */

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns a Record of key-value pairs, or null if no frontmatter found.
 *
 * Supports: numbers, quoted/unquoted strings, arrays with "  - " items.
 * Does NOT support: nested objects, booleans, null, multi-line strings, comments.
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  const result: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    if (!key) continue;

    // Handle YAML arrays (lines starting with "  - ")
    if (rawValue === "") {
      const items: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const arrayMatch = lines[j].match(/^\s+-\s+"?([^"]*)"?$/);
        if (arrayMatch) {
          items.push(arrayMatch[1]);
        } else {
          break;
        }
      }
      if (items.length > 0) {
        result[key] = items;
        i += items.length; // Skip processed array lines
      }
      continue;
    }

    // Parse numbers
    const numValue = Number(rawValue);
    if (!isNaN(numValue) && rawValue !== "") {
      result[key] = numValue;
      continue;
    }

    // Strip quotes from strings
    result[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return Object.keys(result).length > 0 ? result : null;
}

type ResponseType = "follow_up" | "summary" | "gate_check" | "unknown";

/**
 * Classify an agent response by its content.
 * Priority: gate_check > follow_up > summary > unknown
 */
export function parseAgentResponseType(text: string): ResponseType {
  if (!text) return "unknown";

  const isGateCheck =
    /ready to proceed|proceed to (?:the )?build|proceed to skill creation/i.test(
      text,
    );
  const hasFollowUp =
    /##\s*follow-up questions/i.test(text) ||
    /\bfollow-up questions?\b/i.test(text);
  const isSummary =
    /what i concluded|assumptions i.?m making|conflicts or tensions/i.test(
      text,
    );

  // Gate check wins if there are no follow-ups (agent is done reasoning)
  if (isGateCheck && !hasFollowUp) return "gate_check";
  // Follow-ups take priority over summary (user must answer before continuing)
  if (hasFollowUp) return "follow_up";
  if (isSummary) return "summary";
  return "unknown";
}

/**
 * Count decision entries (### D1:, ### D2:, etc.) in decisions.md content.
 * Reads from frontmatter `decision_count` first, falls back to regex.
 */
export function countDecisions(content: string): number {
  // Try frontmatter first
  const frontmatter = parseFrontmatter(content);
  if (frontmatter && typeof frontmatter.decision_count === "number") {
    return frontmatter.decision_count;
  }

  // Fall back to regex
  const matches = content.match(/###\s*D\d+:/g);
  return matches ? matches.length : 0;
}
