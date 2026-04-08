import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useScopeAdvisor } from "@/hooks/use-scope-advisor"

const writeTextMock = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: writeTextMock },
  writable: true,
  configurable: true,
})

const reviewSkillScopeMock = vi.fn()

vi.mock("@/lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri")
  return {
    ...actual,
    reviewSkillScope: (...args: unknown[]) => reviewSkillScopeMock(...args),
  }
})

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: () => ({ industry: "SaaS" }),
}))

// New response contract: { status, reason, suggested_skills }
const focusedResult = { status: "focused", reason: "Skill is well-scoped.", suggested_skills: [] }
const broadResult = {
  status: "too-broad",
  reason: "Too many domains",
  suggested_skills: [
    { name: "forecasting-churned-customers", description: "Forecasts churn" },
    { name: "analyzing-rep-performance", description: "Analyzes rep perf" },
    { name: "calculating-opportunity-mrr", description: "Calculates MRR" },
  ],
}
const nameImprovementResult = {
  status: "name-needs-improvement",
  reason: "Name is not gerund.",
  suggested_skills: [{ name: "forecasting-revenue", description: "Forecasts revenue" }],
}
const descImprovementResult = {
  status: "description-needs-improvement",
  reason: "Description is vague.",
  suggested_skills: [{ name: "my-skill", description: "Better description here" }],
}
const bothImprovementResult = {
  status: "both-need-improvement",
  reason: "Both name and description need work.",
  suggested_skills: [{ name: "forecasting-revenue", description: "Better description here" }],
}

const defaultCreateOpts = {
  mode: "create" as const,
  skillName: "sales-analysis",
  description: "Analyzes everything.",
  purpose: "domain",
  contextQuestions: "",
}

