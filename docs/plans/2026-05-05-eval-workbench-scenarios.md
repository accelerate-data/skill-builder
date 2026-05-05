# Eval Workbench Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Eval Workbench to use git-backed scenario YAML files in `{plugin}/evals/{skill_name}/`, rename "Prompt set" to "Scenario", share scenarios between Performance and Trigger tabs via mode tags, and add LLM assistance for scenario and assertion generation.

**Prerequisite:** `docs/plans/2026-05-05-plugin-folder-structure.md` must be merged first. This plan assumes the canonical skill path is `{skills_dir}/{plugin_name}/skills/{skill_name}` and that the `eval_dir` template can be added as a sibling.

**Architecture:** Scenario YAML files are the source of truth. Tauri commands read/write YAML directly from the user's plugin directory. The active run-history path is the app-owned Promptfoo state under `<data_dir>/promptfoo`, while legacy prompt-set tables remain only for compatibility. Promptfoo config is generated in-memory from scenario files before each run. Scenario and assertion generation both use the app-owned OpenHands one-shot path.

**Tech Stack:** Rust / serde_yaml / Tauri / React / TanStack Query / Promptfoo sidecar. New Tauri commands for scenario CRUD. Frontend renames and tag UI. One-shot generation prompts are app-owned.

**Design doc:** `docs/design/eval-workbench-scenarios/README.md`

---

## Completion Audit (2026-05-05)

This section audits the implementation on branch
`feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`
at commit `15042444`.

### Top-level task status

- [x] Task 1 completed in code: `eval_dir` template and `resolve_eval_dir()` landed.
- [x] Task 2 completed in code: scenario YAML types and filesystem helpers landed.
- [x] Task 3 completed in code: scenario CRUD/read commands and typed frontend wrappers landed.
- [x] Task 4 completed in code: shared scenario pool, mode tags, and active UI rename landed.
- [x] Task 5 completed after doc alignment: scenario generation ships through the app-owned OpenHands one-shot path, and the plan/design now describe that runtime boundary directly.
- [x] Task 6 completed after doc alignment: assertion suggestion shipped and the design index was updated.
- [x] Independent review gate complete: backend and frontend review findings were addressed in follow-up hardening changes and the targeted validation suite was rerun successfully.

### Acceptance criteria audit

No separate repo-local AC checklist was found in this worktree. The design scope
and plan goal are the nearest local acceptance source, so this audit checks
those requirements directly.

- [x] Scenarios are file-backed YAML under `{plugin}/evals/{skill_name}/`.
- [x] The active Eval Workbench flow is scenario-first rather than prompt-set-first.
- [x] Performance and Trigger tabs share the same scenario pool, filtered by mode tags.
- [x] Scenarios support `performance`, `trigger`, and `both` tags.
- [x] Scenario CRUD is implemented through Tauri filesystem commands.
- [x] Scenario execution reads from scenario files and persists run history through Promptfoo-sidecar history support.
- [x] Scenario generation is available from the workbench UI.
- [x] Assertion suggestion is available per case.
- [x] Design/index docs are aligned with the shipped behavior, including app-owned Promptfoo history.
- [x] Scenario generation is documented as an app-owned OpenHands one-shot flow rather than a repo-owned eval harness asset.
- [x] Independent quality-gate review is closed with reviewer findings addressed.

### Validation evidence

