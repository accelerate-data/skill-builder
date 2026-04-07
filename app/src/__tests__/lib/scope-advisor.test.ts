import { describe, it, expect } from "vitest"
import {
  isShortDescription,
  formatSuggestionForClipboard,
  formatAllSuggestionsForClipboard,
} from "@/lib/scope-advisor"

describe("isShortDescription", () => {
  it("returns true for empty string", () => {
    expect(isShortDescription("")).toBe(true)
  })

  it("returns true for text with no sentence-ending punctuation", () => {
    expect(isShortDescription("Hello world")).toBe(true)
  })

  it("returns true for one sentence", () => {
    expect(isShortDescription("One sentence.")).toBe(true)
  })

  it("returns false for two sentences", () => {
    expect(isShortDescription("First sentence. Second sentence.")).toBe(false)
  })

  it("returns false for two sentences with mixed punctuation", () => {
    expect(isShortDescription("First! Second.")).toBe(false)
  })

  it("returns false when trimmed text has two sentences with surrounding whitespace", () => {
    expect(isShortDescription("  Some text?  Another sentence.  ")).toBe(false)
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
