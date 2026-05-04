# E2E DB Migration Fixes + Mock Mode Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all E2E tests broken by the clarifications/decisions JSON→DB migration, and remove the dead `MOCK_AGENTS` sidecar mock mode and its infrastructure.

**Architecture:** Two independent cleanup tracks — (1) fix the Tauri E2E mock layer to serve `get_clarifications`/`get_decisions` DB commands instead of dead `read_file` file-based lookups, then propagate the correct fixtures through every affected spec; (2) delete the `MOCK_AGENTS` sidecar path (compiled mock code, mock templates, desktop-smoke spec, orphaned fixture) since `sidecar-bridge.js` no longer exists and all real agent runs go through the OpenHands Agent Server runtime.

**Tech Stack:** Playwright E2E, Vitest unit, TypeScript, compiled Node.js sidecar (`dist/agent-runner.js`)

---

## Why These Tests Are Broken

### DB migration gap in the E2E mock
`ResearchStepComplete` and `DetailedResearchStepComplete` now call `useClarifications(skillName)` → `invokeCommand("get_clarifications", ...)`. `DecisionsStepComplete` calls `useDecisions(skillName)` → `invokeCommand("get_decisions", ...)`. Neither command exists in `app/src/test/mocks/tauri-e2e.ts`, so both return `undefined` in E2E tests. The components render their "not found in database" error state instead of showing content.

Affected tests (all `@workflow`):
- `workflow-smoke.spec.ts` — Scenario 1 ("Research Complete" text), Scenario 8 (Detailed Research Re-run), Scenario 9 (Decisions completion)
- `workflow-gate.spec.ts` — all 5 gate tests (Continue button requires ResearchSummaryCard which requires `get_clarifications`)
- `display-items.spec.ts` — "renders OpenHands conversation events and terminal state" (expects "Research Complete" button after `conversation_state` completed)

### MOCK_AGENTS infrastructure is dead
`app/e2e/desktop-smoke/desktop-smoke.spec.ts` tests 3–4 import `createSidecarBridge` from `"../helpers/sidecar-bridge.js"` which does not exist — these tests fail at import time. The `dist/mock-templates/` content and the `runMockAgent` code in `dist/agent-runner.js` (compiled from a deleted `mock-agent.ts`) are unreachable dead code.

---

## File Structure

| File | Action | Why |
|------|--------|-----|
| `app/src/test/mocks/tauri-e2e.ts` | Modify | Add `get_clarifications`/`get_decisions` defaults; remove dead `resolveContextFileCommand` and 3 stale mock entries |
| `app/e2e/helpers/workflow-helpers.ts` | Modify | Add `get_clarifications` DTO mock to `WORKFLOW_OVERRIDES`; remove `clarifications.json` from `read_file` map |
| `app/e2e/workflow/workflow-gate.spec.ts` | Modify | Remove stale `clarifications.json` `read_file` entries from `GATE1_OVERRIDES` / `GATE2_OVERRIDES` |
| `app/e2e/workflow/workflow-smoke.spec.ts` | Modify | Scenario 9: replace `read_file` decisions entries with `get_decisions` DTO mock |
| `app/e2e/desktop-smoke/desktop-smoke.spec.ts` | Delete | Tests 3–4 import non-existent `sidecar-bridge.js`; tests 1–2 duplicate `dashboard-smoke` |
| `app/sidecar/dist/mock-templates/` | Delete | Dead — `runMockAgent` is unreachable without MOCK_AGENTS |
| `app/e2e/fixtures/agent-responses/review-content.json` | Delete | Not imported by any test file |
| `app/sidecar/dist/agent-runner.js` | Modify | Remove `// mock-agent.ts` compiled section (lines 1346–1876); remove MOCK_AGENTS conditional |

---

## Task 1: Drop MOCK_AGENTS Infrastructure

**Files:**
- Delete: `app/e2e/desktop-smoke/desktop-smoke.spec.ts`
- Delete: `app/sidecar/dist/mock-templates/` (entire directory)
- Delete: `app/e2e/fixtures/agent-responses/review-content.json`
- Modify: `app/sidecar/dist/agent-runner.js`

- [ ] **Step 1: Delete the desktop-smoke spec and orphaned fixtures**

