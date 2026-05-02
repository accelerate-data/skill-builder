# VU-1150 Workflow Research Clean-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace workflow research dimension scoring with one inline OpenHands
research flow that emits only the final clarifications contract.

**Architecture:** Step 0 research should use topic scope gating, four internal
knowledge lenses, and candidate-topic scoring to decide which clarification
questions matter. Those internal judgments are not emitted. The app should read
only completion status, question count, and the canonical clarifications object.

**Tech Stack:** Rust Tauri contracts with Specta/Schemars codegen, TypeScript
React UI, Vitest unit and structural tests, bundled OpenHands workspace agent
sources, and Promptfoo eval packages.

---

## Issue

Linear: VU-1150

Design: [Workflow Research Clean Break](../design/workflow-research-clean-break/README.md)

## Current Evidence

- `app/src-tauri/src/contracts/workflow_outputs.rs` requires top-level
  `dimensions_selected` in `ResearchStepOutput`.
- `app/src-tauri/src/contracts/clarifications.rs` defines
  `ClarificationsResearchPlan`, `DimensionScore`, and `SelectedDimension`.
- `app/src/components/research-summary-card.tsx` parses legacy research-plan
  markdown, dimension scores, and selected dimensions.
- `agent-sources/workspace/skills/research/SKILL.md` still describes dimension
  scoring, per-dimension research, and consolidation.
- `agent-sources/workspace/skills/shared/schemas.md` still requires
  `metadata.research_plan`.
- `app/src/__tests__/lib/canonical-format.test.ts`, mock clarifications
  fixtures, and eval prompt assertions still encode the dimension contract.

## Target Contract

Successful step 0 research output:

```json
{
  "status": "research_complete",
  "question_count": 5,
  "research_output": {
    "version": "1",
    "metadata": {
      "title": "Clarifications: Example",
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

The output must not include:

- top-level `dimensions_selected`
- `metadata.research_plan`
- `metadata.research_lens`
- `dimension_scores`
- `selected_dimensions`
- emitted consolidation, handoff, or scoring notes

Guard and error outputs use the same envelope with zero counts, empty arrays,
and the existing `warning`, `error`, or `scope_recommendation` channels.

## Internal Research Model

The research skill should use the following internal flow without emitting the
intermediate reasoning:

1. Score topic usefulness for data, analytics, or data-engineering skill
   creation.
2. If the topic is not useful or is too broad, return a scope recommendation
   instead of pretending research can cover it.
3. Check whether each internal lens is relevant to the topic:
   business process, data engineering standards, source system customizations,
   and platform standards.
4. Generate candidate clarification topics from every relevant lens.
5. Score each candidate by organization-specific knowledge delta:
   what people typically get wrong, what is not in baseline LLM knowledge,
   what is commonly customized, and whether the answer would change the skill.
6. Drop low-scoring candidates and emit only high-value clarification sections.

## File Map

- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs` - remove
  `dimensions_selected` from `ResearchStepOutput`.
- Modify: `app/src-tauri/src/contracts/clarifications.rs` - remove research-plan
  structs, dimension structs, and metadata fields.
- Generate: `app/src/generated/contracts.ts`,
  `app/sidecar/generated/contracts.ts`,
  `app/src-tauri/src/generated/schemas.rs`,
  `agent-sources/workspace/**/shared/output-schemas/*.json`, and
  `agent-sources/workspace/**/shared/output-deep-schemas/*.json`.
- Modify: `app/sidecar/mock-agent.ts` - derive step 0 structured mock output
  without dimensions or lenses.
- Modify:
  `app/sidecar/mock-templates/outputs/step0*/context/clarifications.json` -
  remove `research_plan` and any lens metadata.
- Modify: `app/src/components/research-summary-card.tsx` - remove dimension and
  lens parsing/display and show a compact outcome summary.
- Modify: `app/src/__tests__/components/research-summary-card.test.tsx` -
  assert count, notes, warning, and scope-recommendation states.