- [x] `cd app && npx tsc --noEmit`
- [x] `cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::eval_workbench`
- [x] `cd app && npx vitest run src/__tests__/lib/eval-workbench-tauri.test.ts src/__tests__/components/workspace/workspace-evals.test.tsx src/__tests__/components/workspace/workspace-description.test.tsx src/__tests__/components/workspace/workspace-shell.test.tsx`
- [x] `cd app/promptfoo-sidecar && npm run build`
- [x] `cd app/promptfoo-sidecar && npm test`
- [x] `cd app && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

---

## File Structure

| File | Change |
|---|---|
| `app/plugin-paths.json` | Add `eval_dir` template |
| `app/src-tauri/src/skill_paths.rs` | Add `resolve_eval_dir()` helper |
| `app/src-tauri/Cargo.toml` | Add `serde_yaml` dependency |
| `app/src-tauri/src/commands/eval_workbench/scenarios.rs` | New: CRUD commands for scenario files |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Register new commands; update run command to accept scenario name + mode |
| `app/src-tauri/src/lib.rs` | Register new Tauri commands |
| `app/src/lib/eval-workbench.ts` | Add scenario types; add `invokeCommand` wrappers for new commands |
| `app/src/lib/tauri-command-types.ts` | Add new command type entries |
| `app/src/lib/queries/eval-scenarios.ts` | New: TanStack Query hooks for scenario list/read/write |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Wire scenario selector; pass tags to sub-tabs |
| `app/src/components/workspace/workspace-evals.tsx` | Consume scenario type; rename prompt set UI labels |
| `app/src/components/workspace/workspace-description.tsx` | Consume scenario type; show `both`-tagged scenarios |
| `agent-sources/workspace/agents/scenario-generator.md` | New: one-shot agent for LLM scenario generation |

---

### Task 1: Add `eval_dir` to `plugin-paths.json` and Rust helper

**Files:**

- Modify: `app/plugin-paths.json`
- Modify: `app/src-tauri/src/skill_paths.rs`

- [ ] **Step 1: Write failing test**

In `app/src-tauri/src/skill_paths.rs` tests:

```rust
#[test]
fn test_resolve_eval_dir() {
    let root = Path::new("/users/alice/my-plugins");
    let dir = resolve_eval_dir(root, "superpowers", "analyzing-bookings");
    assert_eq!(
        dir,
        Path::new("/users/alice/my-plugins/superpowers/evals/analyzing-bookings")
    );
}
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml test_resolve_eval_dir 2>&1 | grep -E "FAILED|ok|error"
```

Expected: compile error (function doesn't exist).

- [ ] **Step 3: Add `eval_dir` to `plugin-paths.json`**

```json
{
  "eval_dir": "{root}/{plugin_slug}/evals/{skill_name}"
}
```

Add `eval_dir` to the `PluginPaths` struct and add the resolver function in `skill_paths.rs`:

```rust
// In PluginPaths struct:
pub eval_dir: String,

// New function:
pub fn resolve_eval_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    resolve_path_template(
        &paths().eval_dir,
        &[
            ("root", &root.to_string_lossy()),
            ("plugin_slug", plugin_slug),
            ("skill_name", skill_name),
        ],
    )
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml test_resolve_eval_dir 2>&1 | grep -E "FAILED|ok"
```

- [ ] **Step 5: Commit**

```bash
git add app/plugin-paths.json app/src-tauri/src/skill_paths.rs
git commit -m "feat: add eval_dir template and resolve_eval_dir helper"
```

---

### Task 2: Define scenario types and file read/write in Rust

**Files:**

- Create: `app/src-tauri/src/commands/eval_workbench/scenarios.rs`
- Modify: `app/src-tauri/Cargo.toml`

- [ ] **Step 1: Add `serde_yaml` to Cargo.toml**

```toml
[dependencies]
serde_yaml = "0.9"
```

- [ ] **Step 2: Write failing tests**

In a new test module at the bottom of `scenarios.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_scenario() -> Scenario {
        Scenario {
            name: "Regression".into(),
            tags: vec![ScenarioTag::Performance, ScenarioTag::Trigger],
            cases: vec![ScenarioCase {
                id: "case-1".into(),
                prompt: "Show me Q3 booking trends".into(),
                expected_outcome: Some("Regional breakdown with trend direction".into()),
                should_trigger: Some(true),
                assertions: vec![],
            }],
        }
    }

    #[test]
    fn test_round_trip_yaml() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("regression.yaml");
        let scenario = sample_scenario();
        write_scenario_file(&path, &scenario).unwrap();
        let loaded = read_scenario_file(&path).unwrap();
        assert_eq!(loaded.name, "Regression");
        assert_eq!(loaded.cases.len(), 1);
        assert_eq!(loaded.tags, vec![ScenarioTag::Performance, ScenarioTag::Trigger]);
    }

    #[test]
    fn test_list_scenarios_returns_all_yaml_files() {
        let tmp = tempdir().unwrap();
        write_scenario_file(&tmp.path().join("a.yaml"), &sample_scenario()).unwrap();
        write_scenario_file(&tmp.path().join("b.yaml"), &sample_scenario()).unwrap();
        let scenarios = list_scenarios(tmp.path()).unwrap();
        assert_eq!(scenarios.len(), 2);
    }
}
```

- [ ] **Step 3: Run tests — verify compile error**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml scenarios 2>&1 | grep -E "error|FAILED"
```

- [ ] **Step 4: Implement the types and file helpers**

