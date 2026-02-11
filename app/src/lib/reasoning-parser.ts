/**
 * Parsing helpers for the autonomous reasoning loop (Step 6).
 * Classifies agent responses and extracts structured data to drive
 * phase transitions in the ReasoningChat component.
 */

export type ResponseType = "follow_up" | "summary" | "gate_check" | "unknown";

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
 */
export function countDecisions(content: string): number {
  const matches = content.match(/###\s*D\d+:/g);
  return matches ? matches.length : 0;
}