- Modify: `app/src/__tests__/lib/canonical-format.test.ts` - assert the new
  clean-break contract and absence of legacy fields.
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`,
  `app/src-tauri/src/commands/workflow_artifacts.rs`, and affected contract
  tests - remove `dimensions_selected` expectations.
- Modify: `agent-sources/prompts/research.txt` - remove top-level
  `dimensions_selected` instructions.
- Modify: `agent-sources/workspace/skills/research/SKILL.md` - replace
  dimension scoring and consolidation with the one-flow internal scoring model.
- Delete:
  `agent-sources/workspace/skills/research/references/consolidation-handoff.md`,
  `agent-sources/workspace/skills/research/references/dimension-sets.md`,
  `agent-sources/workspace/skills/research/references/scoring-rubric.md`, and
  `agent-sources/workspace/skills/research/references/dimensions/*.md`.
- Modify: `agent-sources/workspace/skills/shared/schemas.md` - document that
  research emits only the final clarifications object.
- Modify:
  `tests/evals/packages/skill-content-researcher-research/prompt.txt` and
  `promptfooconfig.json`.
- Modify:
  `tests/evals/packages/skill-content-researcher-skill-builder/prompt.txt` and
  `promptfooconfig.json`.
- Modify: `tests/evals/packages/workspace-workflow-step-prompt/prompt.txt` and
  `promptfooconfig.json`.
- Audit: all `tests/evals/packages/**/prompt*.json`,
  `tests/evals/packages/**/promptfooconfig.json`, and
  `tests/evals/packages/**/prompt.txt` files for legacy research contract
  fields.
- Audit: `repo-map.json` if deleted or generated paths are mapped.

Do not modify `agent-sources/plugins/`; that is the old Claude path.

---

### Task 1: Lock the Clean-Break Contract With Failing Tests

**Files:**

- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs`
- Modify: `app/src-tauri/src/contracts/clarifications.rs`
- Modify: `app/src/__tests__/lib/canonical-format.test.ts`
- Modify: `app/src/__tests__/components/research-summary-card.test.tsx`

- [ ] **Step 1: Update `ResearchStepOutput` contract tests**

In `app/src-tauri/src/contracts/workflow_outputs.rs`, construct
`ResearchStepOutput` with only `status`, `question_count`, and
`research_output`.

Add serialization assertions:

```rust
assert!(serialized.get("dimensions_selected").is_none());
assert_eq!(deserialized.status, "research_complete");
assert_eq!(deserialized.question_count, 3);
```

Remove every fixture field or assertion that reads `dimensions_selected`.

- [ ] **Step 2: Update clarifications metadata tests**

In `app/src-tauri/src/contracts/clarifications.rs`, remove tests that require
`research_plan`, `dimension_scores`, `selected_dimensions`, or `research_lens`.

Add a metadata round-trip test:

```rust
#[test]
fn test_metadata_rejects_legacy_research_planning_fields() {
    let json = serde_json::json!({
        "version": "1",
        "metadata": {
            "title": "Clarifications: Sales Metrics",
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
    let reserialized = serde_json::to_string(&file).expect("serialize");
    assert!(!reserialized.contains("research_plan"));
    assert!(!reserialized.contains("research_lens"));
    assert!(!reserialized.contains("dimension_scores"));
    assert!(!reserialized.contains("selected_dimensions"));
}
```

- [ ] **Step 3: Update canonical fixture tests**

In `app/src/__tests__/lib/canonical-format.test.ts`, replace the embedded
research-plan assertions with:

```ts
describe("Canonical format: research clean-break contract", () => {
  const step0Clarifications = path.join(MOCK_ROOT, "step0/context/clarifications.json");

  it("step0 clarifications.json has no legacy planning fields", () => {
    const data = JSON.parse(readFile(step0Clarifications));
    const body = JSON.stringify(data);

    expect(data.metadata).toBeTruthy();
    expect(data.metadata.question_count).toEqual(expect.any(Number));
    expect(data.metadata.research_plan).toBeUndefined();
    expect(data.metadata.research_lens).toBeUndefined();
    expect(body).not.toContain("dimension_scores");
    expect(body).not.toContain("selected_dimensions");
  });
});
```

- [ ] **Step 4: Update UI tests for compact research display**

In `app/src/__tests__/components/research-summary-card.test.tsx`, replace the
dimension and lens assertions with count and note assertions:

```ts
it("shows research outcome, counts, and notes without planning metadata", async () => {
  const user = userEvent.setup();
  render(<ResearchSummaryCard clarificationsData={clarificationsData} />);

  await user.click(screen.getByText("Research Complete"));

  expect(screen.getByText("Clarifications")).toBeInTheDocument();
  expect(screen.getByText("Must answer")).toBeInTheDocument();
  expect(screen.getByText("Notes")).toBeInTheDocument();
  expect(screen.queryByText("Research Lens")).not.toBeInTheDocument();
  expect(screen.queryByText("Dimensions")).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Run focused failing tests**

Run:

```bash
cd app && npm run test:unit -- canonical-format research-summary-card
cd app/src-tauri && cargo test contracts::
```

Expected before implementation: tests fail because existing contracts and
fixtures still emit legacy planning fields.

Commit after the failing-test edits:

```bash
git add app/src-tauri/src/contracts app/src/__tests__/lib/canonical-format.test.ts app/src/__tests__/components/research-summary-card.test.tsx
git commit -m "VU-1150: lock research clean-break tests"
```

### Task 2: Simplify Rust and Generated Contracts

**Files:**

- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs`
- Modify: `app/src-tauri/src/contracts/clarifications.rs`
- Generate: `app/src/generated/contracts.ts`
- Generate: `app/sidecar/generated/contracts.ts`
- Generate: `app/src-tauri/src/generated/schemas.rs`
- Generate: `agent-sources/workspace/**/shared/output-schemas/*.json`
- Generate: `agent-sources/workspace/**/shared/output-deep-schemas/*.json`

- [ ] **Step 1: Remove `dimensions_selected` from `ResearchStepOutput`**

Delete the field from the Rust struct and update constructors to compile with
only:

```rust
pub struct ResearchStepOutput {
    pub status: String,
    pub question_count: u32,
    pub research_output: ClarificationsFile,
}
```

- [ ] **Step 2: Remove research planning metadata structs**

Delete unused struct definitions and metadata fields for:

- `ClarificationsResearchPlan`
- `DimensionScore`
- `SelectedDimension`
- `research_plan`
- `research_lens`

Keep existing scalar metadata such as counts, warnings, errors, scope
recommendations, and priority questions.

- [ ] **Step 3: Regenerate contracts**

Run:

```bash
cd app && npm run codegen
```

Expected: generated TypeScript, Rust schema, and workspace output schema files
no longer include `dimensions_selected`, `research_plan`, `research_lens`,
`dimension_scores`, or `selected_dimensions`.

- [ ] **Step 4: Run contract tests**

Run:

```bash
cd app/src-tauri && cargo test contracts::
```

Expected: all contract tests pass.

Commit:

```bash
git add app/src-tauri/src/contracts app/src/generated app/sidecar/generated app/src-tauri/src/generated agent-sources/workspace
git commit -m "VU-1150: simplify research output contracts"
```

### Task 3: Update Mock Output Producers and Fixtures

**Files:**

- Modify: `app/sidecar/mock-agent.ts`
- Modify:
  `app/sidecar/mock-templates/outputs/step0*/context/clarifications.json`
- Modify: affected unit fixtures under `app/e2e/fixtures/agent-responses/**`

- [ ] **Step 1: Remove dimensions from mock step output**

In `app/sidecar/mock-agent.ts`, return step 0 mock output in this shape:

```ts
return {
  status: "research_complete",
  question_count: clarifications.metadata?.question_count ?? 0,
  research_output: clarifications,
};
```

Remove any `dimensions_selected` fallback.

- [ ] **Step 2: Rewrite step 0 mock clarifications**

For every step 0 `clarifications.json`, remove `metadata.research_plan` and
`metadata.research_lens`. Keep the count fields, `priority_questions`,
`scope_recommendation`, `warning`, `error`, `sections`, `notes`, and
`answer_evaluator_notes`.

- [ ] **Step 3: Search fixtures for legacy fields**

Run:

```bash
rg "dimensions_selected|research_plan|research_lens|dimension_scores|selected_dimensions" app/sidecar app/e2e
```

Expected: no matches outside assertions that intentionally verify absence.

- [ ] **Step 4: Run unit tests affected by fixtures**

Run:

```bash
cd app && npm run test:unit -- canonical-format
```

Expected: canonical format tests pass.

Commit:

```bash
git add app/sidecar app/e2e app/src/__tests__/lib/canonical-format.test.ts
git commit -m "VU-1150: update research mock fixtures"
```

### Task 4: Simplify the Research Summary UI

**Files:**

- Modify: `app/src/components/research-summary-card.tsx`
- Modify: `app/src/__tests__/components/research-summary-card.test.tsx`

- [ ] **Step 1: Remove legacy parsing helpers**

Delete code that parses or displays:

- markdown research plans
- dimensions tables
- `dimension_scores`
- `selected_dimensions`
- `research_lens`

Keep helpers that summarize counts, notes, warnings, errors, and scope
recommendations.

- [ ] **Step 2: Render compact research state**

Render:

- completion or warning state
- total question count
- must-answer count
- section count
- notes count
- warning, error, and scope recommendation copy when present

