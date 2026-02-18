# Plugin v2: App-Specific Changes

Desktop app changes — new UI features that complement the shared agent
improvements. The app has its own orchestration in the sidecar and does not
use the plugin coordinator.

---

## 1. Init Wizard (Progressive Scoping)

The current init step is a single form. Replace with a **two-level wizard**
with progressive disclosure.

### Level 1 — General Details (required)

| Field | Type | Purpose |
|-------|------|---------|
| Skill name | text | Kebab-case identifier |
| Skill type | select | domain / platform / source / data-engineering |
| Domain description | textarea | What the skill covers |

### Level 2 — Power User Details (optional, expandable)

| Field | Type | Purpose |
|-------|------|---------|
| What does Claude get wrong? | textarea | Top 2-3 things Claude produces incorrectly for this domain |
| What makes your setup unique? | textarea | How this differs from standard implementations |
| Tool ecosystem | checkboxes | dbt, dlt, Elementary, Fabric — controls which convention skills are loaded |
| Workflow mode | select | Guided (default) / Express / Iterative |

Level 2 is collapsed by default with a "More options" expander. Users who
skip it get reasonable defaults — the planner scores dimensions with less
context but still works. Users who fill it get better dimension selection
and faster research.

Both levels feed into `build_prompt()` which passes all answers to the
research planner's prompt template.

---

## 2. Companion Skills Menu

The app reads `<skill-dir>/context/companion-skills.md` (produced by the
validate-skill step) and shows a dedicated panel:

- List of recommended companion skills with reasoning
- For each: match status against existing skills in workspace and template
  repo (via haiku)
- Actions per companion:
  - **"Build this skill"** — starts a new workflow pre-filled with the
    companion's suggested scope
  - **"Import template"** — imports from template repo if a match exists
- Status tracking: which companions have been built, which are pending

This is a **helper for the user** — it surfaces what's missing and makes
it easy to act on, but the user decides what to build next.

---

## 3. Section-Level Regeneration UI

After skill generation (Step 6), users should be able to regenerate individual
sections without rewriting the entire skill. The app has no chat interface, so
this needs a dedicated UI mechanism.

### Approach

The `WorkflowStepComplete` component currently renders SKILL.md as a single
markdown blob. Change to:

1. Parse SKILL.md into sections by `##` headers
2. Render each section independently with a "Regenerate" button
3. On click, show an input for improvement instructions ("make this more
   specific", "add edge cases for SCD2")
4. Invoke a focused agent that reads existing content and makes surgical
   edits to only the selected section
5. Show before/after diff of what changed

Works for both SKILL.md sections and individual reference files.

---

## 4. Convention Skills Deployment

`ensure_workspace_prompts()` in `workflow.rs` already copies agents to
`.claude/agents/`. Extend it to deploy convention skills to
`.claude/skills/<tool>-conventions/` based on the user's tool ecosystem
selection from the init wizard. Same copy-on-init pattern, no new mechanism
needed.

---

## 5. Template Matching (App Side)

After the init wizard (Step 0) completes, before starting the research step:

1. Call the template repo API
2. Match using haiku with all scoping inputs (name, type, domain description,
   power-user answers if provided)
3. Show a dialog with matches: "I found 2 starter skills that match your
   domain..."
4. On import: populate the skill folder and advance to clarification step
5. On "from scratch": proceed with full research flow

Uses the existing `github_import.rs` infrastructure.

---

## Related Linear Issues

| Issue | Title | Size |
|-------|-------|------|
| [VD-695](https://linear.app/acceleratedata/issue/VD-695) | Redesign skill init as two-level wizard with progressive scoping | M |
| [VD-697](https://linear.app/acceleratedata/issue/VD-697) | Add first-class companion skill report with UI menu and template matching | M |
| [VD-699](https://linear.app/acceleratedata/issue/VD-699) | Add section-level regeneration UI for generated skills | L |

VD-697 has both a shared component (companion skill generator agent) and an
app component (UI menu). The agent changes are covered in the shared doc; the
UI is here.

### Dependency order

VD-695 (init wizard) is independent — can start immediately.

VD-697 (companion menu) depends on the companion skill generator agent changes
from the shared work (VD-693 dimension scoring).

VD-699 (section regen UI) is independent — can start immediately.
