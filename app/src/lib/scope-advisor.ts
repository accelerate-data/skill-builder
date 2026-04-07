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
  | "hint"
  | "loading"
  | "focused"
  | "too-broad"

/** Returns true if text has fewer than 2 sentences. */
export function isShortDescription(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  const matches = trimmed.match(/[.!?](\s|$)/g)
  const count = matches ? matches.length : 0
  return count < 2
}

/** Format one suggestion for clipboard: "name: description" */
export function formatSuggestionForClipboard(s: ScopeAdvisorSuggestion): string {
  return `${s.name}: ${s.description}`
}

/** Format all suggestions as newline-joined list */
export function formatAllSuggestionsForClipboard(suggestions: ScopeAdvisorSuggestion[]): string {
  return suggestions.map(formatSuggestionForClipboard).join("\n")
}