Create `app/src-tauri/src/commands/eval_workbench/scenarios.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioTag {
    Performance,
    Trigger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioAssertion {
    #[serde(rename = "type")]
    pub assertion_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioCase {
    pub id: String,
    pub prompt: String,
    pub expected_outcome: Option<String>,
    pub should_trigger: Option<bool>,
    #[serde(default)]
    pub assertions: Vec<ScenarioAssertion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scenario {
    pub name: String,
    pub tags: Vec<ScenarioTag>,
    pub cases: Vec<ScenarioCase>,
}

pub fn read_scenario_file(path: &Path) -> Result<Scenario, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

pub fn write_scenario_file(path: &Path, scenario: &Scenario) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    let content = serde_yaml::to_string(scenario)
        .map_err(|e| format!("Failed to serialize scenario: {}", e))?;
    fs::write(path, content)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

pub fn list_scenarios(eval_dir: &Path) -> Result<Vec<Scenario>, String> {
    if !eval_dir.exists() {
        return Ok(vec![]);
    }
    let mut scenarios = Vec::new();
    for entry in fs::read_dir(eval_dir)
        .map_err(|e| format!("Failed to read eval dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("yaml")
            && path.file_name().and_then(|n| n.to_str()) != Some("promptfooconfig.yaml")
        {
            scenarios.push(read_scenario_file(&path)?);
        }
    }
    scenarios.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(scenarios)
}

pub fn delete_scenario_file(eval_dir: &Path, scenario_name: &str) -> Result<(), String> {
    let filename = format!("{}.yaml", scenario_name.to_lowercase().replace(' ', "-"));
    let path = eval_dir.join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete {}: {}", path.display(), e))
    } else {
        Ok(())
    }
}

pub fn scenario_file_path(eval_dir: &Path, scenario_name: &str) -> PathBuf {
    let filename = format!("{}.yaml", scenario_name.to_lowercase().replace(' ', "-"));
    eval_dir.join(filename)
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml scenarios 2>&1 | grep -E "FAILED|ok"
```

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/src/commands/eval_workbench/scenarios.rs
git commit -m "feat: scenario YAML types and file read/write helpers"
```

---

### Task 3: Tauri commands for scenario CRUD

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts` (add invokeCommand wrappers)

- [ ] **Step 1: Write failing TypeScript test**

In `app/src/__tests__/lib/` add `eval-scenarios.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { invokeCommand } from "@/lib/tauri";

vi.mock("@/lib/tauri");

it("list_scenarios command is typed", () => {
  expect(() =>
    vi.mocked(invokeCommand).mockResolvedValue([])
  ).not.toThrow();
});
```

- [ ] **Step 2: Add Rust Tauri commands**

In `app/src-tauri/src/commands/eval_workbench/mod.rs`, add:

```rust
#[tauri::command]
pub async fn list_scenarios(
    skill_name: String,
    plugin_slug: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<scenarios::Scenario>, String> {
    let skills_path = state.resolve_skills_path()?;
    let eval_dir = skill_paths::resolve_eval_dir(&skills_path, &plugin_slug, &skill_name);
    scenarios::list_scenarios(&eval_dir)
}

#[tauri::command]
pub async fn save_scenario(
    skill_name: String,
    plugin_slug: String,
    scenario: scenarios::Scenario,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let skills_path = state.resolve_skills_path()?;
    let eval_dir = skill_paths::resolve_eval_dir(&skills_path, &plugin_slug, &skill_name);
    let path = scenarios::scenario_file_path(&eval_dir, &scenario.name);
    scenarios::write_scenario_file(&path, &scenario)
}

#[tauri::command]
pub async fn delete_scenario(
    skill_name: String,
    plugin_slug: String,
    scenario_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let skills_path = state.resolve_skills_path()?;
    let eval_dir = skill_paths::resolve_eval_dir(&skills_path, &plugin_slug, &skill_name);
    scenarios::delete_scenario_file(&eval_dir, &scenario_name)
}
```

Register in `app/src-tauri/src/lib.rs` alongside existing eval_workbench commands.

- [ ] **Step 3: Add TypeScript command types**

In `app/src/lib/tauri-command-types.ts`:

```typescript
list_scenarios: {
  args: { skillName: string; pluginSlug: string };
  result: ScenarioDto[];
};
save_scenario: {
  args: { skillName: string; pluginSlug: string; scenario: ScenarioDto };
  result: void;
};
delete_scenario: {
  args: { skillName: string; pluginSlug: string; scenarioName: string };
  result: void;
};
```

- [ ] **Step 4: Add TypeScript types to `eval-workbench.ts`**

```typescript
export type ScenarioTag = "performance" | "trigger";

export interface ScenarioAssertionDto {
  assertion_type: string;
  value: string;
}

export interface ScenarioCaseDto {
  id: string;
  prompt: string;
  expected_outcome?: string | null;
  should_trigger?: boolean | null;
  assertions: ScenarioAssertionDto[];
}

export interface ScenarioDto {
  name: string;
  tags: ScenarioTag[];
  cases: ScenarioCaseDto[];
}
```

