import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import ScopeAdvisor from "@/components/scope-advisor"
import type { UseScopeAdvisorReturn } from "@/hooks/use-scope-advisor"
import type { ScopeAdvisorSuggestion } from "@/lib/scope-advisor"

const defaultSuggestions: ScopeAdvisorSuggestion[] = [
  { name: "forecasting-churned-customers", description: "Forecasts churn rates" },
  { name: "analyzing-rep-performance", description: "Analyzes rep metrics" },
  { name: "calculating-opportunity-mrr", description: "Calculates MRR from opportunities" },
]

function makeAdvisorState(overrides: Partial<UseScopeAdvisorReturn> = {}): UseScopeAdvisorReturn {
  return {
    status: "idle",
    suggestions: [],
    currentChipIndex: null,
    copiedIndices: new Set(),
    hasPendingUncopied: false,
    panelExpanded: false,
    onChipClick: vi.fn().mockReturnValue({ name: "", description: "" }),
    onCopyOne: vi.fn(),
    onCopyAll: vi.fn(),
    onTogglePanel: vi.fn(),
    onFieldEdit: vi.fn(),
    ...overrides,
  }
}

describe("ScopeAdvisor", () => {
  it("idle: renders nothing", () => {
    const { container } = render(
      <ScopeAdvisor advisorState={makeAdvisorState({ status: "idle" })} onChipSelect={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("hint: shows hint text", () => {
    render(
      <ScopeAdvisor advisorState={makeAdvisorState({ status: "hint" })} onChipSelect={vi.fn()} />,
    )
    expect(screen.getByText("Add more detail to your description to get scope feedback.")).toBeInTheDocument()
  })

  it("loading: shows checking scope text", () => {
    render(
      <ScopeAdvisor advisorState={makeAdvisorState({ status: "loading" })} onChipSelect={vi.fn()} />,
    )
    expect(screen.getByText("Checking scope...")).toBeInTheDocument()
  })

  it("focused: shows focused message", () => {
    render(
      <ScopeAdvisor advisorState={makeAdvisorState({ status: "focused" })} onChipSelect={vi.fn()} />,
    )
    expect(screen.getByText("✓ This skill looks focused.")).toBeInTheDocument()
  })

  it("too-broad collapsed: shows advisory banner, no suggestion chips", () => {
    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: false,
        })}
        onChipSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/This skill might be too broad/)).toBeInTheDocument()
    expect(screen.queryByText("forecasting-churned-customers")).not.toBeInTheDocument()
  })

  it("too-broad expanded: shows all suggestion chips", () => {
    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: true,
        })}
        onChipSelect={vi.fn()}
      />,
    )
    expect(screen.getByText("forecasting-churned-customers")).toBeInTheDocument()
    expect(screen.getByText("analyzing-rep-performance")).toBeInTheDocument()
    expect(screen.getByText("calculating-opportunity-mrr")).toBeInTheDocument()
    expect(screen.getByText("Forecasts churn rates")).toBeInTheDocument()
  })

  it("chip click calls onChipClick and onChipSelect prop", async () => {
    const user = userEvent.setup()
    const onChipClickMock = vi.fn().mockReturnValue({ name: "forecasting-churned-customers", description: "Forecasts churn rates" })
    const onChipSelect = vi.fn()

    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: true,
          onChipClick: onChipClickMock,
        })}
        onChipSelect={onChipSelect}
      />,
    )

    await user.click(screen.getByText("forecasting-churned-customers"))
    expect(onChipClickMock).toHaveBeenCalledWith(0)
    expect(onChipSelect).toHaveBeenCalledWith("forecasting-churned-customers", "Forecasts churn rates")
  })

  it("copy button calls onCopyOne with correct index", async () => {
    const user = userEvent.setup()
    const onCopyOne = vi.fn()

    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: true,
          onCopyOne,
        })}
        onChipSelect={vi.fn()}
      />,
    )

    const copyButtons = screen.getAllByRole("button", { name: "Copy" })
    await user.click(copyButtons[0])
    expect(onCopyOne).toHaveBeenCalledWith(0)
  })

  it("copy all button calls onCopyAll", async () => {
    const user = userEvent.setup()
    const onCopyAll = vi.fn()

    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: true,
          onCopyAll,
        })}
        onChipSelect={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Copy all" }))
    expect(onCopyAll).toHaveBeenCalledOnce()
  })

  it("gerund tip is shown in footer when expanded", () => {
    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: true,
        })}
        onChipSelect={vi.fn()}
      />,
    )
    expect(screen.getByText("Gerund names:")).toBeInTheDocument()
    expect(screen.getByText("verb-ing + object")).toBeInTheDocument()
  })

  it("currentChipIndex chip has current badge", () => {
    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: true,
          currentChipIndex: 1,
        })}
        onChipSelect={vi.fn()}
      />,
    )
    expect(screen.getByText("current")).toBeInTheDocument()
  })

  it("edit mode (status=idle) renders nothing", () => {
    const { container } = render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({ status: "idle" })}
        onChipSelect={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("copied button shows Copied text when index is in copiedIndices", () => {
    render(
      <ScopeAdvisor
        advisorState={makeAdvisorState({
          status: "too-broad",
          suggestions: defaultSuggestions,
          panelExpanded: true,
          copiedIndices: new Set([0]),
        })}
        onChipSelect={vi.fn()}
      />,
    )
    expect(screen.getByText("Copied")).toBeInTheDocument()
  })
})
