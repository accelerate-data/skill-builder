# VU-1145 Remaining Claude/Anthropic Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last Claude/Anthropic-branded identifiers and defaults from code, persisted payloads, and workspace agent content so the branch is genuinely provider-neutral end to end.

**Architecture:** Four self-contained renames plus one fallback removal. The most impactful change is `claude_mistakes → agent_mistakes`, which flows through the Rust suggestions struct, the Tauri IPC type, a UI accessor, prompt headings in `prompt.rs`, and a batch of test assertions. The other items are single-file edits. No schema migrations — `intake_json` is mutable at the application layer.

**Tech Stack:** Rust (Cargo / Tauri), TypeScript (Vite / Vitest), React

---

## Files Changed

| File | Change |
|---|---|
| `app/src-tauri/src/commands/skill/suggestions.rs` | Rename `claude_mistakes` → `agent_mistakes` in struct, `ALL_FIELDS`, format string, and all tests |
| `app/src/lib/tauri-command-types.ts` | Rename field in `FieldSuggestions` interface |
| `app/src/components/skill-dialog.tsx` | Update accessor from `obj.claude_mistakes` |
| `app/src-tauri/src/commands/workflow/prompt.rs` | Rename intake key and two section headings |
| `app/src-tauri/src/commands/workflow/tests.rs` | Update fixture JSON and heading assertions |
| `app/src-tauri/src/types/settings.rs` | Remove `"anthropic"` provider fallback default |
| `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md` | Replace "Claude" with "the agent" in two lines |

---

### Task 1: Rename `claude_mistakes` → `agent_mistakes` in `suggestions.rs`

All test references to `"claude_mistakes"` become `"agent_mistakes"`. The prompt description already says "what the assistant gets wrong" so only the JSON key changes.

**Files:**
- Modify: `app/src-tauri/src/commands/skill/suggestions.rs`

- [ ] **Step 1: Update the tests to use `agent_mistakes` (they will fail to compile after this step)**

In `app/src-tauri/src/commands/skill/suggestions.rs`, update the three test functions:

```rust
// renders_suggestions_prompt_without_claude_wording
// Change the field in the requested_fields vec:
&[
    "description".to_string(),
    "agent_mistakes".to_string(),  // was "claude_mistakes"
    "context_questions".to_string(),
],
// Change the assertion:
assert!(prompt.contains("\"agent_mistakes\""));  // was "claude_mistakes"

// suggestions_openhands_config_uses_clean_break_runner_contract
// Change the requested_fields:
requested_fields: vec!["description".to_string(), "agent_mistakes".to_string()],
// Change the schema required assertion:
.contains(&serde_json::json!("agent_mistakes")));  // was "claude_mistakes"

// parses_completed_suggestions_from_structured_output
// Change the structured_output fixture:
"agent_mistakes": "• Misses company-specific health score cutoffs",  // was "claude_mistakes"
// Change the requested_fields:
"agent_mistakes".to_string(),  // was "claude_mistakes"
// Change the result assertion:
assert_eq!(
    result.agent_mistakes,  // was result.claude_mistakes
    "• Misses company-specific health score cutoffs"
);

// parses_completed_suggestions_from_result_text
// Change result_text:
"result_text": r#"{"description":"Forecasts churn risk.","agent_mistakes":"• Misses company standards"}"#
// Change requested_fields:
"agent_mistakes".to_string(),
// Change assertion:
assert_eq!(result.agent_mistakes, "• Misses company standards");  // was result.claude_mistakes
```

- [ ] **Step 2: Run the tests to confirm compile failure**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml suggestions:: 2>&1 | head -30
```

Expected: compile error mentioning `claude_mistakes` not found.

- [ ] **Step 3: Rename the struct field and all production usages**

In `app/src-tauri/src/commands/skill/suggestions.rs`:

```rust
// ALL_FIELDS array — change line 23:
const ALL_FIELDS: [&str; 8] = [
    "description",
    "domain",
    "scope",
    "audience",
    "challenges",
    "unique_setup",
    "agent_mistakes",     // was "claude_mistakes"
    "context_questions",
];

// FieldSuggestions struct — change line 35:
pub struct FieldSuggestions {
    pub description: String,
    pub domain: String,
    pub audience: String,
    pub challenges: String,
    pub scope: String,
    pub unique_setup: String,
    pub agent_mistakes: String,      // was claude_mistakes
    pub context_questions: String,
}