```bash
cd /path/to/worktree
rm app/e2e/desktop-smoke/desktop-smoke.spec.ts
rmdir app/e2e/desktop-smoke
rm -rf app/sidecar/dist/mock-templates
rm app/e2e/fixtures/agent-responses/review-content.json
rmdir app/e2e/fixtures/agent-responses 2>/dev/null || true
```

- [ ] **Step 2: Verify the deletions**

```bash
ls app/e2e/desktop-smoke 2>&1   # should say "No such file"
ls app/sidecar/dist/mock-templates 2>&1  # should say "No such file"
ls app/e2e/fixtures/agent-responses 2>&1  # should say "No such file" (if dir was empty)
```

- [ ] **Step 3: Strip the mock-agent section from `dist/agent-runner.js`**

The compiled file has a section marker `// mock-agent.ts` and ends just before `// agent-runner.ts`. Remove everything from the `// mock-agent.ts` comment to the line before `// agent-runner.ts` (lines 1346–1876 inclusive as of this writing).

Find `// mock-agent.ts` — this is the start of the section to remove. Find `// agent-runner.ts` — everything from there to EOF is the persistent runner which must be kept.

The edit removes `MOCK_SCENARIO`, `resolveStepTemplate`, `writeMockOutputFiles`, `buildStructuredMockResult`, `runMockAgent`, and the `MOCK_ONLY_ERROR` variable.

Use `grep -n "// mock-agent.ts\|// agent-runner.ts" app/sidecar/dist/agent-runner.js` to confirm current line numbers before editing.

After deleting that block, find the `agent_request` handler inside `runPersistent`. Replace the try body from:

```javascript
try {
  if (process.env.MOCK_AGENTS !== "true") {
    throw new Error(MOCK_ONLY_ERROR);
  }
  process.stderr.write("[sidecar] Mock agent mode\n");
  await runMockAgent(
    config,
    (message2) => writeLine(wrapWithRequestId(request_id, message2)),
    abortController.signal
  );
} catch (err) {
```

with:

```javascript
try {
  throw new Error(
    "The Node.js sidecar does not run agents. All agent requests must use the Rust-managed OpenHands Agent Server runtime."
  );
} catch (err) {
```

- [ ] **Step 4: Verify the sidecar still starts without syntax errors**

```bash
node --input-type=module --eval "import('./app/sidecar/dist/agent-runner.js')" 2>&1 | head -5
# Expected: no syntax error (the process will hang waiting for stdin — Ctrl-C is fine)
```

- [ ] **Step 5: Run the sidecar unit tests to verify nothing regressed**

```bash
cd app/sidecar && npx vitest run
```

Expected: all tests pass (sidecar tests cover `result-extraction.ts` and config utilities, not the mock agent runner).

- [ ] **Step 6: Commit**

```bash
git add -A app/e2e/desktop-smoke \
  app/sidecar/dist/mock-templates \
  app/e2e/fixtures/agent-responses \
  app/sidecar/dist/agent-runner.js
git commit -m "chore: remove MOCK_AGENTS sidecar mode and dead test infrastructure"
```

---

## Task 2: Add DB Command Defaults to `tauri-e2e.ts`

**Files:**
- Modify: `app/src/test/mocks/tauri-e2e.ts`

Background: The `mockResponses` object is the static fallback when no `__TAURI_MOCK_OVERRIDES__` entry exists for a command. It currently has no entries for `get_clarifications` or `get_decisions`, so both return `undefined` when not explicitly overridden. The file also has a dead `resolveContextFileCommand` function that handled the now-deleted `get_clarifications_content` / `get_decisions_content` / `get_context_file_content` commands.

- [ ] **Step 1: Add the two new DB command defaults to `mockResponses`**

In `app/src/test/mocks/tauri-e2e.ts`, find the block:

```typescript
  save_clarification_answers: undefined,
  save_clarifications_content: undefined,
  read_file: "",
```

Replace with:

```typescript
  get_clarifications: null,
  get_decisions: null,
  read_file: "",
```

This removes the stale `parse_clarifications`, `save_clarification_answers`, and `save_clarifications_content` entries (these commands were deleted in VU-1157) and adds the two DB commands. The `null` default means "no data in DB" — the same semantics as an optional `ClarificationsDto | null` return.

- [ ] **Step 2: Remove the dead `resolveContextFileCommand` function and its call-site**

Find and delete the entire `resolveContextFileCommand` function (it references the deleted `get_clarifications_content` and `get_decisions_content` commands):

