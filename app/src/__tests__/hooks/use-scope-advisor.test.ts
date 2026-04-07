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
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("edit mode returns idle, LLM never called", () => {
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "edit",
        skillName: "sales-analysis",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )
    expect(result.current.status).toBe("idle")
    act(() => { vi.runAllTimers() })
    expect(reviewSkillScopeMock).not.toHaveBeenCalled()
  })

  it("short description with name and purpose returns hint, no LLM call", () => {
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "my-skill",
        description: "Only one sentence.",
        purpose: "domain",
      }),
    )
    act(() => { vi.runAllTimers() })
    expect(result.current.status).toBe("hint")
    expect(reviewSkillScopeMock).not.toHaveBeenCalled()
  })

  it("two-sentence description with all fields fires LLM after 1500ms", async () => {
    reviewSkillScopeMock.mockResolvedValue(focusedResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "my-skill",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )
    expect(result.current.status).toBe("idle")

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })

    expect(reviewSkillScopeMock).toHaveBeenCalledOnce()
  })

  it("is_too_broad false sets status to focused", async () => {
    reviewSkillScopeMock.mockResolvedValue(focusedResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "my-skill",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })

    expect(result.current.status).toBe("focused")
    expect(result.current.suggestions).toHaveLength(0)
  })

  it("is_too_broad true sets status to too-broad with suggestions", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })

    expect(result.current.status).toBe("too-broad")
    expect(result.current.suggestions).toHaveLength(3)
  })

  it("LLM throws keeps status at idle (silent fail)", async () => {
    reviewSkillScopeMock.mockRejectedValue(new Error("network error"))
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "my-skill",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })

    expect(result.current.status).toBe("idle")
  })

  it("onChipClick returns correct suggestion and sets currentChipIndex", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
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

  it("after chip click, field edit re-arms debounce", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })

    act(() => { result.current.onChipClick(0) })

    reviewSkillScopeMock.mockResolvedValue(focusedResult)
    act(() => { result.current.onFieldEdit() })

    expect(result.current.status).toBe("idle")
  })

  it("hasPendingUncopied is true when too-broad + panelExpanded + some not copied", async () => {
    reviewSkillScopeMock.mockResolvedValue(broadResult)
    const { result } = renderHook(() =>
      useScopeAdvisor({
        mode: "create",
        skillName: "sales-analysis",
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
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
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
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
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
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
        description: "First sentence. Second sentence.",
        purpose: "domain",
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })

    act(() => { result.current.onCopyAll() })

    expect(result.current.copiedIndices.size).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(result.current.copiedIndices.has(i)).toBe(true)
    }
  })
})
