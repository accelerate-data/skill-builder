# VD-799 — Review Step Visual Mockups

The Step 4 Review screen becomes a wall of undifferentiated text when a skill has many clarification questions. These mockups explore three approaches to fixing that.

All mockups use the real `clarifications.md` from the sales-pipeline sample skill (26 questions, 6 sections, 16 refinements).

---

## Status

| Item | Issue | Status |
|---|---|---|
| Format canonicalization | VD-819 | **Done** (PR #140). Canonical spec at `canonical-format.md` |
| Accordion navigator (UI) | VD-817 | Todo — implements Option 2a below |
| Agent redesign (detailed research) | VD-807 | Todo — design at `vd-807-agent-outputs.md` |

### Open design questions — VD-817 (Accordion Navigator)

These surfaced during review and should be resolved before or during implementation.

1. **Sub-refinement rendering** — The sample data has three levels: Q-numbers, R-numbers (`R1.1`), and sub-refinements (`R12.1a`, `R12.2b`). The accordion mockup renders R-numbers inside expanded questions but doesn't show how sub-refinements nest. The parser must handle all three levels per the canonical spec.

2. **Progress bar scope** — Does the progress bar count top-level questions only (26), or include refinements and sub-refinements? The mockup shows "14 / 26 answered" which suggests questions only. Confirm this — and clarify whether section chips also count questions only.

3. **"Needs Clarification" section** — The sample `clarifications.md` ends with `## Needs Clarification` containing contradiction warnings and blocked-question lists. Not shown in the accordion mockup. Decide: render as a special section at the bottom of the accordion, or omit from the navigator?

4. **Deferred item status** — Some refinements are deferred (e.g. R4.1: "source system expert will tell"). The mockup shows `R4.1 — deferred` with a warning icon, which is the right treatment. The parser needs a heuristic to detect natural-language deferral answers (not just empty).

### Open design questions — VD-807 (Agent Redesign)

1. **Second-pass evaluator** — After Step 4 (user answers refinements), does the evaluator run again? If so, `per_question` must handle R-numbers (`R1.1`, `R12.1a`), not just Q-numbers. The current design only specifies Q-numbers in the first pass.

2. **Phase 2 sub-agent threshold** — If a section has a single vague answer, spawning a whole sub-agent for one item is wasteful. Consider a minimum threshold or inline handling for single-item sections.

3. **Confirm-decisions partial scenarios** — The merge protocol covers 4 clean scenarios (supported, contradicted, no new info, new without draft). What about a draft decision that's _partially_ supported and _partially_ contradicted by refinement answers? Add guidance for this edge case.

---

## Option 1 — Richer Markdown Styling

**Preview:** open `option1.html`

Keep the existing split-pane layout unchanged. The left pane stays as a raw MDEditor — no code changes there. The right preview pane gets a purpose-built renderer instead of plain `ReactMarkdown`:

- Each `##` section gets a labeled header with a question count
- Each question is a card with a green (answered) or amber (unanswered) left border
- Answered questions show a tinted green chip with the answer text
- Refinements appear as indented sub-rows within the parent question card
- `[MUST ANSWER]` questions get a red badge

**Rationale:** Lowest effort — the MDEditor is untouched, only the right preview panel changes. The two panes remain clearly distinct: left = edit, right = read/verify. The downside is the left is still a wall of raw text, so users who primarily read rather than edit still have to squint at it.

---

## Option 2a — Raw Editor + Accordion Navigator ✦ Preferred

**Preview:** open `option2a.html`

Still a split pane, but the right preview is replaced with a custom accordion component. The left stays as a raw MDEditor with improved syntax highlighting (section headings, answer lines, refinements, and `[MUST ANSWER]` tags each get distinct colors).

Right pane accordion:
- Six collapsible section groups, each showing an answered/total chip
- Questions listed with a green/amber dot indicating answer status
- Click a question row to expand it and see the options, current answer, and any refinements
- Overall progress bar at the top of the accordion

**Rationale:** The two panes now have clearly different jobs — left is for editing the raw file, right is for navigating and verifying answers. The accordion makes it easy to jump to a specific unanswered question without scrolling through everything. Medium effort: needs a custom accordion component and a parser to read question state from the markdown file.

**Why preferred over the alternatives:** Keeps the MDEditor intact (no round-trip parsing risk, no loss of power-user editing), while giving the right pane a clear and useful purpose it currently lacks. Option 1 is lower effort but leaves the left pane as a wall of text. Option 2b is cleaner conceptually but requires a reliable markdown parser that can write edits back to the file — a meaningful implementation risk for uncertain gain.

---

## Option 2b — Single-Pane Structured Editor

**Preview:** open `option2b.html`

Drops the split entirely. One full-width document where the markdown structure is rendered as a navigable form.

### What the user sees

- Sticky `##` section bands with answered/total progress — visible as you scroll
- Each question is a collapsible card; answered questions collapse to show an answer preview, unanswered ones show a placeholder
- Answer fields are inline `<textarea>` elements — click directly to type, no separate editor to switch to
- Refinements appear nested inside their parent question
- A `[MUST ANSWER]` badge marks blocking questions
- "Edit raw markdown" button in the toolbar escapes to the full MDEditor for power users
- Continue is disabled until required questions are answered

### How it works

**Shared parser (same as 2a):** Reads `clarifications.md` into structured data — sections, questions, choices, answer status, refinements. The clarifications format is well-defined (YAML frontmatter, `##` sections, `###` questions, `**Answer:**` fields, `#### Refinements`), so this is pattern-matching against a known schema, not general markdown parsing.

**Write-back is targeted, not full serialization:** When the user types in an answer field, only the corresponding `**Answer:**` line in the markdown is updated — the rest of the file stays untouched. This is a line-level splice (find the `**Answer:**` line by question ID, replace the content after the colon), not a full markdown round-trip. Same mechanism the Rust `autofill_answers` function already uses (VD-782).

**Auto-save:** Debounced write after typing stops. The file on disk is always the source of truth — the structured UI is a projection of it, not a replacement.

### Risk assessment

The original concern about "a reliable markdown parser that can write edits back" overstated the risk. The write path only touches `**Answer:**` lines, which have a fixed format. The actual risks are:

- **Edge case:** User pastes multi-line content with `**Answer:**` as a substring — the line-finder must match the exact indentation/bold pattern, not substrings.
- **Escape hatch quality:** The "Edit raw markdown" toggle must preserve unsaved structured edits and vice versa. Simplest approach: flush to disk before switching modes.
- **New question types:** If the clarifications format evolves (new field types beyond Answer/Recommendation/Choices), the parser needs updating. Mitigated by the format being controlled by our own agents.

### Rationale

Eliminates the redundancy of two panels by owning the rendering entirely. The document is the editor — there's no cognitive overhead from switching between sides. Implementation cost is moderate (not high) because the write-back is a targeted line splice, not full bidirectional serialization.
