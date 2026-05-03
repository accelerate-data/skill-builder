import { describe, it, expect } from "vitest"
import {
  ADVISOR_BANNER,
  formatSuggestionForClipboard,
  formatAllSuggestionsForClipboard,
} from "@/lib/scope-advisor"

describe("ADVISOR_BANNER", () => {
  it("has entry for focused", () => {
    expect(ADVISOR_BANNER["focused"]).toBe("This skill looks focused.")
  })

  it("has entry for too-broad", () => {
    expect(ADVISOR_BANNER["too-broad"]).toBe(
      "This skill might be too broad. Consider splitting into more focused skills.",
    )
  })

  it("has entry for name-needs-improvement", () => {
    expect(ADVISOR_BANNER["name-needs-improvement"]).toBe(
      "We found better names for this skill.",
    )
  })

  it("has entry for description-needs-improvement", () => {
    expect(ADVISOR_BANNER["description-needs-improvement"]).toBe(
      "We found a clearer description for this skill.",
    )
  })

  it("has entry for both-need-improvement", () => {
    expect(ADVISOR_BANNER["both-need-improvement"]).toBe(
      "We found better names and descriptions for this skill.",
    )
  })

  it("has entry for runtime validation errors", () => {
    expect(ADVISOR_BANNER["error"]).toBe("Validation failed.")
  })

  it("covers all non-idle non-loading statuses", () => {
    const keys = Object.keys(ADVISOR_BANNER)
    expect(keys).toHaveLength(6)
    expect(keys).toContain("focused")
    expect(keys).toContain("too-broad")
    expect(keys).toContain("name-needs-improvement")
    expect(keys).toContain("description-needs-improvement")
    expect(keys).toContain("both-need-improvement")
    expect(keys).toContain("error")
  })
})

describe("formatSuggestionForClipboard", () => {
  it("formats name and description with colon separator", () => {
    expect(
      formatSuggestionForClipboard({
        name: "forecasting-churned-customers",
        description: "Forecasts churn",
      }),
    ).toBe("forecasting-churned-customers: Forecasts churn")
  })
})

describe("formatAllSuggestionsForClipboard", () => {
  it("joins multiple suggestions with newlines", () => {
    expect(
      formatAllSuggestionsForClipboard([
        { name: "name1", description: "desc1" },
        { name: "name2", description: "desc2" },
      ]),
    ).toBe("name1: desc1\nname2: desc2")
  })

  it("returns empty string for empty array", () => {
    expect(formatAllSuggestionsForClipboard([])).toBe("")
  })
})
