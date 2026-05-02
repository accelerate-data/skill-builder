# OpenHands Detailed Research Clean-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate workflow step 1 Detailed Research to the OpenHands-native clean-break model: app-owned prompt, shared `skill-creator` agent, task kind `workflow.detailed_research`, and additive clarifications merge behavior.

**Architecture:** Detailed Research should stop using the plugin-hosted `research-agent` as its runtime identity. The app will render `agent-sources/prompts/detailed-research.txt`, run OpenHands one-shot with `agent_name = "skill-creator"`, and validate the existing `DetailedResearchOutput` schema. The step may add sections, add top-level questions to existing or new sections, and add refinements under existing questions while preserving existing question identity.

**Tech Stack:** Tauri Rust workflow commands, OpenHands SDK sidecar runner, app-owned prompt templates, OpenHands `.agents` workspace layout, Rust workflow contract tests, Vitest sidecar tests, Promptfoo eval packages.

---

## Source Design

- Design doc: `docs/design/workflow-detailed-research-clean-break/README.md`
- Parent migration branch: `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`
- Implementation branch should be a child branch and PR back to the parent branch.

## Scope

In scope:

- Add `agent-sources/prompts/detailed-research.txt`.
- Add a step 1 prompt builder in Rust.
- Add a step 1 OpenHands config builder using `skill-creator`.
- Set task kind to `workflow.detailed_research`.
- Preserve the existing step 1 output schema.
- Make the detailed-research prompt allow new sections, new top-level questions, and refinements.
- Update detailed-research deterministic evals.
- Update static topology canaries.
- Keep old schema files removed.

Out of scope:

- Creating a separate OpenHands `detailed-research` agent.
- Keeping `research-agent` as a compatibility fallback for step 1.
- Migrating Confirm Decisions or Generate Skill.
- Changing the workflow UI step sequence.

## File Structure

- Create: `agent-sources/prompts/detailed-research.txt`
  - App-owned prompt for workflow step 1.
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`
  - Add `DETAILED_RESEARCH_TEMPLATE` and `build_step1_prompt(...)`.
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
  - Add `build_workflow_detailed_research_sidecar_config(...)` and route step 1 through it.
- Modify: `app/src-tauri/src/commands/workflow/step_config.rs`
  - Change step 1 canonical agent identity from `research-agent` to `skill-creator` where appropriate.
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
  - Add prompt, runtime config, and additive output tests.
- Modify: `app/sidecar/mock-agent.ts`
  - Keep mock step 1 behavior working after `agent_name = "skill-creator"` and `taskKind = "workflow.detailed_research"`.
- Modify: `app/sidecar/__tests__/mock-agent.test.ts`
  - Cover mock routing for step 1 clean-break config.
- Modify: `tests/evals/assertions/workflow-openhands-static.test.js`
  - Add detailed-research prompt and task-kind coverage.
- Modify: `tests/evals/packages/skill-content-researcher-detailed-research/prompt.txt`
  - Update eval prompt to the clean-break model.
- Modify: `tests/evals/packages/skill-content-researcher-detailed-research/promptfooconfig.json`
  - Tighten assertions for additive merge behavior.
- Modify if stale: `tests/evals/docs/scenario-inventory.md`
  - Describe the detailed-research package as `skill-creator` plus `workflow.detailed_research`.
- Modify if stale: `repo-map.json`
  - Update descriptions that still say detailed research is hosted under `research-agent`.

## Task 1: Add Failing Rust Tests For Step 1 Clean-Break Routing

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/tests.rs`

- [ ] **Step 1: Add a prompt rendering test**

Add a test near the existing step 0 and answer-evaluator prompt tests:

```rust
#[test]
fn detailed_research_prompt_renders_clean_break_task_context() {
    let prompt = super::prompt::build_step1_prompt(
        "pipeline-value",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
    );

    assert!(prompt.contains("Use the detailed research prompt"));
    assert!(prompt.contains("Skill name: pipeline-value"));
    assert!(prompt.contains("/tmp/workspace/skills/pipeline-value"));
    assert!(prompt.contains("/context/clarifications.json"));
    assert!(prompt.contains("/answer-evaluation.json"));
    assert!(prompt.contains("workflow step 1"));
    assert!(prompt.contains("detailed_research_complete"));
    assert!(prompt.contains("can add new sections"));
    assert!(prompt.contains("can add new top-level questions"));
    assert!(prompt.contains("can add refinement questions"));
    assert!(!prompt.contains("research-agent"));
    assert!(!prompt.to_ascii_lowercase().contains("subagent"));
    assert!(!prompt.to_ascii_lowercase().contains("delegate"));
}
```

- [ ] **Step 2: Add a runtime config test**

Add a test near `build_workflow_research_sidecar_config` coverage:

```rust
#[test]
fn detailed_research_sidecar_config_uses_skill_creator_openhands_contract() {
    let llm = workflow_llm_config_for_tests();
    let config = super::runtime::build_workflow_detailed_research_sidecar_config(
        "pipeline-value",
        "prompt",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        llm,
        Some("workflow-session-1".to_string()),
    );

    assert_eq!(config.mode.as_deref(), Some("one-shot"));
    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(config.task_kind.as_deref(), Some("workflow.detailed_research"));
    assert_eq!(config.runtime_provider.as_deref(), Some("openhands"));
    assert_eq!(config.run_source.as_deref(), Some("workflow"));
    assert_eq!(config.step_id, Some(1));
    assert_eq!(config.skill_name.as_deref(), Some("pipeline-value"));
    assert_eq!(config.output_format, workflow_output_format_for_step(1));
    assert!(config.path_to_claude_code_executable.is_none());
}
```

- [ ] **Step 3: Update canonical step config tests**

Update `test_step_config_canonical_agent_names` expectations so step 1 expects
`skill-creator` after implementation:

```rust
assert_eq!(get_step_config(1).unwrap().agent_name, "skill-creator");
```

Keep step 0 as already established by the current tests and implementation.

- [ ] **Step 4: Run the failing tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected before implementation: failures for missing `build_step1_prompt`,
missing `build_workflow_detailed_research_sidecar_config`, and old step 1 agent
identity.

## Task 2: Add The App-Owned Detailed Research Prompt

**Files:**

- Create: `agent-sources/prompts/detailed-research.txt`
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`

- [ ] **Step 1: Create the prompt file**

Create `agent-sources/prompts/detailed-research.txt` with this body:

```text
EXECUTE IMMEDIATELY. Do not greet the user, ask questions, or offer options.

Use the detailed research prompt to produce workflow step 1 output for this skill.

Skill name: {{skill_name}}
Workspace directory: {{workspace_dir}}
User context file: {{workspace_dir}}/user-context.md
Answer evaluation file: {{workspace_dir}}/answer-evaluation.json
Clarifications file: {{workspace_dir}}/context/clarifications.json
Context directory: {{workspace_dir}}/context

All directories already exist. Do not create directories with mkdir. Do not list directories with ls.

Read user-context.md, answer-evaluation.json, and context/clarifications.json.
Use answer-evaluation.json as the source of truth for which answers are clear, vague, missing, contradictory, or need refinement. Do not reclassify those verdicts.

This is workflow step 1. Return DetailedResearchOutput only.

You can add new sections when the user's answers reveal a new decision area.
You can add new top-level questions to existing sections when the missing decision belongs in that section.
You can add refinement questions under existing questions when a specific answer needs a narrower follow-up.

Preserve every existing section and every existing top-level question. Do not delete, reorder, renumber, or rewrite existing questions. Append only.

Recompute metadata after merging:
- metadata.question_count is the number of top-level questions only.
- metadata.section_count is the number of sections.
- metadata.refinement_count is the total number of refinement questions.
- metadata.must_answer_count includes top-level questions and refinements where must_answer is true.
- metadata.priority_questions includes every top-level or refinement ID where must_answer is true.
- metadata.duplicates_removed counts duplicate candidate additions that were dropped.