- [ ] **Step 5: Run typecheck**

```bash
cd app && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Run cargo build**

```bash
cd app && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error" | head -10
```

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/commands/eval_workbench/ app/src-tauri/src/lib.rs app/src/lib/tauri-command-types.ts app/src/lib/eval-workbench.ts
git commit -m "feat: Tauri commands for scenario CRUD (list, save, delete)"
```

---

### Task 4: Frontend — rename labels, add tags, shared scenario pool

**Files:**

- Create: `app/src/lib/queries/eval-scenarios.ts`
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/workspace-description.tsx`

- [ ] **Step 1: Write failing component test**

In `app/src/__tests__/components/workspace-eval-workbench.test.tsx` (create if absent), add:

```typescript
it("shows 'New Scenario' button, not 'New prompt set'", async () => {
  render(<WorkspaceEvalWorkbench skillName="test-skill" pluginSlug="default" />);
  expect(await screen.findByText("New Scenario")).toBeInTheDocument();
  expect(screen.queryByText("New prompt set")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Create TanStack Query hooks**

Create `app/src/lib/queries/eval-scenarios.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import type { ScenarioDto } from "@/lib/eval-workbench";

export const evalScenarioKeys = {
  list: (skillName: string, pluginSlug: string) =>
    ["eval-scenarios", skillName, pluginSlug] as const,
};

export function useScenarios(skillName: string | null, pluginSlug: string) {
  return useQuery({
    queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
    queryFn: () =>
      invokeCommand("list_scenarios", { skillName: skillName!, pluginSlug }),
    enabled: !!skillName,
  });
}

export function useSaveScenario(skillName: string | null, pluginSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scenario: ScenarioDto) =>
      invokeCommand("save_scenario", { skillName: skillName!, pluginSlug, scenario }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug) });
    },
  });
}

export function useDeleteScenario(skillName: string | null, pluginSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scenarioName: string) =>
      invokeCommand("delete_scenario", { skillName: skillName!, pluginSlug, scenarioName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug) });
    },
  });
}
```

- [ ] **Step 3: Update `workspace-eval-workbench.tsx`**

Add a scenario selector at the top of the component. When Performance tab is active, show only scenarios tagged `"performance"` or `"both"`. When Trigger tab is active, show only `"trigger"` or `"both"`. The selected scenario is passed down to `WorkspaceEvals` and `WorkspaceDescription`.

Replace the "New prompt set" button with "New Scenario". Replace "Prompt set" section heading with "Scenarios".

- [ ] **Step 4: Rename labels throughout**

In `workspace-evals.tsx` and `workspace-description.tsx`, do a mechanical rename:

- `"New prompt set"` → `"New Scenario"`
- `"Prompt set name"` → `"Scenario name"`
- `"Save prompt set"` → `"Save scenario"`
- `"Case prompt"` → `"User prompt"`
- `"Run prompt set"` → `"Run scenario"`

Also add the tag selector (`performance`, `trigger`, `both`) when creating or editing a scenario.

- [ ] **Step 5: Add `should_trigger` field to cases in Performance/Trigger split**

A case in a `both`-tagged scenario shows two additional fields: `Expected outcome` (for performance mode) and a `Should trigger` toggle (for trigger mode). Cases in performance-only scenarios show only `Expected outcome`. Cases in trigger-only scenarios show only `Should trigger`.

- [ ] **Step 6: Run integration tests**

```bash
cd app && npm run test:integration 2>&1 | grep -E "FAILED|Tests "
```

Fix any broken snapshot or label assertion.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/queries/eval-scenarios.ts app/src/components/workspace/
git commit -m "feat: shared scenario pool with mode tags, rename Prompt set → Scenario"
```

---

### Task 5: LLM scenario generation agent

**Files:**

- Create: `agent-sources/workspace/agents/scenario-generator.md`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs` (new `generate_scenarios` command)
- Modify: frontend to add "Generate scenarios" button

- [ ] **Step 1: Write the agent prompt**

Create `agent-sources/workspace/agents/scenario-generator.md`:

```markdown
---
name: scenario-generator
description: Generates eval scenarios for a skill by reading its definition files
model: sonnet
output_schema:
  type: object
  properties:
    scenarios:
      type: array
      items:
        type: object
        properties:
          name: { type: string }
          tags: { type: array, items: { type: string, enum: [performance, trigger] } }
          cases:
            type: array
            items:
              type: object
              properties:
                id: { type: string }
                prompt: { type: string }
                expected_outcome: { type: string }
                should_trigger: { type: boolean }
---

You generate realistic eval scenarios for a skill based on its definition.

You will be given the path to a skill folder. Read SKILL.md and any supporting
context (clarifications, decisions) to understand what the skill does, what
inputs it expects, and what good output looks like.

Generate 3–5 named scenarios as structured output. Each scenario must have:
- A descriptive `name` (e.g., "Happy Path", "Edge Cases", "Negative Cases")
- `tags`: `["both"]` for core use cases, `["performance"]` for output quality cases,
  `["trigger"]` for selection boundary cases
- 2–4 `cases`, each with:
  - `id`: kebab-case unique identifier
  - `prompt`: a realistic user request that someone would type
  - `expected_outcome`: what a good skill response should contain or accomplish
    (omit for trigger-only cases)
  - `should_trigger`: true for prompts the skill should handle, false for
    out-of-scope prompts (omit for performance-only cases)

Focus on variety: happy paths, edge inputs, and at least one negative (should_trigger: false) case.
```

- [ ] **Step 2: Add `generate_scenarios` Tauri command**

In `eval_workbench/mod.rs`:

```rust
#[tauri::command]
pub async fn generate_scenarios(
    skill_name: String,
    plugin_slug: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    // Launch scenario-generator agent with the skill directory path as context.
    // Returns agent_id; frontend watches for completion via agent events.
    let settings = state.load_settings()?;
    let skills_path = settings.skills_path.ok_or("Skills path not set")?;
    let skill_dir = skill_paths::resolve_skill_dir(
        Path::new(&skills_path), &plugin_slug, &skill_name
    );
    // Pass skill_dir to the scenario-generator agent as the working context
    run_scenario_generator_agent(&skill_dir, &state).await
}
```

- [ ] **Step 3: Add "Generate scenarios" button to the frontend**

In the scenario section of `workspace-eval-workbench.tsx`, add a "Generate scenarios" button alongside "New Scenario". Clicking it invokes `generate_scenarios` and shows a loading state. On completion, the structured output is parsed and saved via `save_scenario` for each generated scenario, then the scenario list is refreshed.

- [ ] **Step 4: Run structural agent tests**

```bash
cd app && npm run test:agents:structural 2>&1 | grep -E "FAILED|PASS"
```

- [ ] **Step 5: Commit**

```bash
git add agent-sources/workspace/agents/scenario-generator.md app/src-tauri/src/commands/eval_workbench/mod.rs app/src/components/workspace/
git commit -m "feat: LLM scenario generation agent and Generate scenarios button"
```

---

### Task 6: LLM assertion generation

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs` (new `suggest_assertions` command)
- Modify: `app/src/components/workspace/workspace-evals.tsx` (per-case "Suggest assertions" action)

- [ ] **Step 1: Add `suggest_assertions` Tauri command**

This is a cheap one-shot call (not a full agent run). Add to `eval_workbench/mod.rs`:

```rust
#[tauri::command]
pub async fn suggest_assertions(
    prompt: String,
    expected_outcome: String,
    model: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SuggestedAssertion>, String> {
    // One-shot LLM call: given a user prompt and expected outcome,
    // return 1–3 promptfoo assertion expressions.
    // Uses the same one-shot infrastructure as generate_description_candidates.
    suggest_assertions_inner(prompt, expected_outcome, model, &state).await
}
```

The system prompt instructs the LLM to return an array of `{ type, value }` assertion objects appropriate for the expected behavior (llm-rubric for qualitative, contains for key terms, javascript for structural checks).

- [ ] **Step 2: Add per-case "Suggest assertions" button**

In `workspace-evals.tsx`, add a small "Suggest" button next to the assertions section of each case. When clicked, calls `suggest_assertions` with the case's current prompt and expected_outcome. The response populates the assertions list for review.

- [ ] **Step 3: Run typecheck and tests**

```bash
cd app && npx tsc --noEmit && npm run test:integration 2>&1 | grep -E "FAILED|Tests "
```

- [ ] **Step 4: Update design doc index**

In `docs/design/README.md`, add:

```markdown
| [eval-workbench-scenarios/](eval-workbench-scenarios/README.md) | Eval Workbench v2: git-backed scenario files, shared Performance/Trigger pool, LLM generation |
```

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/eval_workbench/ app/src/components/workspace/ docs/design/README.md
git commit -m "feat: LLM assertion suggestion per eval case"
```
