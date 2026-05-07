<!-- markdownlint-disable MD031 MD032 -->

# VU-1162 Research Contract Invariants Defaults Lenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the OpenHands research contract so `researching-skill-requirements` separates `Invariants`, `Defaults`, and `Purpose-Specific Lenses`, collapse new-skill purpose selection to three active purposes, and add eval coverage that proves the contract across business-process, data-engineering, and source-system-semantics contexts.

**Architecture:** Keep the workflow spine in the shared research skill and align the app-owned step-0 and step-1 prompts to that contract. Add deterministic guardrails plus a purpose-matrix eval suite so business-process, data-engineering, and source-system-semantics skills all respect the new invariants. Within the source purpose, split eval coverage between SaaS semantics and DB-based or legacy extraction contexts so extraction mechanics are asked only when material.

**Tech Stack:** Markdown skill prompts, Promptfoo eval packages, Node test runner.

---

## Discovery

- Linear issue: `VU-1162`
- Functional spec: user-directed source `[custom-plugin-management](</Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime/docs/functional/custom-plugin-management/README.md>)`
- Related design docs:
  - [docs/design/openhands-runtime-model/README.md](/Users/hbanerjee/src/worktrees/feature/vu-1162-reframe-researching-skill-requirements-around-invariants/docs/design/openhands-runtime-model/README.md)
  - [docs/design/openhands-runtime-model/README.md](/Users/hbanerjee/src/worktrees/feature/vu-1162-reframe-researching-skill-requirements-around-invariants/docs/design/openhands-runtime-model/README.md)
  - [docs/design/skill-purpose-taxonomy/README.md](/Users/hbanerjee/src/worktrees/feature/vu-1162-reframe-researching-skill-requirements-around-invariants/docs/design/skill-purpose-taxonomy/README.md)
- Related implementation plan:
  - [docs/plan/2026-05-01-vu-1135-skill-builder-eval-coverage.md](/Users/hbanerjee/src/worktrees/feature/vu-1162-reframe-researching-skill-requirements-around-invariants/docs/plan/2026-05-01-vu-1135-skill-builder-eval-coverage.md)
- Linear comments / linked docs: unavailable in this session because Linear research MCP is expired; use issue body, labels, and repo context.
- Manual tests: No manual tests required.

## Eval Scenario Matrix To Add

- Step 0 business-process scenario:
  - no output-format / artifact-contract / naming-contract questions
  - no test-case / eval-case / validation-suite questions
  - does ask metrics, calculations, reconciliation, reporting hierarchy, and modeling implications
- Step 0 data-engineering scenario:
  - no output-format / artifact-contract / naming-contract questions
  - no test-case / eval-case / validation-suite questions
  - no output-format / artifact-contract / naming-contract questions
  - no test-case / eval-case / validation-suite questions
  - does ask modeling, reconciliation, quality, dbt, dlt, Fabric, and naming-convention questions
- Step 0 source-system-semantics SaaS scenario:
  - no output-format / artifact-contract / naming-contract questions
  - no test-case / eval-case / validation-suite questions
  - does ask business rules, flexfields, custom fields, custom objects, stages, workflows, and semantic mapping questions
  - does not default to CDC, delete handling, schema drift, or extraction-path questions
- Step 0 source-system-semantics DB/legacy scenario:
  - no output-format / artifact-contract / naming-contract questions
  - no test-case / eval-case / validation-suite questions
  - may ask CDC, delete handling, schema drift, extraction, pagination, or replication questions when they materially affect transformations
- Step 1 detailed-research business-process scenario:
  - refinements stay domain/workflow-focused
  - refinements do not reintroduce output-format or test-case asks
- Step 1 detailed-research data-engineering scenario:
  - refinements stay standards/modeling-focused
  - refinements do not reintroduce output-format or test-case asks
- Step 1 detailed-research source-system-semantics SaaS scenario:
  - refinements stay source business-rule and semantic-mapping focused
  - refinements do not introduce extraction mechanics or eval design
- Step 1 detailed-research source-system-semantics DB/legacy scenario:
  - refinements may continue CDC/delete/schema-drift/extraction mechanics when they materially affect transformations
  - refinements do not ask for eval design

## Tasks

### Task 1: Reframe The Shared Research Contract

**Files:**
- Modify: `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md`
- Modify: `agent-sources/workspace/agents/skill-creator.md`
- Modify: `agent-sources/prompts/detailed-research.txt`
- Modify: `agent-sources/prompts/research.txt` only if wording still conflicts after the skill update
- Modify: `agent-sources/prompts/confirm_decisions.txt`
- Modify: `app/src/lib/types.ts`
- Modify: `app/src/components/skill-dialog.tsx`
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`
- Modify: `app/src-tauri/src/commands/skill/suggestions.rs`
- Modify: `docs/design/openhands-runtime-model/README.md`
- Add: `docs/design/skill-purpose-taxonomy/README.md`

- [x] Step 1: Verify the current contract still mixes outputs/tests with research ownership

Run:
```bash
rg -n "output format|test cases|expected outputs|validation criteria" \
  agent-sources/workspace/skills/researching-skill-requirements/SKILL.md \
  agent-sources/workspace/agents/skill-creator.md \
  agent-sources/prompts/research.txt \
  agent-sources/prompts/detailed-research.txt