Every question object must include refinements. Use an empty array when there are no refinements.
Do not return transient planning fields such as parent_question_id, detailed_research_type, target_section_id, or merge_action.

Return only a raw JSON object with this envelope:
{
  "status": "detailed_research_complete",
  "refinement_count": number,
  "section_count": number,
  "clarifications_json": { ...canonical clarifications.json object... }
}
```

- [ ] **Step 2: Add the template include**

In `app/src-tauri/src/commands/workflow/prompt.rs`, add:

```rust
const DETAILED_RESEARCH_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/detailed-research.txt"
));
```

- [ ] **Step 3: Add `build_step1_prompt`**

Add this function near `build_step0_prompt`:

```rust
/// Build the prompt for step 1 (detailed research).
pub(crate) fn build_step1_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
) -> String {
    let workspace_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    DETAILED_RESEARCH_TEMPLATE
        .trim_end_matches('\n')
        .replace("{{skill_name}}", skill_name)
        .replace("{{workspace_dir}}", &workspace_str)
}
```

- [ ] **Step 4: Run the prompt test**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml detailed_research_prompt_renders_clean_break_task_context
```

Expected: the new prompt rendering test passes.

## Task 3: Route Step 1 Through `skill-creator`

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/workflow/step_config.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`

- [ ] **Step 1: Add the detailed research config builder**

In `runtime.rs`, add this builder next to
`build_workflow_research_sidecar_config`:

```rust
pub(crate) fn build_workflow_detailed_research_sidecar_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
    workflow_session_id: Option<String>,
) -> SidecarConfig {
    let workspace_root_dir = workspace_path.replace('\\', "/");
    let workspace_run_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name)
            .to_string_lossy()
            .replace('\\', "/");

    let mut config =
        crate::agents::sidecar::build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
            prompt: prompt.to_string(),
            llm,
            workspace_root_dir,
            workspace_run_dir,
            agent_name: "skill-creator".to_string(),
            task_kind: Some("workflow.detailed_research".to_string()),
            user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
            allowed_tools: tools_for_agent("research-agent"),
            max_turns: 50,
            output_format: workflow_output_format_for_step(1),
            skill_name: Some(skill_name.to_string()),
            step_id: Some(1),
            run_source: Some("workflow".to_string()),
            plugin_slug: plugin_slug.to_string(),
        });
    config.workflow_session_id = workflow_session_id;
    config.transcript_log_dir = Some(
        crate::skill_paths::workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name)
            .join("logs")
            .to_string_lossy()
            .into_owned(),
    );
    config
}
```

- [ ] **Step 2: Render step 1 with the new prompt**

In `run_workflow_step_inner`, change prompt selection to:

```rust
let prompt = match step_id {
    0 => build_step0_prompt(
        skill_name,
        workspace_path,
        &settings.plugin_slug,
        settings.max_dimensions,
    ),
    1 => build_step1_prompt(
        skill_name,
        workspace_path,
        &settings.plugin_slug,
    ),
    _ => build_prompt(&super::prompt::PromptParams {
        skill_name,
        workspace_path,
        plugin_slug: &settings.plugin_slug,
        skills_path: &settings.skills_path,
        author_login: settings.author_login.as_deref(),
        created_at: settings.created_at.as_deref(),
        step_id,
    }),
};
```

- [ ] **Step 3: Build step 1 with the native one-shot helper**

In the config selection, change from `if step_id == 0` to a `match`:

```rust
let config = match step_id {
    0 => build_workflow_research_sidecar_config(
        skill_name,
        &prompt,
        workspace_path,
        &settings.plugin_slug,
        settings.llm.clone(),
        workflow_session_id,
    ),
    1 => build_workflow_detailed_research_sidecar_config(
        skill_name,
        &prompt,
        workspace_path,
        &settings.plugin_slug,
        settings.llm.clone(),
        workflow_session_id,
    ),
    _ => SidecarConfig {
        // existing generic step config unchanged
    },
};
```

Keep the existing generic `SidecarConfig` branch for steps 2 and 3.

- [ ] **Step 4: Update step config agent identity**

In `step_config.rs`, change step 1:

```rust
let agent = "skill-creator";
```

Keep the allowed tools for step 1 research-capable. If tests expect tools from
`research-agent`, make the step 1 config explicitly use those tools while the
runtime identity remains `skill-creator`.

- [ ] **Step 5: Run workflow tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: prompt/config tests pass, and existing materialization tests still pass.

## Task 4: Update Mock Routing For Step 1

**Files:**

- Modify: `app/sidecar/mock-agent.ts`
- Modify: `app/sidecar/__tests__/mock-agent.test.ts`

- [ ] **Step 1: Add task-kind routing for detailed research**

In `resolveStepTemplate`, add a branch before old agent-name checks:

```ts
if (config?.taskKind === "workflow.detailed_research") {
  return "step1-detailed-research";
}
```

- [ ] **Step 2: Add a mock-agent test**

In `app/sidecar/__tests__/mock-agent.test.ts`, add:

```ts
it("routes skill-creator workflow.detailed_research to step1 detailed research template", () => {
  expect(
    resolveStepTemplate("skill-creator", {
      stepId: 1,
      taskKind: "workflow.detailed_research",
    }),
  ).toBe("step1-detailed-research");
});
```

- [ ] **Step 3: Run sidecar mock tests**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/mock-agent.test.ts
```