// field_format_hint match arm — change lines 275-278:
"agent_mistakes" => Some(format!(           // was "claude_mistakes"
    "\"agent_mistakes\": \"<2-3 short bullet points starting with • on separate lines describing what the assistant gets wrong when working with {} in the {} domain>\"",
    readable_name, purpose
)),

// struct initializer in parse_suggestions_from_conversation_state (line 476):
agent_mistakes: field("agent_mistakes"),    // was claude_mistakes: field("claude_mistakes")
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml suggestions:: 2>&1 | tail -10
```

Expected: all tests in the `suggestions` module pass with no failures.

- [ ] **Step 5: Run clippy to confirm no warnings**

```bash
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings 2>&1 | tail -10
```

Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/skill/suggestions.rs
git commit -m "VU-1145: rename claude_mistakes → agent_mistakes in suggestions pipeline"
```

---

### Task 2: Update TypeScript type and UI accessor

**Files:**
- Modify: `app/src/lib/tauri-command-types.ts` (line 64)
- Modify: `app/src/components/skill-dialog.tsx` (line 58)

- [ ] **Step 1: Update the TypeScript interface**

In `app/src/lib/tauri-command-types.ts`, find the `FieldSuggestions` interface:

```typescript
export interface FieldSuggestions {
  description: string;
  domain: string;
  audience: string;
  challenges: string;
  scope: string;
  unique_setup: string;
  agent_mistakes: string;      // was: claude_mistakes: string;
  context_questions: string;
}
```

- [ ] **Step 2: Update the UI accessor**

In `app/src/components/skill-dialog.tsx`, line 58:

```typescript
if (obj.agent_mistakes) parts.push(obj.agent_mistakes)   // was obj.claude_mistakes
```

- [ ] **Step 3: TypeScript check**

```bash
cd app && npx tsc --noEmit 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 4: Run component tests**

```bash
cd app && npx vitest run src/__tests__/components/skill-dialog.test.tsx src/__tests__/components/new-skill-dialog.test.tsx src/__tests__/components/edit-tags-dialog.test.tsx 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/tauri-command-types.ts app/src/components/skill-dialog.tsx
git commit -m "VU-1145: rename agent_mistakes in TypeScript type and skill-dialog accessor"
```

---

### Task 3: Rename intake headings in `prompt.rs` and fix workflow test assertions

The `prompt.rs` changes rename both the section heading for the new `context` field and the legacy `claude_mistakes` key in the fallback map. The workflow tests assert on these heading strings.

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs` (lines 447, 456, 461)
- Modify: `app/src-tauri/src/commands/workflow/tests.rs` (lines 2614, 2646, 2963)

- [ ] **Step 1: Update the test assertions first**

In `app/src-tauri/src/commands/workflow/tests.rs`:

```rust
// test_format_user_context_all_fields — line 2614:
// Change the intake fixture key:
let intake = r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines","unique_setup":"Multi-cloud","agent_mistakes":"Assumes AWS"}"#;
// and line 2646:
assert!(ctx.contains("### What the Agent Gets Wrong"));   // was "### What Claude Gets Wrong"

// test for "### What Claude Needs to Know" — line 2963:
assert!(
    text.contains("### What the Agent Needs to Know"),   // was "### What Claude Needs to Know"
    "should include intake context heading"
);
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml test_format_user_context_all_fields 2>&1 | tail -10
```

Expected: test fails with assertion about heading string.

- [ ] **Step 3: Update `prompt.rs` headings and key**

In `app/src-tauri/src/commands/workflow/prompt.rs`:

```rust
// Line 447 — update comment:
// --- Intake: What the agent needs to know ---

// Line 456 — rename heading:
sections.push(format!("### What the Agent Needs to Know\n{}", v));

// Line 461 — rename key and label in legacy fallback list:
("agent_mistakes", "What the Agent Gets Wrong"),   // was ("claude_mistakes", "What Claude Gets Wrong")
```

- [ ] **Step 4: Run the workflow tests to confirm they pass**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml test_format_user_context 2>&1 | tail -15
```

Expected: all `test_format_user_context_*` tests pass.

- [ ] **Step 5: Run clippy**

```bash
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings 2>&1 | tail -10
```

Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/workflow/prompt.rs app/src-tauri/src/commands/workflow/tests.rs
git commit -m "VU-1145: rename claude_mistakes intake key and section headings in prompt renderer"
```

