import { describe, it, expect } from "vitest"
import {
  formatSuggestionForClipboard,
  formatAllSuggestionsForClipboard,
} from "@/lib/scope-advisor"

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
