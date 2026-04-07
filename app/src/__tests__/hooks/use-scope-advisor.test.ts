import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

const focusedResult = { is_too_broad: false, reason: "Focused skill", suggested_skills: [] }
const broadResult = {
  is_too_broad: true,
  reason: "Too many domains",
  suggested_skills: [
    { name: "forecasting-churned-customers", description: "Forecasts churn" },
    { name: "analyzing-rep-performance", description: "Analyzes rep perf" },
    { name: "calculating-opportunity-mrr", description: "Calculates MRR" },
  ],
}

describe("useScopeAdvisor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("edit mode returns idle, triggerCheck is a no-op", async () => {
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
    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })
    expect(reviewSkillScopeMock).not.toHaveBeenCalled()
  })

  it("triggerCheck calls reviewSkillScope with correct args including contextQuestions", async () => {
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

  it("triggerCheck sets status to loading then focused when is_too_broad false", async () => {
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

    expect(result.current.status).toBe("idle")

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("focused")
    expect(result.current.suggestions).toHaveLength(0)
  })

  it("triggerCheck sets status to too-broad with suggestions when is_too_broad true", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "Analyzes everything.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("too-broad")
    expect(result.current.suggestions).toHaveLength(3)
  })

  it("triggerCheck on error sets status back to idle", async () => {
    reviewSkillScopeMock.mockRejectedValue(new Error("network error"))
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

    expect(result.current.status).toBe("idle")
  })

  it("onFieldEdit after check resets state to idle", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "Analyzes everything.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    expect(result.current.status).toBe("too-broad")

    act(() => { result.current.onFieldEdit() })

    expect(result.current.status).toBe("idle")
    expect(result.current.suggestions).toHaveLength(0)
    expect(result.current.currentChipIndex).toBeNull()
    expect(result.current.copiedIndices.size).toBe(0)
  })

  it("onChipClick returns correct suggestion and sets currentChipIndex", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "Analyzes everything.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    let clicked: { name: string; description: string } | undefined
    act(() => {
      clicked = result.current.onChipClick(1)
    })

    expect(clicked).toEqual({ name: "analyzing-rep-performance", description: "Analyzes rep perf" })
    expect(result.current.currentChipIndex).toBe(1)
    expect(reviewSkillScopeMock).toHaveBeenCalledOnce()
  })

  it("hasPendingUncopied is true when too-broad + panelExpanded + some not copied", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "Analyzes everything.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    act(() => { result.current.onTogglePanel() })

    expect(result.current.hasPendingUncopied).toBe(true)
  })

  it("onCopyOne adds index to copiedIndices", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "Analyzes everything.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    act(() => { result.current.onTogglePanel() })
    act(() => { result.current.onCopyOne(0) })

    expect(result.current.copiedIndices.has(0)).toBe(true)
  })

  it("hasPendingUncopied is false when all copied", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "Analyzes everything.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    act(() => { result.current.onTogglePanel() })
    act(() => { result.current.onCopyAll() })

    expect(result.current.hasPendingUncopied).toBe(false)
  })

  it("onCopyAll adds all indices to copiedIndices", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "Analyzes everything.",
        purpose: "domain",
        contextQuestions: "",
      }),
    )

    await act(async () => {
      result.current.triggerCheck()
      await Promise.resolve()
    })

    act(() => { result.current.onCopyAll() })

    expect(result.current.copiedIndices.size).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(result.current.copiedIndices.has(i)).toBe(true)
    }
  })

  it("empty contextQuestions passes null to reviewSkillScope", async () => {
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
})