Expected: mock routing tests pass.

## Task 5: Strengthen Additive Merge Materialization Tests

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/tests.rs`

- [ ] **Step 1: Add a detailed-research output fixture test**

Add a test that passes a `DetailedResearchOutput` containing:

- existing section `S1`
- existing questions `Q1`, `Q2`, `Q3`
- a new refinement `R3.1` under `Q3`
- a new top-level question `Q4` in `S1`
- a new section `S2` with `Q5`

Use this JSON shape:

```rust
let output = serde_json::json!({
    "status": "detailed_research_complete",
    "refinement_count": 1,
    "section_count": 2,
    "clarifications_json": {
        "version": "1",
        "metadata": {
            "question_count": 5,
            "section_count": 2,
            "refinement_count": 1,
            "must_answer_count": 4,
            "priority_questions": ["Q1", "Q3", "R3.1", "Q5"],
            "duplicates_removed": 0,
            "scope_recommendation": false,
            "scope_reason": null,
            "warning": null,
            "error": null
        },
        "sections": [
            {
                "id": "S1",
                "title": "Existing section",
                "questions": [
                    {
                        "id": "Q1",
                        "title": "Existing clear question",
                        "text": "Which layers are in scope?",
                        "must_answer": true,
                        "choices": [],
                        "answer_text": "Bronze, silver, gold",
                        "refinements": []
                    },
                    {
                        "id": "Q2",
                        "title": "Existing clear question",
                        "text": "What is the incremental policy?",
                        "must_answer": false,
                        "choices": [],
                        "answer_text": "Merge on natural key and updated_at",
                        "refinements": []
                    },
                    {
                        "id": "Q3",
                        "title": "Existing vague question",
                        "text": "Who uses this skill?",
                        "must_answer": true,
                        "choices": [],
                        "answer_text": "TBD",
                        "refinements": [
                            {
                                "id": "R3.1",
                                "title": "Primary user persona",
                                "text": "Which primary role should this skill optimize for?",
                                "must_answer": true,
                                "choices": [],
                                "refinements": []
                            }
                        ]
                    },
                    {
                        "id": "Q4",
                        "title": "New section-level question",
                        "text": "What naming convention should generated models follow?",
                        "must_answer": false,
                        "choices": [],
                        "refinements": []
                    }
                ]
            },
            {
                "id": "S2",
                "title": "New governance section",
                "questions": [
                    {
                        "id": "Q5",
                        "title": "Approval process",
                        "text": "Who approves changes to shared modeling standards?",
                        "must_answer": true,
                        "choices": [],
                        "refinements": []
                    }
                ]
            }
        ],
        "notes": [],
        "answer_evaluator_notes": []
    }
});
```

Materialize the output for step 1 and assert the written
`context/clarifications.json` keeps `S1`, adds `S2`, keeps `Q1`, adds `Q4`, and
adds `R3.1`.

- [ ] **Step 2: Run the materialization test**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml detailed_research
```

