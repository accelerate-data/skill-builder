---
functional-specs: []
---

# Eval Workbench And Promptfoo Sidecar

> **Status:** Draft
> **Functional specs:** Not applicable; this design covers shared app runtime architecture for skill evaluation and description trigger tuning.

## Overview

Skill Builder needs one evaluation model for two related workflows:

- **Performance evaluation:** given a prompt set, does the invoked skill produce acceptable output?
- **Trigger evaluation:** given a prompt set, does OpenHands choose the target skill based on its description?

The app should use a dedicated Promptfoo sidecar as the shared eval engine for both workflows. The sidecar is not the Claude sidecar and does not run agents directly. It owns Promptfoo evaluation orchestration, while Rust owns OpenHands execution, workspace setup, persistence, cancellation, and UI events.

## Design Scope

**Covers**

- A shared Eval Workbench mental model: prompt set + mode + run + results.
- A dedicated Promptfoo sidecar bundled with the app binary.
- Performance and trigger eval modes on the same result substrate.
- Description optimization as trigger evaluation plus candidate comparison.
- Improvement workflow from eval results into Refine.
- Removal of generated `evals/evals.json` from skill generation.

**Does not cover**

- The repo-local `tests/evals` Promptfoo harness.
- Promptfoo red-team scans.
- Fully autonomous eval-edit-rerun loops.
- Remote Promptfoo hosting or shared team dashboards.
- Replacing OpenHands as the skill execution runtime.

## Key Decisions

| Decision | Rationale |
|---|---|
| Treat Eval and Description Optimization as two modes of one workbench. | Both start with a prompt set and produce pass/fail evidence. The difference is what is measured: skill output quality or description-trigger behavior. |
| Add a Promptfoo sidecar that is separate from the Claude sidecar. | Promptfoo is a Node package. A small app-owned sidecar lets the binary use Promptfoo without keeping the Claude Agent SDK runtime. |
| Keep Rust as the OpenHands execution owner. | The Tauri backend already owns app settings, workspace paths, OpenHands Agent Server lifecycle, cancellation, logging, and SQLite persistence. |
| Use Promptfoo for orchestration and assertions, not for agent execution. | Promptfoo should schedule cases, run assertions, and summarize results. Providers call back into app-owned OpenHands execution surfaces. |
| Stop writing eval artifacts during skill generation. | Skill generation should create the skill. Eval creation, editing, execution, and versioning belong to the Eval Workbench. |
| Send eval failures to Refine for edits. | Eval measures and diagnoses. Refine remains the skill-editing surface. This avoids turning Eval into a second editor. |
| Defer fully autonomous improvement loops. | Auto-looping needs patch history, rollback, user approval, regression gates, and clear stop rules. Start with diagnose-and-send-to-Refine. |

## Mental Model

The user always works with a prompt set and an eval mode.

```text
prompt set
  + mode: performance | trigger
  + target: current skill | candidate description
  -> Promptfoo sidecar run
  -> app result history
  -> optional improvement brief
  -> Refine applies changes
  -> rerun same prompt set
```

### Performance Mode

Performance mode answers: **When the skill is invoked, does it do the job?**

Inputs:

- prompt set;
- expected output or assertions per prompt;
- current skill files;
- app model/runtime settings.

Provider behavior:

- run the real skill through Rust/OpenHands;
- collect output, tool events, errors, and usage;
- return a structured provider response to Promptfoo.

Assertions:

- deterministic checks where possible;
- JavaScript assertions for structured results;
- optional model-graded checks when deterministic checks cannot express quality.

### Trigger Mode

Trigger mode answers: **Does this description cause the skill to be selected for the right prompts?**

Inputs:

- trigger and non-trigger prompts;
- target skill name;
- baseline or candidate description;
- app model/runtime settings.

Provider behavior:

- create an isolated OpenHands workspace;
- expose a minimal stub skill with only the candidate `name` and `description`;
- send the user prompt to OpenHands;
- stop after detecting whether the target skill was invoked;
- return `{ invokedTargetSkill, invokedSkillName, events }`.

The stub keeps the test focused on routing. It must not include the real skill body, references, examples, or implementation instructions.

Assertions:

| Case | Expected result |
|---|---|
| `should_trigger = true` and target skill invoked | Pass |
| `should_trigger = true` and target skill not invoked | Fail |
| `should_trigger = false` and target skill not invoked | Pass |
| `should_trigger = false` and target skill invoked | Fail |

## Description Optimization

Description Optimization is a trigger-mode workflow with candidate generation.

Flow:

1. User generates or edits trigger and non-trigger prompts.
2. The prompt set is frozen for the comparison run.
3. The app launches three independent OpenHands subagents.
4. Each subagent receives the real skill context, current description, prompt set, and description-writing guidance.
5. Each subagent returns one candidate description plus short rationale.
6. The Promptfoo sidecar evaluates baseline plus the three candidates in trigger mode.
7. The app ranks candidates and marks the best option.
8. The user reviews all candidates and applies the one they choose.

Candidate generation may use the real skill because the model needs to understand behavior and trigger boundaries. Trigger evaluation must use stub skills so only the description varies.

Ranking order:

1. highest total pass count;
2. highest trigger recall;
3. lowest false-trigger rate;
4. shorter description when scores are otherwise tied;
5. baseline wins if no candidate improves it.

## Improvement Workflow

The first implementation should not let Eval directly mutate skill files.

After any eval run, the user can ask for an improvement brief. The app sends the LLM:

- eval mode;
- prompt set;
- failed cases;
- representative passing cases;
- current skill files for performance mode;
- current description and candidate results for trigger mode.

The LLM returns:

- grouped failure patterns;
- likely causes;
- recommended changes;
- expected impact;
- regression risks.

The user can send the brief to Refine. Refine opens with the brief prefilled and applies edits through the existing OpenHands multi-turn skill-editing flow. The user then reruns the same prompt set to compare results.

An automated loop may be added later:

```text
eval -> diagnose -> refine patch -> rerun -> stop after N attempts or no improvement
```

That loop should still use Refine internally as the editing engine.

## Promptfoo Sidecar

The app bundles a small Node sidecar dedicated to Promptfoo.

Responsibilities:

- import Promptfoo's Node API;
- construct in-memory test suites from Rust job payloads;
- register app-owned provider functions;
- run Promptfoo evaluation with bounded concurrency;
- stream case-level progress;
- return a normalized summary and per-case result payload.

Non-responsibilities:

- no Claude Agent SDK dependency;
- no OpenHands process ownership;
- no workflow or Refine execution;
- no direct SQLite writes;
- no skill file edits.

Suggested location:

```text
app/promptfoo-sidecar/
  package.json
  src/runner.ts
  src/protocol.ts
  src/providers/performance.ts
  src/providers/trigger.ts
  src/result-normalizer.ts
```

Rust starts the sidecar on demand and can stop it after an idle timeout. JSONL over stdin/stdout is sufficient unless streaming progress requires a local HTTP server later.

## Rust Runtime Boundary

Rust remains the authority for app-owned runtime actions.

For each Promptfoo provider call, the sidecar asks Rust to run an app operation:

| Provider | Rust operation |
|---|---|
| `skill-performance` | run current skill with the prompt through OpenHands and return output plus events |
| `skill-trigger` | run OpenHands against a stub skill and return whether the target skill was invoked |

Rust owns:

- OpenHands Agent Server lifecycle;
- workspace and stub-skill creation;
- cancellation;
- transcript logging;
- event normalization;
- usage capture;
- SQLite persistence;
- app-visible progress events.

This keeps the Promptfoo sidecar replaceable. If Promptfoo is removed later, the Rust provider boundary can stay.

## Data Model

The app should store eval data as app concepts, not Promptfoo config files.

