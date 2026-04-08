export interface ScopeAdvisorSuggestion {
  name: string
  description: string
}

export interface ScopeAdvisorResult {
  status: string
  reason: string
  suggested_skills: ScopeAdvisorSuggestion[]
}

export type ScopeAdvisorStatus =
  | "idle"
  | "loading"
  | "focused"
  | "too-broad"
  | "name-needs-improvement"
  | "description-needs-improvement"
  | "both-need-improvement"

/** Banner message for each non-idle, non-loading status */
export const ADVISOR_BANNER: Record<Exclude<ScopeAdvisorStatus, "idle" | "loading">, string> = {
  "focused": "This skill looks focused.",
  "too-broad": "This skill might be too broad. Consider splitting into more focused skills.",
  "name-needs-improvement": "We found better names for this skill.",
  "description-needs-improvement": "We found a clearer description for this skill.",
  "both-need-improvement": "We found better names and descriptions for this skill.",
}

/** Format one suggestion for clipboard: "name: description" */
export function formatSuggestionForClipboard(s: ScopeAdvisorSuggestion): string {
  return `${s.name}: ${s.description}`
}

/** Format all suggestions as newline-joined list */
export function formatAllSuggestionsForClipboard(suggestions: ScopeAdvisorSuggestion[]): string {
  return suggestions.map(formatSuggestionForClipboard).join("\n")
}
