import type { DateRange } from "@/stores/usage-store"

export const STEP_NAMES: Record<number, string> = {
  [-11]: "Test",
  [-10]: "Refine",
  0: "Research",
  1: "Review",
  2: "Detailed Research",
  3: "Review",
  4: "Confirm Decisions",
  5: "Generate Skill",
}

export const STEP_COLORS: Record<number, string> = {
  [-11]: "var(--color-navy)",
  [-10]: "var(--color-pacific)",
  0: "var(--color-pacific)",
  1: "var(--color-ocean)",
  2: "var(--color-arctic)",
  3: "var(--color-ocean)",
  4: "var(--color-seafoam)",
  5: "var(--color-seafoam)",
}

export const MODEL_COLORS: Record<string, string> = {
  sonnet: "var(--color-ocean)",
  haiku: "var(--color-pacific)",
  opus: "var(--color-navy)",
}

export const DATE_RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: "7d", value: "7d" },
  { label: "14d", value: "14d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
  { label: "All time", value: "all" },
]

export function getStepName(stepId: number): string {
  return STEP_NAMES[stepId] ?? `Step ${stepId}`
}

export function getStepColor(stepId: number): string {
  return STEP_COLORS[stepId] ?? "var(--color-muted-foreground)"
}

export function getModelColor(model: string): string {
  const key = model.toLowerCase()
  if (key.includes("haiku")) return MODEL_COLORS.haiku
  if (key.includes("opus")) return MODEL_COLORS.opus
  if (key.includes("sonnet")) return MODEL_COLORS.sonnet
  return "var(--color-muted-foreground)"
}

export function formatCost(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function formatTokens(count: number): string {
  return count.toLocaleString()
}

export function formatSessionTime(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      + " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

export function formatDayLabel(dateStr: string): string {
  try {
    // dateStr is "YYYY-MM-DD" from SQLite DATE()
    const [, month, day] = dateStr.split("-")
    return `${parseInt(month)}/${parseInt(day)}`
  } catch {
    return dateStr
  }
}

export function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function shortModelName(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes("haiku")) return "Haiku"
  if (lower.includes("opus")) return "Opus"
  if (lower.includes("sonnet")) return "Sonnet"
  return model
}

export type SortCol = "date" | "skill" | "step" | "model" | "cost" | "tokens"