```ts
type EvalMode = "performance" | "trigger";

type EvalPromptCase = {
  id: string;
  mode: EvalMode;
  prompt: string;
  expected?: string;
  shouldTrigger?: boolean;
  assertions: EvalAssertion[];
};

type EvalRun = {
  id: string;
  skillName: string;
  pluginSlug: string;
  mode: EvalMode;
  candidateDescription?: string;
  promptCaseIds: string[];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  summary: EvalRunSummary;
};
```

Promptfoo configs are generated in memory from this model for each run. They are not the durable source of truth.

## UI Model

The Eval screen and Description Optimization screen share the same core widgets:

- prompt set editor;
- mode selector;
- run button;
- result table;
- per-case details;
- history comparison;
- failure-pattern summary;
- send-to-Refine action.

Screen-specific behavior:

| Screen | Mode | Extra behavior |
|---|---|---|
| Eval | Performance | Manage output expectations and assertions |
| Description Optimization | Trigger | Generate three descriptions, rank candidates, apply selected description |

The user should be able to move prompt cases between screens when the mode makes sense. For example, a performance prompt can be copied into trigger mode with `shouldTrigger = true`.

## Skill Generation Change

Skill generation should stop creating `evals/evals.json`.

The generation prompt and `creating-skills` guidance should remove requirements to write base eval definitions. If the generator has useful eval ideas, it may return them as non-persistent suggestions in the generation result. The Eval Workbench owns converting those ideas into durable prompt cases.

Required downstream cleanup:

- remove `evals/evals.json` from step 3 output expectations;
- update tests that require `write-evals` in `call_trace`;
- update cleanup code only if it currently assumes step 3 always creates eval artifacts;
- update docs that describe generation-owned eval files.

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [`creating-skills-generator-verifier/`](../creating-skills-generator-verifier/README.md) | Superseded for eval artifact creation. Skill generation should no longer write `evals/evals.json`. |
| [`write-eval-test-refine-loop/`](../write-eval-test-refine-loop/README.md) | Replaces the older skill-creator eval loop with an app-owned Eval Workbench and Refine handoff. |
| [`openhands-agent-server-runtime/`](../openhands-agent-server-runtime/README.md) | Dependency. Rust-owned OpenHands execution powers both Promptfoo provider modes. |
| [`refine-openhands-migration/`](../refine-openhands-migration/README.md) | Dependency. Refine remains the editing surface for applying improvement briefs. |
| [`openhands-event-display-projection/`](../openhands-event-display-projection/README.md) | Dependency. Eval result details may reuse normalized OpenHands event summaries. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/commands/evals.rs` | Current app Eval screen command surface to replace or adapt to the workbench model. |
| `app/src-tauri/src/commands/description/` | Current description optimization implementation; trigger eval should move off Claude sidecar routing. |
| `app/src-tauri/src/agents/openhands_server/` | Rust-managed OpenHands Agent Server runtime used by Promptfoo providers. |
| `app/src-tauri/src/commands/refine/` | Refine command surface for applying improvement briefs. |
| `app/src/components/workspace/workspace-evals.tsx` | Current Eval screen UI entrypoint. |
| `app/src/components/workspace/workspace-description.tsx` | Current Description Optimization UI entrypoint. |
| `agent-sources/prompts/skill-generation.txt` | Generation prompt that should stop requiring persistent eval files. |
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Skill-writing guidance that should stop requiring base eval artifact creation. |

## Open Questions

1. `[design]` Should Promptfoo sidecar jobs call Rust over stdin/stdout request-response messages, or should Rust expose a short-lived loopback HTTP bridge for provider calls?
2. `[design]` Should eval prompt cases live only in SQLite, or also export/import as Promptfoo-compatible files for power users?
3. `[design]` Should Description Optimization show all three candidate rationales, or only score details and raw candidate text?
4. `[design]` What is the first supported assertion set for performance mode: deterministic only, or deterministic plus model-graded rubrics?