describe("useScopeAdvisor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("edit mode returns idle status and all no-ops", async () => {
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "edit",
        skillName: "sales-analysis",
        description: "First sentence. Second sentence.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )
    expect(result.current.status).toBe("idle")
    expect(result.current.reason).toBe("")
    expect(result.current.suggestions).toHaveLength(0)
    expect(result.current.currentChipIndex).toBeNull()
    expect(result.current.copiedIndices.size).toBe(0)
    expect(result.current.panelExpanded).toBe(false)

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })
    expect(reviewSkillScopeMock).not.toHaveBeenCalled()
  })

  it("edit mode onChipClick returns empty strings and is a no-op", () => {
    const { result } = renderHook(() =>
      useScopeAdvisor({ mode: "edit", skillName: "x", description: "y", purpose: "z", contextQuestions: "" }),
    )
    let clicked: { name: string; description: string } | undefined
    act(() => {
      clicked = result.current.onChipClick(0)
    })
    expect(clicked).toEqual({ name: "", description: "" })
  })

  it("triggerCheck calls reviewSkillScope with correct args and null for empty contextQuestions", async () => {
    reviewSkillScopeMock.mockResolvedValue(focusedResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "my-skill",
        description: "Forecasts churned customers.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(reviewSkillScopeMock).toHaveBeenCalledWith(
      "my-skill",
      "Forecasts churned customers.",
      "domain",
      null,
      "SaaS",
    )
  })

  it("triggerCheck passes non-empty contextQuestions as string", async () => {
    reviewSkillScopeMock.mockResolvedValue(focusedResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "my-skill",
        description: "Forecasts churned customers.",
        purpose: "domain",
        contextQuestions: "What CRM is being used?",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(reviewSkillScopeMock).toHaveBeenCalledWith(
      "my-skill",
      "Forecasts churned customers.",
      "domain",
      "What CRM is being used?",
      "SaaS",
    )
  })

  it("triggerCheck sets status to 'focused' and clears suggestions when result.status is focused", async () => {
    reviewSkillScopeMock.mockResolvedValue(focusedResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    expect(result.current.status).toBe("idle")

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("focused")
    expect(result.current.suggestions).toHaveLength(0)
    expect(result.current.reason).toBe("Skill is well-scoped.")
  })

  it("triggerCheck sets status to 'too-broad' with suggestions and reason", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("too-broad")
    expect(result.current.suggestions).toHaveLength(3)
    expect(result.current.reason).toBe("Too many domains")
  })

  it("triggerCheck sets status to 'name-needs-improvement' with suggestions", async () => {
    reviewSkillScopeMock.mockResolvedValue(nameImprovementResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("name-needs-improvement")
    expect(result.current.suggestions).toHaveLength(1)
    expect(result.current.reason).toBe("Name is not gerund.")
  })

  it("triggerCheck sets status to 'description-needs-improvement' with suggestions", async () => {
    reviewSkillScopeMock.mockResolvedValue(descImprovementResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("description-needs-improvement")
    expect(result.current.suggestions).toHaveLength(1)
    expect(result.current.reason).toBe("Description is vague.")
  })

  it("triggerCheck sets status to 'both-need-improvement' with suggestions", async () => {
    reviewSkillScopeMock.mockResolvedValue(bothImprovementResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("both-need-improvement")
    expect(result.current.suggestions).toHaveLength(1)
    expect(result.current.reason).toBe("Both name and description need work.")
  })

  it("triggerCheck falls back to 'focused' for unknown status values", async () => {
    reviewSkillScopeMock.mockResolvedValue({ status: "unknown-value", reason: "", suggested_skills: [] })
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("focused")
  })

  it("triggerCheck on error resets status to idle", async () => {
    reviewSkillScopeMock.mockRejectedValue(new Error("network error"))
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("idle")
  })

  it("onChipClick returns correct suggestion, sets currentChipIndex, adds to copiedIndices, sets status to focused", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("too-broad")

    let clicked: { name: string; description: string } | undefined
    act(() => {
      clicked = result.current.onChipClick(1)
    })

    expect(clicked).toEqual({ name: "analyzing-rep-performance", description: "Analyzes rep perf" })
    expect(result.current.currentChipIndex).toBe(1)
    expect(result.current.copiedIndices.has(1)).toBe(true)
    // Chip auto-approves — status becomes focused
    expect(result.current.status).toBe("focused")
  })

  it("onManualFieldEdit resets to idle when chipClickSuppressed is false", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("too-broad")

    act(() => { result.current.onManualFieldEdit() })

    expect(result.current.status).toBe("idle")
    expect(result.current.reason).toBe("")
    expect(result.current.suggestions).toHaveLength(0)
    expect(result.current.currentChipIndex).toBeNull()
    expect(result.current.copiedIndices.size).toBe(0)
  })

  it("onManualFieldEdit suppresses once after onChipClick then resets on next edit", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    // Chip click sets suppression flag and status = "focused"
    act(() => { result.current.onChipClick(0) })
    expect(result.current.status).toBe("focused")

    // First onManualFieldEdit — suppressed (clears flag), stays focused
    act(() => { result.current.onManualFieldEdit() })
    expect(result.current.status).toBe("focused")

    // Second onManualFieldEdit (real user edit) — resets to idle
    act(() => { result.current.onManualFieldEdit() })
    expect(result.current.status).toBe("idle")
  })

  it("onFieldEdit resets state fully to idle", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("too-broad")

    act(() => { result.current.onFieldEdit() })

    expect(result.current.status).toBe("idle")
    expect(result.current.reason).toBe("")
    expect(result.current.suggestions).toHaveLength(0)
    expect(result.current.currentChipIndex).toBeNull()
    expect(result.current.copiedIndices.size).toBe(0)
  })

  it("onFieldEdit clears chip suppression so subsequent onManualFieldEdit resets", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    act(() => { result.current.onChipClick(0) })
    // onFieldEdit clears chip suppression flag
    act(() => { result.current.onFieldEdit() })
    // Now onManualFieldEdit should reset (not suppressed)
    act(() => { result.current.onManualFieldEdit() })
    expect(result.current.status).toBe("idle")
  })

  it("onCopyOne adds index to copiedIndices and writes to clipboard", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    act(() => { result.current.onCopyOne(0) })

    expect(result.current.copiedIndices.has(0)).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith("forecasting-churned-customers: Forecasts churn")
  })

  it("onCopyAll adds all indices to copiedIndices and writes to clipboard", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    act(() => { result.current.onCopyAll() })

    expect(result.current.copiedIndices.size).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(result.current.copiedIndices.has(i)).toBe(true)
    }
    expect(writeTextMock).toHaveBeenCalledOnce()
  })

  it("onTogglePanel toggles panelExpanded", () => {
    const { result } = renderHook(() => useScopeAdvisor(defaultCreateOpts))

    expect(result.current.panelExpanded).toBe(false)
    act(() => { result.current.onTogglePanel() })
    expect(result.current.panelExpanded).toBe(true)
    act(() => { result.current.onTogglePanel() })
    expect(result.current.panelExpanded).toBe(false)
  })

})