```typescript
function resolveContextFileCommand(
  cmd: string,
  args: Record<string, unknown> | undefined,
  readFileSource: unknown,
  skillsPathOverride?: string | null,
): unknown {
  const fileName = cmd === "get_clarifications_content"
    ? "clarifications.json"
    : cmd === "get_decisions_content"
      ? "decisions.json"
      : (typeof args?.fileName === "string" ? args.fileName : "");

  const candidates = resolveContextFilePathCandidates({ ...(args ?? {}), fileName }, skillsPathOverride);
  for (const candidate of candidates) {
    const resolved = resolveReadFileMock(readFileSource, { filePath: candidate, path: candidate });
    if (typeof resolved === "string") return resolved;
  }

  // Fall back to wildcard/opaque read_file behavior.
  return resolveReadFileMock(readFileSource, args);
}
```

Also delete the call-site block in `invoke()`:

```typescript
  if (
    cmd === "get_clarifications_content"
    || cmd === "get_decisions_content"
    || cmd === "get_context_file_content"
  ) {
    const skillsPathOverride =
      overrides
      && typeof overrides.get_settings === "object"
      && overrides.get_settings !== null
      && !Array.isArray(overrides.get_settings)
      && typeof (overrides.get_settings as Record<string, unknown>).skills_path === "string"
      ? (overrides.get_settings as Record<string, unknown>).skills_path as string
      : null;
    const readSource = overrides && "read_file" in overrides
      ? overrides.read_file
      : mockResponses.read_file;
    return resolveContextFileCommand(cmd, args, readSource, skillsPathOverride) as T;
  }
```

- [ ] **Step 3: TypeScript-check the mock file**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run unit tests to confirm no regressions**

```bash
cd app && npm run test:unit
```

Expected: all 603 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/test/mocks/tauri-e2e.ts
git commit -m "fix(e2e-mock): add get_clarifications/get_decisions defaults, remove dead file-based command handling"
```

---

## Task 3: Add `get_clarifications` to `WORKFLOW_OVERRIDES`

**Files:**
- Modify: `app/e2e/helpers/workflow-helpers.ts`

Background: `WORKFLOW_OVERRIDES` is the base override object spread into almost every workflow E2E test. Adding `get_clarifications` here fixes all tests that navigate to a completed Research or Detailed Research step (Scenario 1, Scenario 8, all display-items tests, and the gate tests via spread). `get_decisions: null` is also added as an explicit default.

- [ ] **Step 1: Add the DB command mocks to `WORKFLOW_OVERRIDES`**

In `app/e2e/helpers/workflow-helpers.ts`, find the existing `WORKFLOW_OVERRIDES` object. Add two new entries after `get_step_agent_runs: []`:

```typescript
  get_step_agent_runs: [],
  // DB-authoritative commands (replaced file reads in VU-1145/VU-1157)
  get_clarifications: {
    skill_id: "test-skill",
    version: "1",
    refinement_count: 0,
    must_answer_count: 0,
    question_count: 1,
    section_count: 1,
    title: "Clarifications",
    created_at: 0,
    updated_at: 0,
    sections: [
      { section_id: 1, ordinal: 0, title: "General" },
    ],
    questions: [
      {
        question_id: "Q1",
        section_id: 1,
        parent_question_id: null,
        ordinal: 0,
        title: "Primary focus",
        text: "What should this skill enable the agent to do?",
        must_answer: false,
        answer_choice: null,
        answer_text: null,
        choices: [],
        refinements: [],
      },
    ],
    notes: [],
  },
  get_decisions: null,
```

- [ ] **Step 2: Remove `clarifications.json` from the `read_file` map**

Find the `read_file` block in `WORKFLOW_OVERRIDES`:

```typescript
  read_file: {
    [skillContextPath(E2E_SKILLS_PATH, "test-skill", "research-plan.md")]:
      "# Research Results\n\nAnalysis complete.",
    [skillContextPath(E2E_SKILLS_PATH, "test-skill", "clarifications.json")]:
      '{"version":"1","metadata":{"title":"Test","question_count":1,"section_count":1,"refinement_count":0,"must_answer_count":0,"priority_questions":[]},"sections":[],"notes":[]}',
    [skillContextPath(E2E_WORKSPACE_PATH, "test-skill", "research-plan.md")]:
      "# Research Results\n\nAnalysis complete.",
    [skillContextPath(E2E_WORKSPACE_PATH, "test-skill", "clarifications.json")]:
      '{"version":"1","metadata":{"title":"Test","question_count":1,"section_count":1,"refinement_count":0,"must_answer_count":0,"priority_questions":[]},"sections":[],"notes":[]}',
    "*": "",
  },
