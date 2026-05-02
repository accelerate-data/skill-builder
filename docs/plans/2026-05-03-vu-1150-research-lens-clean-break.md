# VU-1150 Research Lens Clean-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace workflow research dimension scoring with a one-flow, one-lens clean-break contract for OpenHands research.

**Architecture:** Step 0 research should return only completion status, question count, and the canonical clarifications object. Clarifications metadata should carry one `research_lens` value and no `research_plan`, dimension scores, selected dimensions, or consolidation handoff artifacts. The app should render a compact research summary from clarifications metadata and counts instead of the legacy dimensions panel.

**Tech Stack:** Rust Tauri contracts with Specta/Schemars codegen, TypeScript React UI, Vitest unit and structural tests, bundled OpenHands workspace agent sources, Promptfoo eval packages.

---

## Issue

Linear: VU-1150

## Current Evidence

- `app/src-tauri/src/contracts/workflow_outputs.rs` requires top-level `dimensions_selected` in `ResearchStepOutput`.
- `app/src-tauri/src/contracts/clarifications.rs` defines `ClarificationsResearchPlan`, `DimensionScore`, and `SelectedDimension`.
- `app/src/components/research-summary-card.tsx` parses `metadata.research_plan`, legacy research-plan markdown, dimension scores, and selected dimensions.
- `agent-sources/workspace/skills/research/SKILL.md` still describes dimension scoring, per-dimension research, and consolidation.
- `agent-sources/workspace/skills/shared/schemas.md` still requires `metadata.research_plan`.
- `app/src/__tests__/lib/canonical-format.test.ts`, mock clarifications fixtures, and eval prompt assertions still encode the dimension contract.

## Target Contract

Step 0 research output:

```json
{
  "status": "research_complete",
  "question_count": 5,
  "research_output": {
    "version": "1",
    "metadata": {
      "title": "Clarifications: Example",
      "research_lens": "rules-and-metrics",
      "question_count": 5,
      "section_count": 2,
      "refinement_count": 0,
      "must_answer_count": 2,
      "priority_questions": ["Q1", "Q2"],
      "scope_recommendation": false,
      "warning": null,
      "error": null
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

Allowed `metadata.research_lens` values:

- `subject-model`
- `rules-and-metrics`
- `data-behavior`
- `runtime-constraints`

Guard and error outputs use `research_lens: null`, zero counts, empty `sections`, and the existing `warning` or `error` channels.

## File Map

- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs` - remove `dimensions_selected` from `ResearchStepOutput`.
- Modify: `app/src-tauri/src/contracts/clarifications.rs` - add `research_lens`, remove research-plan structs and tests.
- Generate: `app/src/generated/contracts.ts`, `app/sidecar/generated/contracts.ts`, `app/src-tauri/src/generated/schemas.rs`, `agent-sources/**/shared/output-schemas/*.json`, `agent-sources/**/shared/output-deep-schemas/*.json`.
- Modify: `app/sidecar/mock-agent.ts` - derive step 0 structured mock output without dimensions.
- Modify: `app/sidecar/mock-templates/outputs/step0*/context/clarifications.json` - replace `research_plan` with `research_lens`.
- Modify: `app/src/components/research-summary-card.tsx` - remove dimension parser/display and show lens/count summary.
- Modify: `app/src/__tests__/components/research-summary-card.test.tsx` - assert lens/count display and guard states.
- Modify: `app/src/__tests__/lib/canonical-format.test.ts` - remove embedded research plan tests and add lens metadata checks.
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`, `app/src-tauri/src/commands/workflow_artifacts.rs`, `app/src-tauri/src/contracts/*` tests - remove `dimensions_selected` expectations.
- Modify: `agent-sources/prompts/research.txt` - remove top-level `dimensions_selected`.
- Modify: `agent-sources/workspace/skills/research/SKILL.md` - replace dimension scoring flow with one-lens flow.
- Delete: `agent-sources/workspace/skills/research/references/consolidation-handoff.md`, `dimension-sets.md`, `scoring-rubric.md`, and `references/dimensions/*.md`. These references are obsolete in the one-lens flow and should not remain as discoverable fallback guidance.
- Modify: `agent-sources/workspace/skills/shared/schemas.md` - document `research_lens` semantics and remove `research_plan` semantics.
- Modify: `tests/evals/packages/skill-content-researcher-research/prompt.txt` and `promptfooconfig.json`.
- Modify: `tests/evals/packages/skill-content-researcher-skill-builder/prompt.txt` and `promptfooconfig.json`.
- Modify: `tests/evals/packages/workspace-workflow-step-prompt/prompt.txt` and `promptfooconfig.json`.
- Audit all other `tests/evals/packages/**/prompt*.json` and `prompt.txt` files for legacy research contract fields.
- Audit: `repo-map.json` if files are deleted from or added under mapped paths.

---

### Task 1: Lock the Clean-Break Contract With Failing Tests

**Files:**

- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs`
- Modify: `app/src-tauri/src/contracts/clarifications.rs`
- Modify: `app/src/__tests__/lib/canonical-format.test.ts`
- Modify: `app/src/__tests__/components/research-summary-card.test.tsx`