Expected: all detailed-research schema/materialization tests pass.

## Task 6: Update Deterministic Evals

**Files:**

- Modify: `tests/evals/packages/skill-content-researcher-detailed-research/prompt.txt`
- Modify: `tests/evals/packages/skill-content-researcher-detailed-research/promptfooconfig.json`
- Modify: `tests/evals/assertions/workflow-openhands-static.test.js`
- Modify: `tests/evals/docs/scenario-inventory.md`

- [ ] **Step 1: Update the eval prompt**

Change the prompt opening to:

```text
EXECUTE IMMEDIATELY - do not greet the user, do not ask questions, do not offer options.

This is the workflow step 1 prompt for the OpenHands `skill-creator` detailed-research pass using task kind `workflow.detailed_research` and app-owned prompt `agent-sources/prompts/detailed-research.txt`. Use the inline app context as if it came from the workspace files.
```

Remove references to OpenHands `research-agent`.

- [ ] **Step 2: Add representative allowed additions**

In the eval instructions, require the model to preserve existing questions and
add at least one detailed-research addition. Use explicit text:

```text
The output may add a new section, add a top-level question to the existing section, and add refinements under existing questions. Preserve Q1, Q2, and Q3. Do not rewrite their answers.
```

- [ ] **Step 3: Tighten the JavaScript assertion**

Replace the assertion with logic that verifies:

```js
const match = output.match(/\{[\s\S]*\}/);
if (!match) return false;
const data = JSON.parse(match[0]);
const clarifications = data.clarifications_json;
const sections = clarifications && clarifications.sections;
const questions = Array.isArray(sections)
  ? sections.flatMap((s) => Array.isArray(s.questions) ? s.questions : [])
  : [];
const byId = new Map(questions.map((q) => [q.id, q]));
const refinements = questions.flatMap((q) =>
  Array.isArray(q.refinements) ? q.refinements : []
);
const serialized = JSON.stringify(data);
return data.status === 'detailed_research_complete'
  && Number.isInteger(data.refinement_count)
  && Number.isInteger(data.section_count)
  && clarifications.version === '1'
  && data.section_count === sections.length
  && clarifications.metadata.section_count === sections.length
  && clarifications.metadata.question_count === questions.length
  && clarifications.metadata.refinement_count === refinements.length
  && byId.has('Q1')
  && byId.has('Q2')
  && byId.has('Q3')
  && questions.every((q) => Array.isArray(q.refinements))
  && (questions.length > 3 || sections.length > 1 || refinements.length > 0)
  && !serialized.includes('parent_question_id')
  && !serialized.includes('detailed_research_type')
  && !serialized.includes('merge_action');
```

- [ ] **Step 4: Update static topology canary**

In `tests/evals/assertions/workflow-openhands-static.test.js`, add
`agent-sources/prompts/detailed-research.txt` to `activeWorkflowFiles` and add
detailed-research eval files to `packageEvidence`.

Require these tokens:

```js
'workflow.detailed_research',
'agent-sources/prompts/detailed-research.txt',
```

Keep the assertion that package evidence does not include `research-agent`.

- [ ] **Step 5: Update scenario inventory**

Change the detailed-research row to describe:

```markdown
| `skill-content-researcher-detailed-research` | Detailed research merge | Rewrite | Covers OpenHands `skill-creator` step 1 `workflow.detailed_research` additive merge behavior. |
```

- [ ] **Step 6: Run deterministic eval harness tests**

Run:

```bash
cd tests/evals && npm test
```