```

Replace with (keep `research-plan.md` for file-viewer fallback compatibility; remove the stale `clarifications.json` entries):

```typescript
  read_file: {
    [skillContextPath(E2E_SKILLS_PATH, "test-skill", "research-plan.md")]:
      "# Research Results\n\nAnalysis complete.",
    [skillContextPath(E2E_WORKSPACE_PATH, "test-skill", "research-plan.md")]:
      "# Research Results\n\nAnalysis complete.",
    "*": "",
  },
```

- [ ] **Step 3: TypeScript-check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/e2e/helpers/workflow-helpers.ts
git commit -m "fix(e2e): add get_clarifications DTO mock to WORKFLOW_OVERRIDES for DB-driven step completion"
```

---

## Task 4: Fix `workflow-gate.spec.ts`

**Files:**
- Modify: `app/e2e/workflow/workflow-gate.spec.ts`

Background: `GATE1_OVERRIDES` and `GATE2_OVERRIDES` spread `WORKFLOW_OVERRIDES` (which now has `get_clarifications`), so the DB command is covered. The only remaining issue is that both gate override objects still have `clarifications.json` in their `read_file` maps — stale entries that will never be read by the current component code. Leaving them is harmless but misleading. Remove them for clarity. The `answer-evaluation.json` `read_file` path is set dynamically by `setReadFileToEvaluation()` at runtime — that path is unaffected.

- [ ] **Step 1: Remove `clarifications.json` entries from `GATE1_OVERRIDES`**

Find `GATE1_OVERRIDES` in `workflow-gate.spec.ts`:

```typescript
const GATE1_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 0, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: {
    [SKILLS_CLARIFICATIONS_PATH]: CLARIFICATIONS_BASE,
    [SKILLS_RESEARCH_PLAN_PATH]: RESEARCH_PLAN_CONTENT,
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};
```

Replace with:

```typescript
const GATE1_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 0, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: {
    [SKILLS_RESEARCH_PLAN_PATH]: RESEARCH_PLAN_CONTENT,
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};
```

- [ ] **Step 2: Remove `clarifications.json` entry from `GATE2_OVERRIDES`**

Find `GATE2_OVERRIDES`:

```typescript
const GATE2_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 1, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
    ],
  },
  read_file: {
    [SKILLS_CLARIFICATIONS_PATH]: CLARIFICATIONS_BASE,
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};
```

Replace with:

```typescript
const GATE2_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 1, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
    ],
  },
  read_file: {
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};
```

- [ ] **Step 3: Remove now-unused constants**

If `CLARIFICATIONS_BASE` and `SKILLS_CLARIFICATIONS_PATH` are only used in the removed `read_file` entries, delete both constants. Check with:

```bash
grep -n "CLARIFICATIONS_BASE\|SKILLS_CLARIFICATIONS_PATH" app/e2e/workflow/workflow-gate.spec.ts
```

If the grep shows only the constant declaration lines, delete:
```typescript
const SKILLS_CLARIFICATIONS_PATH = skillContextPath(E2E_SKILLS_PATH, "test-skill", "clarifications.json");
```
and the entire `const CLARIFICATIONS_BASE = JSON.stringify({ ... });` block.

- [ ] **Step 4: TypeScript-check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/e2e/workflow/workflow-gate.spec.ts
git commit -m "fix(e2e): remove stale clarifications.json read_file entries from gate overrides"
```

---

## Task 5: Fix `workflow-smoke.spec.ts` Scenario 9 (Decisions Step)

**Files:**
- Modify: `app/e2e/workflow/workflow-smoke.spec.ts`

Background: `DecisionsStepComplete` (step 2) now uses `useDecisions(skillName)` → `invokeCommand("get_decisions", ...)` to load decision content from the DB. Scenario 9 currently mocks `read_file` with `decisions.json` content — this is never read by the component. Replace those `read_file` entries with a `get_decisions` DTO mock. The `DECISIONS_JSON` local constant is no longer needed.

- [ ] **Step 1: Replace the decisions mock in Scenario 9**

Find `step2Overrides` in the "step 2 (Confirm Decisions) shows completion UI" test:

```typescript
    const DECISIONS_JSON = JSON.stringify({
      version: "1",
      metadata: { decision_count: 1, conflicts_resolved: 0, round: 1 },
      decisions: [
        {
          id: "D1",
          title: "Primary framework",
          original_question: "Which framework should the skill target?",
          decision: "React with TypeScript",
          implication: "All examples use React + TS patterns",
          status: "resolved",
        },
      ],
    });

    const step2Overrides: Record<string, unknown> = {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 2, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
      materialize_workflow_step_output: undefined,
      read_file: {
        ...WORKFLOW_OVERRIDES.read_file as Record<string, string>,
        [skillContextPath(E2E_SKILLS_PATH, "test-skill", "decisions.json")]: DECISIONS_JSON,
        [skillContextPath(E2E_WORKSPACE_PATH, "test-skill", "decisions.json")]: DECISIONS_JSON,
      },
    };
