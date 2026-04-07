export interface ScopeAdvisorSuggestion {
  name: string
  description: string
}

export interface ScopeAdvisorResult {
  is_too_broad: boolean
  reason: string
  suggested_skills: ScopeAdvisorSuggestion[]
}

export type ScopeAdvisorStatus =
  | "idle"
  | "loading"
  | "focused"
  | "too-broad"

/** Format one suggestion for clipboard: "name: description" */
export function formatSuggestionForClipboard(s: ScopeAdvisorSuggestion): string {
  return `${s.name}: ${s.description}`
}

/** Format all suggestions as newline-joined list */
export function formatAllSuggestionsForClipboard(suggestions: ScopeAdvisorSuggestion[]): string {
  return suggestions.map(formatSuggestionForClipboard).join("\n")
}