```
Expected: matches show the stale contract points that this issue removes.

- [x] Step 2: Update `researching-skill-requirements` to separate `Invariants`, `Defaults`, and `Purpose-Specific Lenses`

Apply a minimal edit shaped like:
```md
## Invariants
1. Do not ask about output formats, artifact contracts, schemas, naming contracts, or presentation layouts for this skill family.
2. Do not ask the user to design test cases, eval cases, or validation suites.
...

## Defaults
- Assume durable data-engineering pipeline context unless user context overrides it.
- Assume systems-of-record to lakehouse / medallion flow unless user context overrides it.
- Assume workspace naming, lakehouse naming, security boundaries, deployment topology, monitoring, managed identity/access model, endpoint behavior, environment promotion, and model organization are harness-owned unless the user context explicitly says the skill is consuming an already-fixed contract.
- For source-system-semantics skills, ask custom business-rule and semantic questions first; ask CDC/delete/schema-drift/extraction questions only for DB-based or legacy contexts, or when the user context makes them materially relevant.
...

## Purpose-Specific Lenses
- Business process knowledge: ...
- Data engineering standards: ...
- Source system semantics: ...
```

- [x] Step 3: Align the shared `skill-creator` brief and step-1 detailed-research prompt to the same ownership boundaries

Edit wording so these files talk about workflow decisions, defaults, constraints, and validation semantics instead of output-format negotiation or test-case design.

- [x] Step 4: Run a narrow grep to confirm the removed phrases are gone from the edited contract files

Note: repo-wide matches still exist in other skill-generation files outside `VU-1162` scope. The edited research-contract files no longer contain the removed phrases.

Run:
```bash
rg -n "Should test cases verify the skill|What output format|what outputs or tests would prove it works" \
  agent-sources/workspace \
  agent-sources/prompts
```
Expected: no matches in the edited clean-break contract files.

### Task 2: Add Deterministic Contract Guards

**Files:**
- Modify: `tests/evals/assertions/workflow-openhands-static.test.js`

- [x] Step 1: Add a static assertion that the research skill contains `## Invariants`, `## Defaults`, and `## Purpose-Specific Lenses`

Add a test that checks:
```js
for (const token of ['## Invariants', '## Defaults', '## Purpose-Specific Lenses']) {
  assert.ok(skill.includes(token));
}
```

- [x] Step 2: Add static assertions that stale output-format and test-case prompts are absent

Add checks that fail if the skill still contains strings such as:
```js
'What output format, artifact contract, schema, naming, or handoff should it produce?'
'Should test cases verify the skill?'
```

- [x] Step 3: Run the targeted deterministic assertion file

Run:
```bash
cd tests/evals && node --test assertions/workflow-openhands-static.test.js
```
Expected: the new assertion passes; any unrelated pre-existing failures are recorded separately and not silently ignored.

Recorded blocker: the new `VU-1162` assertion passes; the file still has a pre-existing unrelated failure for missing `agent-sources/prompts/workflow-step.txt`.

### Task 3: Expand Step-0 Research Eval Coverage To A Three-Purpose Matrix With Source Split

**Files:**
- Modify: `tests/evals/packages/skill-content-researcher-research/prompt.txt`
- Modify: `tests/evals/packages/skill-content-researcher-research/promptfooconfig.json`

- [x] Step 1: Keep the existing smoke contract case intact

Do not weaken the existing `[smoke]` scenario that checks canonical `research_complete` output shape.

- [x] Step 2: Add or strengthen purpose-specific scenarios in `promptfooconfig.json`

Add cases for:
```json
[
  "[positive] business-process research avoids output-format and test-case asks",
  "[positive] data-engineering research avoids output-format and test-case asks",
  "[positive] source-system-semantics SaaS research stays semantic and avoids extraction drift",
  "[positive] source-system-semantics DB research preserves extraction mechanics when material"
]
```

- [x] Step 3: Encode the invariant checks directly in assertions

For business-process and data-engineering cases, assert the synthesized question text does **not** contain:
```js
/output format|artifact contract|naming contract|presentation layout|test case|eval case|validation suite/i
```

For source-system-semantics SaaS, assert:
```js
/custom field|custom object|workflow|semantic|mapping/i.test(text)
```
and still reject:
```js
/cdc|schema drift|delete handling|bulk api|pagination|rate limit|test case|eval case|validation suite/i.test(text)
```

For source-system-semantics DB/legacy, assert:
```js
/cdc|schema drift|rate limit|replication|transformation|delete/i.test(text)
```
and still reject:
```js
/test case|eval case|validation suite/i.test(text)
```

- [x] Step 4: Run the affected step-0 eval package

Run:
```bash
cd tests/evals && npm run eval:skill-content-researcher-research
```
Expected: the new purpose-matrix scenarios pass or identify the exact prompt leak to fix next.

