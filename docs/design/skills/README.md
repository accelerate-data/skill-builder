# Bundled Skills

Two bundled skills are seeded into the workspace on startup by `seed_bundled_skills`. The orchestrating skill (`skill-creator`) follows the standard pattern: receive inputs inline, spawn parallel sub-agents in one turn, return delimited sections. The calling orchestrator extracts each section and writes the files to disk.

Output file formats: [`../agent-specs/canonical-format.md`](../agent-specs/canonical-format.md).

---

## Purpose Slots

Each bundled skill has a **purpose** — a slot identifier that controls which skill the app uses for a given role. The app resolves by purpose, not by name. Users can replace any bundled skill by importing a custom skill into Settings→Skills and assigning it the matching purpose. Only one active `workspace_skills` row per purpose is allowed at a time; the app falls back to the bundled skill if no active custom skill holds the slot.

| Skill | Purpose |
|---|---|
| `research` (plugin-owned) | `research` |
| `skill-creator` | `skill-building` |
| `skill-test` | `test-context` |

**Settings→Skills import**: the marketplace listing shows all skills with a `SKILL.md` regardless of `purpose` — `purpose` is not filtered here. After selecting a skill to import, the user is prompted to optionally assign a purpose.

---

## Research Skill

The research workflow is owned entirely by the `skill-content-researcher` **plugin** (wrapper + internal agent + Python tooling). There is no bundled workspace research skill — research is plugin-owned.

`research-orchestrator` runs at step 0 as a **thin wrapper** that delegates to the plugin. It is invoked by:

- **Tauri app** — `workflow.rs` step 0 via the sidecar
- **Plugin workflow** — coordinator spawns it via `Task(subagent_type: "skill-builder:research-orchestrator")`

### Structure

```text
agent-sources/plugins/skill-content-researcher/
  skills/
    research/                   ← embedded research skill (internal-only, not user-invocable)
      SKILL.md
      references/
        dimension-sets.md       ← type-scoped dimension tables (5–6 per type)
        scoring-rubric.md       ← scoring criteria (1–5) and selection rules
        schemas.md              ← canonical JSON schema for research_output
        consolidation-handoff.md
        dimensions/
          entities.md
          metrics.md
          data-quality.md
          … (18 dimension specs)
    skill-content-researcher/   ← user-invocable wrapper skill
      SKILL.md                  ← uses AskUserQuestion to collect inputs
```

### How It Works

At a high level:

1. The user invokes the `skill-content-researcher` wrapper skill. It collects `purpose`, `description`, `industry`, and `function_role` **interactively** via `AskUserQuestion`, with Skip/Other options for each.
2. The wrapper constructs a markdown **User Context** block from the answers and passes it, along with `purpose` and an internal `skill_name` placeholder, to the plugin’s `research-orchestrator`.
3. `research-orchestrator` calls the `skill-content-researcher:research` skill, which runs the research flow using the reference material in `skills/research/references/` and derives `question_count` and `dimensions_selected` inline from its output.
4. The research skill returns a **normalized envelope**:

   ```json
   {
     "research_output": { "...canonical clarifications object..." },
     "dimensions_selected": 4,
     "question_count": 26
   }
   ```

5. `research-orchestrator` returns the app-facing envelope:

   ```json
   {
     "status": "research_complete",
     "dimensions_selected": 4,
     "question_count": 26,
     "research_output": { "...canonical clarifications object..." }
   }
   ```

The canonical shape of `research_output` (including `metadata.research_plan`) lives in `schemas.md` and is enforced by the Python normalizer, not by prompt text.

### Customization

Teams customise research by editing the **reference inputs** and schema, not the envelope:

- Dimension catalog, per‑type template mappings, focus line tailoring, and design guidelines: [`dimensions.md`](dimensions.md).
- Scoring and selection behavior: `dimension-sets.md`, `scoring-rubric.md`, and the plugin’s internal research SKILL and agent.

The app‑level contract is the JSON envelope (`status`, `dimensions_selected`, `question_count`, `research_output`) and the `research_output` schema defined in `schemas.md`.

---

## Skill-Test Skill

`skill-test` provides the test context and evaluation rubric for skill test runs. Deployed as a `.claude/skills/` directory in both temp workspaces.

Used by:

- **Tauri app** — `prepare_skill_test()` copies the skill directory from bundled resources into `.claude/skills/skill-test/` in both temp workspaces before each test run

Purpose slot: `test-context`. Replace by importing a custom skill into Settings→Skills and assigning purpose `test-context`.

### Structure

```text
agent-sources/skills/skill-test/
  SKILL.md                             ← two sections: Test Context + Evaluation Rubric
  references/
    agentskills-spec.md                ← Agent SDK tool-use spec for the test environment
```

### Sections

**Test Context** — loaded by both plan agents. Orients the agent as an analytics engineer working in a dbt lakehouse in plan mode. Defines five focus areas the agent should orient toward: silver vs gold layer, dbt project structure, dbt tests, dbt contracts, and semantic model.

**Evaluation Rubric** — loaded by the evaluator agent. Defines six scoring dimensions (silver vs gold, dbt project structure, dbt tests, unit test cases, dbt contracts, semantic model), scoring rules (comparative A vs B only, skip irrelevant dimensions, no surface observations), and output format (↑/↓ prefixed bullet points only).

Both plan agents load the full skill from their workspace but are only instructed to respond to the user prompt. The evaluator is explicitly asked to use the rubric via its prompt.
