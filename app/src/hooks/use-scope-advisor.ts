import { useState, useRef, useCallback } from "react"
import { useSettingsStore } from "@/stores/settings-store"
import { reviewSkillScope } from "@/lib/tauri"
import {
  formatAllSuggestionsForClipboard,
  formatSuggestionForClipboard,
  type ScopeAdvisorSuggestion,
  type ScopeAdvisorStatus,
} from "@/lib/scope-advisor"

const VALID_STATUSES: ScopeAdvisorStatus[] = [
  "focused", "too-broad", "name-needs-improvement", "description-needs-improvement", "both-need-improvement",
]

interface UseScopeAdvisorOptions {
  mode: "create" | "edit"
  skillName: string
  description: string
  purpose: string
  contextQuestions: string
}

export interface UseScopeAdvisorReturn {
  status: ScopeAdvisorStatus
  reason: string
  suggestions: ScopeAdvisorSuggestion[]
  currentChipIndex: number | null
  copiedIndices: Set<number>
  hasPendingUncopied: boolean
  panelExpanded: boolean
  triggerCheck: () => void
  onChipClick: (index: number) => { name: string; description: string }
  onCopyOne: (index: number) => void
  onCopyAll: () => void
  onTogglePanel: () => void
  onFieldEdit: () => void
  onManualFieldEdit: () => void
}

export function useScopeAdvisor({
  mode,
  skillName,
  description,
  purpose,
  contextQuestions,
}: UseScopeAdvisorOptions): UseScopeAdvisorReturn {
  const { industry } = useSettingsStore()

  const [status, setStatus] = useState<ScopeAdvisorStatus>("idle")
  const [reason, setReason] = useState("")
  const [suggestions, setSuggestions] = useState<ScopeAdvisorSuggestion[]>([])
  const [currentChipIndex, setCurrentChipIndex] = useState<number | null>(null)
  const [copiedIndices, setCopiedIndices] = useState<Set<number>>(new Set())
  const [panelExpanded, setPanelExpanded] = useState(false)

  const chipClickSuppressed = useRef(false)

  const hasPendingUncopied =
    panelExpanded &&
    status === "too-broad" &&
    suggestions.some((_, i) => !copiedIndices.has(i))

  const triggerCheck = useCallback(() => {
    if (mode === "edit") return

    console.log("[scope-advisor] triggerCheck called", { skillName, description, purpose, contextQuestions })

    setStatus("loading")
    reviewSkillScope(skillName, description, purpose, contextQuestions || null, industry || null)
      .then((result) => {
        console.log("[scope-advisor] result", result)
        const resolvedStatus = VALID_STATUSES.includes(result.status as ScopeAdvisorStatus)
          ? (result.status as ScopeAdvisorStatus)
          : "focused"
        setReason(result.reason ?? "")
        if (resolvedStatus === "focused") {
          setSuggestions([])
        } else {
          setSuggestions(result.suggested_skills)
        }
        setStatus(resolvedStatus)
      })
      .catch((err) => {
        console.error("[scope-advisor] failed", err)
        setStatus("idle")
      })
  }, [mode, skillName, description, purpose, contextQuestions, industry])

  const onChipClick = useCallback(
    (index: number): { name: string; description: string } => {
      chipClickSuppressed.current = true
      setCurrentChipIndex(index)
      setCopiedIndices((prev) => new Set([...prev, index]))
      // The LLM already judged this suggestion as focused — auto-pass it
      // so clicking Validate again doesn't re-run a redundant check.
      setStatus("focused")
      const s = suggestions[index]
      return { name: s.name, description: s.description }
    },
    [suggestions],
  )

  const onCopyOne = useCallback(
    (index: number) => {
      const s = suggestions[index]
      if (s) {
        navigator.clipboard.writeText(formatSuggestionForClipboard(s)).catch(() => {})
      }
      setCopiedIndices((prev) => new Set([...prev, index]))
    },
    [suggestions],
  )

  const onCopyAll = useCallback(() => {
    navigator.clipboard.writeText(formatAllSuggestionsForClipboard(suggestions)).catch(() => {})
    setCopiedIndices(new Set(suggestions.map((_, i) => i)))
  }, [suggestions])

  const onTogglePanel = useCallback(() => {
    setPanelExpanded((prev) => !prev)
  }, [])

  const onFieldEdit = useCallback(() => {
    chipClickSuppressed.current = false
    setStatus("idle")
    setReason("")
    setSuggestions([])
    setCurrentChipIndex(null)
    setCopiedIndices(new Set())
  }, [])

  // Called by individual field onChange handlers. Ignores the edit if it
  // originated from a chip click (chip fills name+description programmatically).
  const onManualFieldEdit = useCallback(() => {
    if (chipClickSuppressed.current) {
      chipClickSuppressed.current = false
      return
    }
    setStatus("idle")
    setReason("")
    setSuggestions([])
    setCurrentChipIndex(null)
    setCopiedIndices(new Set())
  }, [])

  if (mode === "edit") {
    return {
      status: "idle" as ScopeAdvisorStatus,
      reason: "",
      suggestions: [],
      currentChipIndex: null,
      copiedIndices: new Set(),
      hasPendingUncopied: false,
      panelExpanded: false,
      triggerCheck: () => {},
      onChipClick: () => ({ name: "", description: "" }),
      onCopyOne: () => {},
      onCopyAll: () => {},
      onTogglePanel: () => {},
      onFieldEdit: () => {},
      onManualFieldEdit: () => {},
    }
  }

  return {
    status,
    reason,
    suggestions,
    currentChipIndex,
    copiedIndices,
    hasPendingUncopied,
    panelExpanded,
    triggerCheck,
    onChipClick,
    onCopyOne,
    onCopyAll,
    onTogglePanel,
    onFieldEdit,
    onManualFieldEdit,
  }
}