- [ ] **Step 1: Update Rust contract tests to expect no top-level dimensions field**

In `app/src-tauri/src/contracts/workflow_outputs.rs`, update the `ResearchStepOutput` serialization test fixture so it constructs:

```rust
let output = ResearchStepOutput {
    status: "research_complete".to_string(),
    question_count: 3,
    research_output: ClarificationsFile {
        version: "1".to_string(),
        metadata: ClarificationsMetadata {
            title: "Clarifications: Test".to_string(),
            research_lens: Some("subject-model".to_string()),
            question_count: 3,
            section_count: 1,
            refinement_count: 0,
            must_answer_count: 1,
            priority_questions: vec!["Q1".to_string()],
            ..Default::default()
        },
        ..Default::default()
    },
};
```

Remove assertions that read or require `deserialized.dimensions_selected`. Add an assertion that the serialized JSON has no `dimensions_selected` key:

```rust
assert!(serialized.get("dimensions_selected").is_none());
assert_eq!(deserialized.question_count, 3);
```

- [ ] **Step 2: Update Rust clarifications metadata tests for `research_lens`**

In `app/src-tauri/src/contracts/clarifications.rs`, add this field to the expected metadata test fixture:

```rust
research_lens: Some("rules-and-metrics".to_string()),
```

Remove `test_full_metadata_with_research_plan` and `test_dimension_score_focus_accepts_null_for_unselected_dimensions`. Replace them with:

```rust
#[test]
fn test_metadata_accepts_research_lens_without_research_plan() {
    let json = serde_json::json!({
        "version": "1",
        "metadata": {
            "title": "Clarifications: Sales Metrics",
            "research_lens": "rules-and-metrics",
            "question_count": 0,
            "section_count": 0,
            "refinement_count": 0,
            "must_answer_count": 0,
            "priority_questions": []
        },
        "sections": [],
        "notes": [],
        "answer_evaluator_notes": []
    });

    let file: ClarificationsFile = serde_json::from_value(json).expect("deserialize");
    assert_eq!(file.metadata.research_lens.as_deref(), Some("rules-and-metrics"));
    let reserialized = serde_json::to_string(&file).expect("serialize");
    assert!(reserialized.contains("research_lens"));
    assert!(!reserialized.contains("research_plan"));
    assert!(!reserialized.contains("dimension_scores"));
    assert!(!reserialized.contains("selected_dimensions"));
}
```

- [ ] **Step 3: Update canonical fixture tests**

In `app/src/__tests__/lib/canonical-format.test.ts`, replace the entire `Canonical format: embedded research plan structure` describe block with:

```ts
describe("Canonical format: embedded research lens", () => {
  const step0Clarifications = path.join(MOCK_ROOT, "step0/context/clarifications.json");

  it("step0 clarifications.json exists", () => {
    expect(fs.existsSync(step0Clarifications)).toBe(true);
  });

  if (fs.existsSync(step0Clarifications)) {
    const data = JSON.parse(readFile(step0Clarifications));
    const meta = data.metadata ?? {};

    it("has metadata.research_lens string", () => {
      expect(typeof meta.research_lens).toBe("string");
      expect([
        "subject-model",
        "rules-and-metrics",
        "data-behavior",
        "runtime-constraints",
      ]).toContain(meta.research_lens);
    });

    it("does not include legacy research plan fields", () => {
      expect(meta.research_plan).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain("dimension_scores");
      expect(JSON.stringify(data)).not.toContain("selected_dimensions");
    });
  }
});
```