Expected: deterministic eval harness tests pass.

## Task 7: Update Repo Map And Structural Docs

**Files:**

- Modify if needed: `repo-map.json`
- Modify if needed: `TEST_MAP.md`

- [ ] **Step 1: Search for stale detailed-research routing language**

Run:

```bash
rg -n "research-agent|detailed-research|workflow\\.detailed_research|agent-sources/prompts/detailed-research" repo-map.json TEST_MAP.md docs agent-sources app tests/evals
```

- [ ] **Step 2: Update stale repo-map descriptions**

If `repo-map.json` still says detailed research is hosted by
`research-agent.md`, update the description to say step 1 Detailed Research uses
`agent-sources/prompts/detailed-research.txt` with the shared OpenHands
`skill-creator` agent.

- [ ] **Step 3: Confirm no stale active prompt routing remains**

Run:

```bash
cd tests/evals && npm test -- --test-name-pattern workflow-openhands-static
```

Expected: static topology test passes and fails if `research-agent` returns to
active detailed-research eval coverage.

## Task 8: Run Quality Gates

**Files:**

- All changed files

- [ ] **Step 1: Run Rust workflow tests**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: all workflow tests pass.

- [ ] **Step 2: Run sidecar tests**

```bash
cd app/sidecar && npx vitest run
```

Expected: all sidecar tests pass.

- [ ] **Step 3: Run agent structural tests**

```bash
cd app && npm run test:agents:structural
```

Expected: structural tests pass.

- [ ] **Step 4: Run deterministic eval tests**

```bash
cd tests/evals && npm test
```

Expected: deterministic eval tests pass.

- [ ] **Step 5: Run TypeScript check**

```bash
cd app && npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Run targeted detailed-research live smoke eval**

```bash
cd tests/evals && ./scripts/promptfoo.sh eval --no-cache --filter-pattern '^\\[smoke\\]' -c packages/skill-content-researcher-detailed-research/promptfooconfig.json
```

Expected: the detailed-research smoke case passes.

- [ ] **Step 7: Run broader gates if runtime behavior changed beyond step 1**

If the implementation touches shared runtime events, shared output
materialization, or frontend workflow rendering, also run:

```bash
cd app && npm run test:unit
cd app && bash tests/run.sh e2e --tag @workflow
```

Expected: both commands pass.

## Task 9: Commit And PR

**Files:**

- All changed files

- [ ] **Step 1: Review diff**

```bash
git diff --stat
git diff
```

Expected: diff only contains detailed-research clean-break migration, eval
updates, and required map/doc updates.

- [ ] **Step 2: Commit**

```bash
git add agent-sources/prompts/detailed-research.txt \
  app/src-tauri/src/commands/workflow/prompt.rs \
  app/src-tauri/src/commands/workflow/runtime.rs \
  app/src-tauri/src/commands/workflow/step_config.rs \
  app/src-tauri/src/commands/workflow/tests.rs \
  app/sidecar/mock-agent.ts \
  app/sidecar/__tests__/mock-agent.test.ts \
  tests/evals/assertions/workflow-openhands-static.test.js \
  tests/evals/packages/skill-content-researcher-detailed-research/prompt.txt \
  tests/evals/packages/skill-content-researcher-detailed-research/promptfooconfig.json \
  tests/evals/docs/scenario-inventory.md \
  repo-map.json TEST_MAP.md
git commit -m "VU-XXXX: migrate detailed research to OpenHands clean break"
```

Omit unchanged files from `git add`.

- [ ] **Step 3: Push and raise PR**

```bash
git push -u origin feature/<issue-id>-openhands-detailed-research-clean-break
gh pr create \
  --base feature/vu-1145-implement-openhands-native-clean-break-agent-runtime \
  --head feature/<issue-id>-openhands-detailed-research-clean-break \
  --title "VU-XXXX: migrate detailed research to OpenHands" \
  --body "Fixes VU-XXXX"
```

Expected: PR targets the VU-1145 parent branch, not `main`.