---

### Task 4: Remove `"anthropic"` provider fallback from `types/settings.rs`

**Files:**
- Modify: `app/src-tauri/src/types/settings.rs` (line 236)

- [ ] **Step 1: Find the relevant test**

The existing test `selected_workflow_llm_accepts_canonical_model_settings` in `app/src-tauri/src/db/settings.rs` passes a provider explicitly — it does not exercise the `None` fallback path. No existing test asserts the fallback value is `"anthropic"`, so we change the code directly.

Check that no test asserts the fallback:

```bash
grep -rn "unwrap_or.*anthropic\|fallback.*anthropic\|anthropic.*fallback" app/src-tauri/src/types/settings.rs app/src-tauri/src/db/settings.rs
```

Expected: one match on the `unwrap_or("anthropic")` line only; no test assertions.

- [ ] **Step 2: Change the fallback to empty string**

In `app/src-tauri/src/types/settings.rs`, line 236:

```rust
// Before:
let provider = model_settings
    .provider
    .as_deref()
    .unwrap_or("anthropic")
    .to_ascii_lowercase();

// After:
let provider = model_settings
    .provider
    .as_deref()
    .unwrap_or("")
    .to_ascii_lowercase();
```

The downstream check `provider == "ollama"` evaluates to false for an empty string, which is the same behaviour as for `"anthropic"` — neither is a local model. The API key guard on line 263 still fires for unconfigured providers.

- [ ] **Step 3: Run the settings type tests**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml types:: 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Run clippy**

```bash
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings 2>&1 | tail -10
```

Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/types/settings.rs
git commit -m "VU-1145: replace unwrap_or(\"anthropic\") provider fallback with empty string"
```

---

### Task 5: Update workspace skill copy in `researching-skill-requirements/SKILL.md`

**Files:**
- Modify: `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md` (lines 23 and 86)

- [ ] **Step 1: Update the two occurrences**

In `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md`:

```markdown
# Line 23 — in "Make sure the clarification record can answer:" list:
- What should this skill enable the agent to do?    # was "Claude"

# Line 86 — in "Good candidate questions clarify one of these:" list:
- Capability: what the skill should enable the agent to do.    # was "Claude"
```

- [ ] **Step 2: Run agent structural tests**

```bash
cd app && npm run test:agents:structural 2>&1 | tail -10
```

Expected: all structural tests pass.

- [ ] **Step 3: Confirm no remaining Claude/Anthropic references in agent-sources workspace**

```bash
rg -n "Claude|claude|Anthropic|anthropic" agent-sources/workspace/ 2>/dev/null
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add agent-sources/workspace/skills/researching-skill-requirements/SKILL.md
git commit -m "VU-1145: replace Claude with 'the agent' in researching-skill-requirements SKILL.md"
```

---

### Task 6: Full validation sweep and push

- [ ] **Step 1: Run the plan validation gates**

```bash
cd app && npm run codegen && npx tsc --noEmit
```

Expected: no output from tsc.

```bash
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings 2>&1 | tail -5
```

Expected: no warnings.

```bash
cd app && npm run test:unit && npm run test:guard && npm run test:integration 2>&1 | tail -10
```

Expected: all three test suites pass with 0 failures. (Pre-existing failures in `workflow-step-complete.test.tsx`, `workflow-step-complete-collapsible.test.tsx`, and `tauri-command-policy.test.ts` are not caused by this branch — confirm they are still the same failures as before this plan.)

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: all Rust tests pass.

- [ ] **Step 2: Final Claude/Anthropic grep sweep**

```bash
rg -n "claude_mistakes|Claude Gets Wrong|Claude Needs to Know|What Claude" \
  app/src app/src-tauri/src app/sidecar agent-sources \
  -g "*.ts" -g "*.tsx" -g "*.rs" -g "*.md" 2>/dev/null
```

Expected: no matches.

```bash
rg -n 'unwrap_or\("anthropic"\)' app/src-tauri/src -g "*.rs" 2>/dev/null
```

Expected: no matches.

- [ ] **Step 3: Push**

```bash
git push
```