Do not render a dimensions or lens panel.

- [ ] **Step 3: Run focused UI tests**

Run:

```bash
cd app && npm run test:unit -- research-summary-card
```

Expected: summary-card tests pass.

Commit:

```bash
git add app/src/components/research-summary-card.tsx app/src/__tests__/components/research-summary-card.test.tsx
git commit -m "VU-1150: simplify research summary display"
```

### Task 5: Rewrite the Workspace Research Skill

**Files:**

- Modify: `agent-sources/workspace/skills/research/SKILL.md`
- Delete:
  `agent-sources/workspace/skills/research/references/consolidation-handoff.md`
- Delete:
  `agent-sources/workspace/skills/research/references/dimension-sets.md`
- Delete:
  `agent-sources/workspace/skills/research/references/scoring-rubric.md`
- Delete:
  `agent-sources/workspace/skills/research/references/dimensions/*.md`
- Modify: `agent-sources/workspace/skills/shared/schemas.md`
- Modify: `agent-sources/prompts/research.txt`

- [ ] **Step 1: Replace the skill overview**

In `agent-sources/workspace/skills/research/SKILL.md`, make the core rule:

```md
Workflow research is one inline pass. Use internal scope checks, internal lens
checks, and internal candidate scoring to decide what to ask. Emit only the
final `research_complete` JSON.
```

- [ ] **Step 2: Add the topic scope gate**

Document this internal gate:

| Score | Meaning | Output behavior |
|---|---|---|
| 5 | Clearly bounded data or analytics skill | Proceed to lens checks |
| 4 | Useful with modest ambiguity | Proceed and include targeted clarifications |
| 3 | Relevant but too broad | Return narrowing clarification questions only |
| 2 | Weak data-engineering relevance | Return scope recommendation |
| 1 | Not a useful skill topic | Return scope recommendation |

Use examples such as `HR analytics` as a broad topic that needs narrowing
before research can create a useful skill.

- [ ] **Step 3: Add internal lens relevance checks**

Document the four internal lenses:

| Lens | Consider when the topic may depend on |
|---|---|
| Business process | Business events, grain, lifecycle, metrics, rules, exceptions, segmentation, periods |
| Data engineering standards | Modeling standards, layers, quality gates, load patterns, historization, naming, tests |
| Source system customizations | Custom objects, custom fields, overridden semantics, lifecycle state, extraction, reconciliation |
| Platform standards | Azure, Fabric, orchestration, deployment, environments, configuration, operational failures |

The skill should ask: "Is this lens relevant for this topic?" for each lens.
Irrelevant lenses should not generate candidate topics. Relevant lenses may all
contribute candidates.

- [ ] **Step 4: Add candidate-topic scoring**

Document the internal candidate score:

| Score | Keep? | Meaning |
|---|---|---|
| 5 | Yes | Organization-specific answer is likely essential to skill correctness |
| 4 | Yes | Answer would materially change generated skill behavior |
| 3 | Maybe | Keep only if needed for minimum useful coverage |
| 2 | No | Generic answer is likely enough |
| 1 | No | Nice-to-know or outside requested skill scope |

Score each candidate by:

- what people typically get wrong
- what is absent from baseline LLM knowledge
- what organizations commonly customize
- whether the answer would change the generated skill

- [ ] **Step 5: Remove intermediate-output instructions**

Delete instructions to emit or hand off:

- dimension sets
- dimension scores
- selected dimensions
- intermediate JSON
- consolidation notes
- `research_plan`
- `research_lens`

- [ ] **Step 6: Delete obsolete workspace references**

Delete the obsolete reference files listed in this task. Then run:

```bash
rg "consolidation-handoff|dimension-sets|scoring-rubric|references/dimensions" agent-sources/workspace/skills/research agent-sources/workspace/skills/shared
```

Expected: no matches.

- [ ] **Step 7: Update shared schema instructions**

In `agent-sources/workspace/skills/shared/schemas.md`, state that research
outputs must include only the final clarifications object and must not include
intermediate planning fields.

- [ ] **Step 8: Run agent structural tests**

Run:

```bash
cd app && npm run test:agents:structural
```

Expected: structural tests pass.

Commit:

```bash
git add agent-sources/workspace agent-sources/prompts/research.txt
git commit -m "VU-1150: simplify workspace research skill"
```

