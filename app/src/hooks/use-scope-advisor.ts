import { useState, useEffect, useRef, useCallback } from "react"
import { useSettingsStore } from "@/stores/settings-store"
import { reviewSkillScope } from "@/lib/tauri"
import {
  isShortDescription,
  formatAllSuggestionsForClipboard,
  formatSuggestionForClipboard,
  type ScopeAdvisorSuggestion,
  type ScopeAdvisorStatus,
} from "@/lib/scope-advisor"

interface UseScopeAdvisorOptions {
  mode: "create" | "edit"
  skillName: string
  description: string
  purpose: string
}

export interface UseScopeAdvisorReturn {
  status: ScopeAdvisorStatus
  suggestions: ScopeAdvisorSuggestion[]
  currentChipIndex: number | null
  copiedIndices: Set<number>
  hasPendingUncopied: boolean
  panelExpanded: boolean
  onChipClick: (index: number) => { name: string; description: string }
  onCopyOne: (index: number) => void
  onCopyAll: () => void
  onTogglePanel: () => void
  onFieldEdit: () => void
}

export function useScopeAdvisor({
  mode,
  skillName,
  description,
  purpose,
}: UseScopeAdvisorOptions): UseScopeAdvisorReturn {
  const { industry } = useSettingsStore()

  const [status, setStatus] = useState<ScopeAdvisorStatus>("idle")
  const [suggestions, setSuggestions] = useState<ScopeAdvisorSuggestion[]>([])
  const [currentChipIndex, setCurrentChipIndex] = useState<number | null>(null)
  const [copiedIndices, setCopiedIndices] = useState<Set<number>>(new Set())
  const [panelExpanded, setPanelExpanded] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chipClickSuppressed = useRef(false)
  const prevStatusRef = useRef<ScopeAdvisorStatus>("idle")

  const hasPendingUncopied =
    panelExpanded &&
    status === "too-broad" &&
    suggestions.some((_, i) => !copiedIndices.has(i))

  const armDebounce = useCallback(
    (name: string, desc: string, purp: string, ind: string | null) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        if (!name || !desc || !purp) return
        if (isShortDescription(desc)) return

        setStatus("loading")
        try {
          const result = await reviewSkillScope(name, desc, purp, ind)
          if (result.is_too_broad) {
            setSuggestions(result.suggested_skills)
            setStatus("too-broad")
          } else {
            setSuggestions([])
            setStatus("focused")
          }
        } catch (err) {
          console.error("[scope-advisor]", err)
          setStatus(prevStatusRef.current)
        }
      }, 1500)
    },
    [],
  )

  useEffect(() => {
    prevStatusRef.current = status
  }, [status])

  useEffect(() => {
    if (mode === "edit") return
    if (chipClickSuppressed.current) return

    if (!skillName && !purpose) {
      setStatus("idle")
      return
    }

    if (isShortDescription(description) && (skillName || purpose)) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setStatus("hint")
      return
    }

    if (skillName && description && purpose) {
      armDebounce(skillName, description, purpose, industry)
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [mode, skillName, description, purpose, industry, armDebounce])

  const onChipClick = useCallback(
    (index: number): { name: string; description: string } => {
      chipClickSuppressed.current = true
      setCurrentChipIndex(index)
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
    setSuggestions([])
    setCurrentChipIndex(null)
    setCopiedIndices(new Set())
  }, [])

  if (mode === "edit") {
    return {
      status: "idle",
      suggestions: [],
      currentChipIndex: null,
      copiedIndices: new Set(),
      hasPendingUncopied: false,
      panelExpanded: false,
      onChipClick: () => ({ name: "", description: "" }),
      onCopyOne: () => {},
      onCopyAll: () => {},
      onTogglePanel: () => {},
      onFieldEdit: () => {},
    }
  }

  return {
    status,
    suggestions,
    currentChipIndex,
    copiedIndices,
    hasPendingUncopied,
    panelExpanded,
    onChipClick,
    onCopyOne,
    onCopyAll,
    onTogglePanel,
    onFieldEdit,
  }
}