### Task 4: Expand Step-1 Detailed-Research Eval Coverage To A Three-Purpose Matrix With Source Split

**Files:**
- Modify: `tests/evals/packages/skill-content-researcher-detailed-research/prompt.txt`
- Modify: `tests/evals/packages/skill-content-researcher-detailed-research/promptfooconfig.json`

- [x] Step 1: Parameterize the detailed-research prompt so test vars can swap the skill name, clarifications JSON, and verdict block

Refactor the prompt shape from hardcoded `fabric-dbt-standards` fixtures to placeholders such as:
```txt
We are writing the skill {{skill_name}}.
Answer-evaluation verdict:
{{answer_verdict_json}}
Existing clarifications_json:
{{clarifications_json}}
```

- [x] Step 2: Add purpose-specific refinement scenarios

Add cases for:
```json
[
  "[positive] detailed research business-process refinements avoid output-format and test-case asks",
  "[positive] detailed research data-engineering refinements avoid output-format and test-case asks",
  "[positive] detailed research source-system-semantics SaaS refinements stay semantic and avoid extraction drift",
  "[positive] detailed research source-system-semantics DB refinements preserve extraction mechanics when material"
]
```

- [x] Step 3: Assert the refinements preserve the right lens

Use purpose-specific positive-term checks:
```js
// business-process
/metric|calculation|stage|reconciliation|hierarchy/i

// data-engineering
/model|reconciliation|quality|dbt|dlt|fabric|deployment/i

// source-system-semantics SaaS
/custom|field|semantic|mapping|workflow|stage/i

// source-system-semantics DB
/cdc|schema drift|rate limit|replication|delete|transformation/i
```

- [x] Step 4: Assert the banned asks stay banned in refinements

Reject:
```js
/output format|artifact contract|naming contract|presentation layout|test case|eval case|validation suite/i
```
with the source-system-semantics DB/legacy exception limited to extraction and replication mechanics, not presentation or eval design.

- [x] Step 5: Run the affected step-1 eval package

Run:
```bash
cd tests/evals && npm run eval:skill-content-researcher-detailed-research
```
Expected: all source-split refinement scenarios pass or show the exact refinement leak to fix.

Status: package reruns improved from `3/5` to `4/5` after prompt hardening. The remaining red case is the SaaS source-system-semantics scenario, which still shows provider output-wrapper instability at package level.

### Task 5: Reapply The Saved Working Diff Carefully And Finish Verification

**Files:**
- Modify: files from Tasks 1-4 only

- [x] Step 1: Compare the transferred working diff against the plan before further edits

Run:
```bash
git diff --stat
```
Expected: only the planned research-contract and eval files are dirty, plus any intentionally preserved docs artifacts already transferred into this worktree.

- [x] Step 2: Run changed-area deterministic verification

Run:
```bash
cd app && npm run test:agents:structural
cd tests/evals && node --test assertions/workflow-openhands-static.test.js
```
Expected: structural tests pass; static assertion file passes except for any unrelated pre-existing failures that are explicitly documented.

- [x] Step 3: Run the two affected live eval packages

Run:
```bash
cd tests/evals && npm run eval:skill-content-researcher-research
cd tests/evals && npm run eval:skill-content-researcher-detailed-research
```
Expected: the three-purpose matrix plus source-context split cases pass, or provider/runtime failures are captured exactly.

Status:
- `research` latest full package run: `4/6` passed
- `detailed-research` latest full package run: `4/5` passed
- `confirm-decisions` latest full package run: `3/4` passed
- deterministic gates are green; remaining live failures are output-wrapper noncompliance or nondeterministic model behavior rather than unresolved schema-wiring defects

- [ ] Step 4: Create a checkpoint commit after green local verification

Run:
```bash
git add agent-sources tests/evals docs/plan/2026-05-05-vu-1162-research-contract-invariants-defaults-lenses.md
git commit -m "VU-1162: reframe research contract and extend eval coverage"
```

## Independent Gates

- Code review: `superpowers:requesting-code-review`
- Simplification review: `engineering-skills:code-simplifier`
- Test coverage review: `superpowers:requesting-code-review` with a coverage-focused brief
- Acceptance-criteria review: independent subagent against `VU-1162`

## Verification Commands

- `cd app && npm run test:agents:structural`
- `cd tests/evals && node --test assertions/workflow-openhands-static.test.js`
- `cd tests/evals && npm run eval:skill-content-researcher-research`
- `cd tests/evals && npm run eval:skill-content-researcher-detailed-research`
- `git diff --stat`

## Remaining Risks To Watch

- Linear comment/document context could not be fetched in this session because the Linear research MCP is expired; rely on issue body plus repo evidence unless that session is restored.
- The source-system-semantics DB/legacy exception is easy to over-broaden; keep it limited to extraction and ingestion mechanics, not presentation contracts.
- The live eval provider may still fail for external billing/runtime reasons even when the deterministic contract changes are correct.