### Task 6: Update Workflow Parsers and Artifact Tests

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/src-tauri/src/commands/workflow_artifacts.rs`
- Modify: affected parser or artifact tests found by `rg`

- [ ] **Step 1: Remove workflow assertions for `dimensions_selected`**

Run:

```bash
rg "dimensions_selected|research_plan|research_lens|dimension_scores|selected_dimensions" app/src-tauri
```

Update parser and artifact tests so they accept the clean-break output only.
Assertions that verify absence are allowed.

- [ ] **Step 2: Run workflow contract tests**

Run:

```bash
cd app/src-tauri && cargo test commands::workflow
cd app/src-tauri && cargo test contracts::
```

Expected: workflow and contract tests pass.

Commit:

```bash
git add app/src-tauri/src/commands app/src-tauri/src/contracts
git commit -m "VU-1150: remove workflow dimension handling"
```

### Task 7: Update Evals for the Clean-Break Flow

**Files:**

- Modify:
  `tests/evals/packages/skill-content-researcher-research/prompt.txt`
- Modify:
  `tests/evals/packages/skill-content-researcher-research/promptfooconfig.json`
- Modify:
  `tests/evals/packages/skill-content-researcher-skill-builder/prompt.txt`
- Modify:
  `tests/evals/packages/skill-content-researcher-skill-builder/promptfooconfig.json`
- Modify: `tests/evals/packages/workspace-workflow-step-prompt/prompt.txt`
- Modify:
  `tests/evals/packages/workspace-workflow-step-prompt/promptfooconfig.json`

- [ ] **Step 1: Update eval prompt expectations**

Each affected eval prompt should require:

- one inline research flow
- internal topic scope gate
- internal relevance check for all four lenses
- internal candidate-topic scoring
- low-value candidate pruning
- final `research_complete` JSON only
- no emitted intermediate JSON, lens metadata, dimension metadata, or
  consolidation artifacts

- [ ] **Step 2: Update eval assertions**

For the affected `promptfooconfig.json` files, assert that outputs do not
contain:

```txt
dimensions_selected
metadata.research_plan
research_plan
metadata.research_lens
research_lens
dimension_scores
selected_dimensions
consolidation
handoff
```

Add positive assertions for:

```txt
status
question_count
research_output
scope_recommendation
priority_questions
```

- [ ] **Step 3: Audit all eval packages**

Run:

```bash
rg "dimensions_selected|research_plan|research_lens|dimension_scores|selected_dimensions|all_dimensions_low_score|consolidation-handoff|scoring-rubric" tests/evals/packages
```

Expected: no matches outside negative assertions that intentionally ban legacy
fields.

- [ ] **Step 4: Run deterministic eval harness tests**

Run:

```bash
cd tests/evals && npm test
```

Expected: deterministic harness tests pass.

- [ ] **Step 5: Run targeted live evals**

Run:

```bash
cd tests/evals && npm run eval:skill-content-researcher-research
cd tests/evals && npm run eval:skill-content-researcher-skill-builder
cd tests/evals && npm run eval:workspace-workflow-step-prompt
```

Expected: targeted evals pass or produce actionable failures for prompt tuning.

Commit:

```bash
git add tests/evals/packages
git commit -m "VU-1150: update research eval contract"
```

### Task 8: Final Verification and Repo Map Audit

**Files:**

- Modify: `repo-map.json` only if mapped files were added, removed, or renamed.
- Verify: all changed files.

- [ ] **Step 1: Run the full legacy-field audit**

Run:

```bash
rg "dimensions_selected|research_plan|research_lens|dimension_scores|selected_dimensions|all_dimensions_low_score|consolidation-handoff|scoring-rubric" app agent-sources/workspace tests/evals
```

Expected: no matches outside tests or eval assertions that intentionally check
absence.

- [ ] **Step 2: Run required validation**

Run:

```bash
cd app && npm run test:agents:structural
cd app && npm run test:unit
cd app && npm run codegen
cd app/src-tauri && cargo test contracts::
cd app/src-tauri && cargo test commands::workflow
cd tests/evals && npm test
```

Expected: all commands pass.

- [ ] **Step 3: Audit `repo-map.json`**

Run the required pre-PR map checks from `AGENTS.md`. Update `repo-map.json` in
the same implementation branch if any deleted or generated path is mapped.

- [ ] **Step 4: Commit final map or cleanup changes**

If `repo-map.json` or cleanup changes were required, run:

```bash
git add repo-map.json
git commit -m "VU-1150: align repo map after research cleanup"
```

If no final changes are required, record that in the implementation summary
instead of creating an empty commit.