```

Replace with:

```typescript
    const step2Overrides: Record<string, unknown> = {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 2, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
      materialize_workflow_step_output: undefined,
      get_decisions: {
        skill_id: "test-skill",
        version: "1",
        round: 1,
        decision_count: 1,
        conflicts_resolved: 0,
        contradictory_inputs_state: null,
        created_at: 0,
        updated_at: 0,
        items: [
          {
            decision_id: "D1",
            ordinal: 0,
            title: "Primary framework",
            original_question: "Which framework should the skill target?",
            decision: "React with TypeScript",
            implication: "All examples use React + TS patterns",
            status: "resolved",
          },
        ],
      },
    };
```

Also remove the now-unused imports `skillContextPath`, `E2E_SKILLS_PATH`, `E2E_WORKSPACE_PATH` from this test **if** they are no longer used anywhere else in the file. Check with:

```bash
grep -n "skillContextPath\|E2E_SKILLS_PATH\|E2E_WORKSPACE_PATH" app/e2e/workflow/workflow-smoke.spec.ts
```

These constants are also used in Scenario 3 (`read_file: "# Partial Output..."`) — actually Scenario 3 uses `ERROR_STEP_OVERRIDES` which uses a plain string for `read_file`. Check if any remaining test still references them before removing.

- [ ] **Step 2: TypeScript-check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/e2e/workflow/workflow-smoke.spec.ts
git commit -m "fix(e2e): replace read_file decisions.json mock with get_decisions DTO in Scenario 9"
```

---

## Task 6: Validate All Smoke E2E Tests Pass

- [ ] **Step 1: Start the dev server in test mode**

```bash
cd app && npm run dev:test &
sleep 5  # wait for vite to compile
```

- [ ] **Step 2: Run the smoke E2E suite**

```bash
cd app && npx playwright test --project=smoke
```

Expected: all tests in `@workflow`, `@dashboard`, `@refine`, `@description`, `@evals`, `@settings`, `@setup`, `@skills` pass. The desktop-smoke spec no longer exists and won't appear.

- [ ] **Step 3: Run unit tests to confirm no regressions**

```bash
cd app && npm run test:unit
```

Expected: 603 tests pass.

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix(e2e): final fixups after smoke validation"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `get_clarifications` missing in E2E mock → Task 2 adds default, Task 3 adds DTO mock in `WORKFLOW_OVERRIDES`
- ✅ `get_decisions` missing in E2E mock → Task 2 adds default, Task 5 adds DTO mock for Scenario 9
- ✅ Gate tests broken (no Continue button) → Fixed by Task 3 (`get_clarifications` in `WORKFLOW_OVERRIDES` which gate overrides spread)
- ✅ display-items "Research Complete" button → Fixed by Task 3 (same spread mechanism)
- ✅ Dead `resolveContextFileCommand` / `get_clarifications_content` / `get_decisions_content` handling → Removed in Task 2
- ✅ `MOCK_AGENTS` sidecar mode → Dropped in Task 1
- ✅ `desktop-smoke.spec.ts` (broken import) → Deleted in Task 1
- ✅ `mock-templates/` directory → Deleted in Task 1
- ✅ `review-content.json` orphan → Deleted in Task 1

**Placeholder scan:** All code blocks contain exact TypeScript. No "add appropriate handling" placeholders.

**Type consistency:** DTO shapes match `ClarificationsDto` and `DecisionsDto` as defined in `app/src/generated/contracts.ts` lines 81–108 and 166–179.