- [ ] **Step 4: Update UI tests to describe the desired lens display**

In `app/src/__tests__/components/research-summary-card.test.tsx`, remove the legacy table-only research-plan test. Add a happy-path fixture with:

```ts
const clarificationsData: ClarificationsFile = {
  version: "1",
  metadata: {
    ...baseMetadata,
    research_lens: "rules-and-metrics",
    question_count: 2,
    must_answer_count: 1,
  },
  sections: [baseSection],
  notes: [{ type: "flag", title: "Known gap", body: "Need owner confirmation." }],
  answer_evaluator_notes: [],
};
```

Add an assertion:

```ts
it("shows selected research lens and summary counts", async () => {
  const user = userEvent.setup();
  render(<ResearchSummaryCard clarificationsData={clarificationsData} />);

  await user.click(screen.getByText("Research Complete"));

  expect(screen.getByText("Research Lens")).toBeInTheDocument();
  expect(screen.getByText("Rules and metrics")).toBeInTheDocument();
  expect(screen.getByText("Clarifications")).toBeInTheDocument();
  expect(screen.getByText("Must answer")).toBeInTheDocument();
  expect(screen.getByText("Notes")).toBeInTheDocument();
});
```

- [ ] **Step 5: Run the focused failing tests**

Run:

```bash
cd app/src-tauri && cargo test contracts::workflow_outputs contracts::clarifications
cd app && npx vitest run src/__tests__/lib/canonical-format.test.ts src/__tests__/components/research-summary-card.test.tsx
```

Expected before implementation: failures mentioning missing `research_lens`, unexpected `dimensions_selected`, or old UI text.

### Task 2: Change Rust Contracts and Regenerate Schemas

**Files:**

- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs`
- Modify: `app/src-tauri/src/contracts/clarifications.rs`
- Generate: `app/src/generated/contracts.ts`
- Generate: `app/sidecar/generated/contracts.ts`
- Generate: `app/src-tauri/src/generated/schemas.rs`
- Generate: `agent-sources/workspace/skills/shared/output-schemas/*.json`
- Generate: `agent-sources/workspace/skills/shared/output-deep-schemas/*.json`

- [ ] **Step 1: Remove top-level `dimensions_selected` from `ResearchStepOutput`**

Change `app/src-tauri/src/contracts/workflow_outputs.rs` from:

```rust
/// Required fields: `status` (const `"research_complete"`), `dimensions_selected`,
/// `question_count`, `research_output`.
pub struct ResearchStepOutput {
    pub status: String,
    pub dimensions_selected: i64,
    pub question_count: i64,
    pub research_output: ClarificationsFile,
}
```

to:

```rust
/// Required fields: `status` (const `"research_complete"`), `question_count`,
/// `research_output`.
pub struct ResearchStepOutput {
    pub status: String,
    pub question_count: i64,
    pub research_output: ClarificationsFile,
}
```

- [ ] **Step 2: Replace research plan metadata with one lens**

In `app/src-tauri/src/contracts/clarifications.rs`, add this field to `ClarificationsMetadata`:

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub research_lens: Option<String>,
```

Remove these fields and structs entirely:

```rust
pub research_plan: Option<ClarificationsResearchPlan>,
pub struct ClarificationsResearchPlan { ... }
pub struct DimensionScore { ... }
pub struct SelectedDimension { ... }
```

- [ ] **Step 3: Run codegen**

Run:

```bash
cd app && npm run codegen
```

Expected: generated TypeScript contracts and JSON schemas no longer include `ResearchStepOutput.dimensions_selected`, `ClarificationsResearchPlan`, `DimensionScore`, `SelectedDimension`, `dimension_scores`, or `selected_dimensions`; they include optional `research_lens`.

- [ ] **Step 4: Fix compile errors from old contract references**

Use:

```bash
rg -n "dimensions_selected|research_plan|dimension_scores|selected_dimensions|ClarificationsResearchPlan|DimensionScore|SelectedDimension" app/src-tauri app/src app/sidecar agent-sources tests/evals
```

For each remaining runtime reference, either remove it or rewrite it to `metadata.research_lens`. Do not keep compatibility aliases.

### Task 3: Update Step 0 Materialization, Mock Runner, and Fixtures

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/src-tauri/src/commands/workflow_artifacts.rs`
- Modify: `app/sidecar/mock-agent.ts`
- Modify: `app/sidecar/__tests__/mock-agent.test.ts`
- Modify: `app/sidecar/__tests__/openhands-runner.integration.test.ts`
- Modify: `app/sidecar/__tests__/openhands-workflow-smoke.test.ts`
- Modify: `app/sidecar/mock-templates/outputs/step0/context/clarifications.json`
- Modify: `app/sidecar/mock-templates/outputs/step0-contradictory/context/clarifications.json`
- Modify: `app/sidecar/mock-templates/step0-research.jsonl`

- [ ] **Step 1: Update Rust materialization fixtures**

Every step 0 payload in `app/src-tauri/src/commands/workflow/tests.rs` and `app/src-tauri/src/commands/workflow_artifacts.rs` should drop:

```json
"dimensions_selected": 1
```

and keep:

```json
"status": "research_complete",
"question_count": 1,
"research_output": {
  "version": "1",
  "metadata": {
    "title": "Test",
    "research_lens": "subject-model",
    "question_count": 1,
    "section_count": 1,
    "refinement_count": 0,
    "must_answer_count": 0,
    "priority_questions": []
  },
  "sections": [],
  "notes": [],
  "answer_evaluator_notes": []
}
```

Delete tests whose only purpose is rejecting missing `dimensions_selected`. Replace them with a test that rejects missing `question_count`.

- [ ] **Step 2: Simplify sidecar mock structured result**

In `app/sidecar/mock-agent.ts`, replace:

```ts
const researchPlan =
  metadata.research_plan &&
  typeof metadata.research_plan === "object" &&
  !Array.isArray(metadata.research_plan)
    ? (metadata.research_plan as JsonObject)
    : {};
const dimensionsSelected =
  typeof researchPlan.dimensions_selected === "number"
    ? researchPlan.dimensions_selected
    : 0;
return {
  status: "research_complete",
  dimensions_selected: dimensionsSelected,
  question_count: questionCount,
  research_output: clarifications,
};
```

with:

```ts
return {
  status: "research_complete",
  question_count: questionCount,
  research_output: clarifications,
};
```

- [ ] **Step 3: Update mock clarifications files**

In both step 0 mock clarifications files, replace the whole `metadata.research_plan` object with:

```json
"research_lens": "subject-model"
```

For contradictory or guard mock outputs, use:

```json
"research_lens": null
```

only if the generated schema permits null; otherwise omit `research_lens` on guard/error outputs.

- [ ] **Step 4: Update sidecar test expectations**

Replace assertions like:

```ts
expect(typeof payload.dimensions_selected).toBe("number");
expect(result.result_text).toContain("dimensions_selected");
```

with:

```ts
expect(payload).not.toHaveProperty("dimensions_selected");
expect(typeof payload.question_count).toBe("number");
expect(payload.research_output?.metadata?.research_lens).toBeTruthy();
```

### Task 4: Simplify Research Complete UI

**Files:**

- Modify: `app/src/components/research-summary-card.tsx`
- Modify: `app/src/__tests__/components/research-summary-card.test.tsx`
- Modify: `app/src/components/step-complete/research-step-complete.tsx` only if the `researchPlan` prop becomes unused.

- [ ] **Step 1: Remove research plan parsing types and helpers**

Delete these from `research-summary-card.tsx`:

```ts
interface DimensionScore { ... }
interface ResearchPlanData { ... }
interface ResearchPlanJson { ... }
function stripInlineMarkdown(...)
function parseResearchPlan(...)
function parseResearchPlanFromClarifications(...)
```

Remove `researchPlan?: string` from `ResearchSummaryCardProps` if it is no longer used.

- [ ] **Step 2: Add lens label helper**

Add:

```ts
const LENS_LABELS: Record<string, string> = {
  "subject-model": "Subject model",
  "rules-and-metrics": "Rules and metrics",
  "data-behavior": "Data behavior",
  "runtime-constraints": "Runtime constraints",
};

function researchLensLabel(value: unknown): string {
  return typeof value === "string" && value in LENS_LABELS
    ? LENS_LABELS[value]
    : "Not selected";
}
```

- [ ] **Step 3: Replace dimensions panel with summary metrics**

Replace the dimensions row with a compact grid:

```tsx
const lensLabel = researchLensLabel(meta?.research_lens);
const noteCount = clarificationsData.notes?.length ?? 0;
const questionCount = meta?.question_count ?? 0;
const mustAnswerCount = meta?.must_answer_count ?? 0;
```

Render:

```tsx
<div className="grid gap-3 p-4 sm:grid-cols-4">
  <div className="rounded-md border bg-muted/30 px-3 py-2">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      Research Lens
    </div>
    <div className="mt-1 text-sm font-medium text-foreground">{lensLabel}</div>
  </div>
  <div className="rounded-md border bg-muted/30 px-3 py-2">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      Clarifications
    </div>
    <div className="mt-1 text-sm font-medium text-foreground">{questionCount}</div>
  </div>
  <div className="rounded-md border bg-muted/30 px-3 py-2">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      Must answer
    </div>
    <div className="mt-1 text-sm font-medium text-foreground">{mustAnswerCount}</div>
  </div>
  <div className="rounded-md border bg-muted/30 px-3 py-2">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      Notes
    </div>
    <div className="mt-1 text-sm font-medium text-foreground">{noteCount}</div>
  </div>
</div>
```

Keep the existing non-happy-path banner and reset footer.

- [ ] **Step 4: Remove obsolete icon imports**

Remove `Layers` from the lucide import if unused. Keep `CheckCircle2`, `Clock`, `AlertTriangle`, `ChevronRight`, and `XCircle` if still used.

- [ ] **Step 5: Update `ResearchStepComplete` prop wiring**

If `ResearchSummaryCard` no longer accepts `researchPlan`, remove:

```ts
const researchPlanContent = fileContents.get("context/research-plan.md");
researchPlan={researchPlanContent}
```

from both render paths in `app/src/components/step-complete/research-step-complete.tsx`.

### Task 5: Rewrite Research Skill to One Flow and One Lens

**Files:**

- Modify: `agent-sources/workspace/skills/research/SKILL.md`
- Modify: `agent-sources/workspace/skills/shared/schemas.md`
- Modify: `agent-sources/prompts/research.txt`
- Delete: `agent-sources/workspace/skills/research/references/consolidation-handoff.md`
- Delete: `agent-sources/workspace/skills/research/references/dimension-sets.md`
- Delete: `agent-sources/workspace/skills/research/references/scoring-rubric.md`
- Delete: `agent-sources/workspace/skills/research/references/dimensions/*.md`

- [ ] **Step 1: Replace the research skill overview**

Use this shape in `agent-sources/workspace/skills/research/SKILL.md`:

```md
# Research Skill

This skill runs inside the single `skill-creator` OpenHands agent for the
`workflow.research` task. It reads user context, selects exactly one research
lens, researches that lens inline, and returns the final clarifications JSON.

The research lenses are:

| Lens | Use when the requested skill depends on |
|---|---|
| `subject-model` | Core entities, relationships, grain, nouns, and conceptual boundaries |
| `rules-and-metrics` | Calculations, thresholds, business rules, segmentation, and exceptions |
| `data-behavior` | Source behavior, lifecycle, field semantics, quality, and reconciliation |
| `runtime-constraints` | Platform behavior, configuration, orchestration, and operational failures |
```

- [ ] **Step 2: Replace dimension scoring steps with one-lens selection**

Delete steps for dimension sets, scoring JSON, selecting 3-5 dimensions, sequential dimension research, and consolidation. Add:

```md
## Step 3: Select one research lens

Select exactly one lens. Use the user's declared purpose and context:

- Choose `subject-model` when the main unknown is what concepts/entities the skill must understand.
- Choose `rules-and-metrics` when the main unknown is how the skill should calculate, classify, segment, or apply business rules.
- Choose `data-behavior` when the main unknown is source-system behavior, lifecycle, field meaning, quality, or reconciliation.
- Choose `runtime-constraints` when the main unknown is platform-specific behavior, configuration, orchestration, or production operations.

If multiple lenses seem relevant, choose the one that would most change the clarification questions. Do not select a second lens.
```

- [ ] **Step 3: Add inline research instruction**

Add:

```md
## Step 4: Research the selected lens inline

Use the selected lens, the full user context, and any user-provided reference
documents to produce the final clarification questions directly. Do not write
intermediate JSON, do not write hidden per-dimension notes, and do not run a
consolidation pass.
```

- [ ] **Step 4: Update final payload examples**

Every step 0 example should omit top-level `dimensions_selected` and include:

```json
"research_lens": "subject-model"
```

inside `research_output.metadata`.

Guard/error examples should omit `research_lens` or set it to `null` only if the generated schema allows null.

- [ ] **Step 5: Update semantic schema docs**

In both `shared/schemas.md` copies, replace the `Research Plan` section with:

```md
## Research Lens

- `metadata.research_lens` is required for successful research outputs.
- Allowed values: `subject-model`, `rules-and-metrics`, `data-behavior`, `runtime-constraints`.
- Guard and error outputs may omit `research_lens`.
- Research outputs must not include `metadata.research_plan`, `dimension_scores`, or `selected_dimensions`.
```

Update the orchestrator envelope section to remove the `dimensions_selected` invariant.

- [ ] **Step 6: Update app prompt**

In `agent-sources/prompts/research.txt`, change the envelope to:

```md
Return only a raw JSON object with this envelope:
{
  "status": "research_complete",
  "question_count": number,
  "research_output": { ...canonical clarifications.json object... }
}
```

Remove `Maximum research dimensions before scope warning` if no prompt or runtime behavior uses it after the migration.

### Task 6: Delete Obsolete Dimension References

**Files:**

- Delete: `agent-sources/workspace/skills/research/references/dimensions/*.md`
- Delete: `agent-sources/workspace/skills/research/references/dimension-sets.md`
- Delete: `agent-sources/workspace/skills/research/references/scoring-rubric.md`
- Delete: `agent-sources/workspace/skills/research/references/consolidation-handoff.md`
- Modify: `repo-map.json` if it describes these reference files.

- [ ] **Step 1: Confirm all remaining references are targets for rewrite or deletion**

Run:

```bash
rg -n "dimension-sets|scoring-rubric|consolidation-handoff|references/dimensions|dimension_scores|selected_dimensions" agent-sources app tests
```

Expected after previous tasks: no runtime, prompt, schema, fixture, or eval code still depends on these files. Any remaining references must be rewritten or deleted in this task; do not keep the old dimension/scoring/consolidation files as archived reference material.

- [ ] **Step 2: Delete obsolete references**

Delete the obsolete reference files with `git rm`.

- [ ] **Step 3: Update repo map only if needed**

Run:

```bash
rg -n "research/references|dimension" repo-map.json
```

If `repo-map.json` names the deleted reference set, update that description in the same change.

### Task 7: Update Evals and Structural Tests

**Files:**

- Modify: `app/agent-tests/agent-structure.test.ts`
- Modify: `tests/evals/packages/skill-content-researcher-research/prompt.txt`
- Modify: `tests/evals/packages/skill-content-researcher-research/promptfooconfig.json`
- Modify: `tests/evals/packages/skill-content-researcher-skill-builder/prompt.txt`
- Modify: `tests/evals/packages/skill-content-researcher-skill-builder/promptfooconfig.json`
- Modify: `tests/evals/packages/workspace-workflow-step-prompt/prompt.txt`
- Modify: `tests/evals/packages/workspace-workflow-step-prompt/promptfooconfig.json`
- Audit: other `tests/evals/packages/**/prompt.txt` and `promptfooconfig.json` files found by `rg`.

- [ ] **Step 1: Update structural tests**

Replace assertions requiring `dimensions_selected` and `all_dimensions_low_score` with assertions requiring:

```ts
expect(content).toMatch(/research_lens/);
expect(content).toMatch(/subject-model/);
expect(content).toMatch(/rules-and-metrics/);
expect(content).toMatch(/data-behavior/);
expect(content).toMatch(/runtime-constraints/);
expect(content).not.toMatch(/dimension_scores/);
expect(content).not.toMatch(/selected_dimensions/);
```

- [ ] **Step 2: Update eval prompt examples**

Run:

```bash
find tests/evals/packages -maxdepth 2 -type f \( -name 'prompt.txt' -o -name 'promptfooconfig.json' \) | sort | xargs rg -n "dimensions_selected|research_plan|dimension_scores|selected_dimensions|all_dimensions_low_score"
```

Expected initial hits include:

- `tests/evals/packages/skill-content-researcher-research/prompt.txt`
- `tests/evals/packages/skill-content-researcher-research/promptfooconfig.json`
- `tests/evals/packages/skill-content-researcher-skill-builder/prompt.txt`
- `tests/evals/packages/skill-content-researcher-skill-builder/promptfooconfig.json`
- `tests/evals/packages/workspace-workflow-step-prompt/prompt.txt`
- `tests/evals/packages/workspace-workflow-step-prompt/promptfooconfig.json`

Remove top-level `dimensions_selected` from research output examples. Remove `metadata.research_plan`, `dimension_scores`, and `selected_dimensions`. Add `metadata.research_lens` to successful examples.

- [ ] **Step 3: Update eval assertions**

Replace JavaScript assertions requiring:

```js
Number.isInteger(data.dimensions_selected)
data.research_output.metadata.research_plan
```

with:

```js
!Object.prototype.hasOwnProperty.call(data, "dimensions_selected")
typeof data.question_count === "number"
data.research_output.metadata
typeof data.research_output.metadata.research_lens === "string"
```

For guard/error evals, assert `research_lens` may be absent and `warning` or `error` is present.

- [ ] **Step 4: Verify eval package inventory is clean**

Run the same eval grep again:

```bash
find tests/evals/packages -maxdepth 2 -type f \( -name 'prompt.txt' -o -name 'promptfooconfig.json' \) | sort | xargs rg -n "dimensions_selected|research_plan|dimension_scores|selected_dimensions|all_dimensions_low_score"
```

Expected: no matches.

### Task 8: Full Validation and Cleanup

**Files:**

- Review all changed files.
- No new source files expected unless codegen produces them.

- [ ] **Step 1: Run contract/codegen validation**

Run:

```bash
cd app && npm run codegen
git diff -- app/src/generated/contracts.ts app/sidecar/generated/contracts.ts app/src-tauri/src/generated/schemas.rs agent-sources
```

Expected: generated diffs reflect the clean-break contract and no manual generated-file edits are needed.

- [ ] **Step 2: Run mapped tests**

Run:

```bash
cd app && npm run test:agents:structural
cd app && npm run test:unit
cd app/src-tauri && cargo test contracts:: workflow::
```

Expected: all pass.

- [ ] **Step 3: Run eval harness contract tests**

Run:

```bash
cd tests/evals && npm test
```

Expected: deterministic eval harness tests pass.

- [ ] **Step 4: Run targeted research eval smoke if environment is configured**

Run:

```bash
cd tests/evals && npm run eval:skill-content-researcher-research
```

If the script name differs, inspect `tests/evals/package.json` and run the targeted research package command. If live model credentials are unavailable, record the exact skipped command and reason in the final implementation notes.

- [ ] **Step 5: Final grep for forbidden legacy contract terms**

Run:

```bash
rg -n "dimensions_selected|dimension_scores|selected_dimensions|research_plan|all_dimensions_low_score|consolidation-handoff|scoring-rubric" app agent-sources tests/evals
```

Expected: no runtime, prompt, schema, fixture, or eval references remain. Historical docs may remain only if explicitly preserved and clearly marked obsolete.

- [ ] **Step 6: Commit implementation**

After implementation and validation:

```bash
git add app agent-sources tests/evals repo-map.json
git commit -m "VU-1150: simplify research lens contract"
```

Do not include unrelated worktree changes.
