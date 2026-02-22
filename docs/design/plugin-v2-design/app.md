# Plugin v2: App-Specific Changes

Desktop app changes — new UI features that complement the shared agent
improvements. The app has its own orchestration in the sidecar and does not
use the plugin coordinator.

**Related docs in this folder:**
- [coordinator.md](coordinator.md) — plugin coordinator: state detection, intent classification, phase dispatch
- [plugin.md](plugin.md) — plugin packages, marketplace distribution, customization model

---

## 1. Create Wizard with Ghost Suggestions ⚠️

> Implemented: VD-695 (dcfb0f7). Ghost suggestions code is complete end-to-end
> but **not reliably working at runtime** (likely operational: API key, network,
> or settings issue). Needs debugging.

Replaced the single-form init step with a **3-step linear wizard**. The
original design proposed a 2-level progressive disclosure; the implementation
evolved into 3 steps with AI-generated ghost suggestions.

### Step 1 — Name & Type (required, gates progression)

| Field | Type | Purpose |
|-------|------|---------|
| Skill name | text | Kebab-case identifier with real-time validation |
| Skill type | radio group | domain / platform / source / data-engineering |

### Step 2 — Domain, Scope & Tags

| Field | Type | Purpose |
|-------|------|---------|
| Domain | text (ghost) | What the skill covers |
| Scope | textarea (ghost) | Defines the skill's boundaries |
| Tags | tag input | Categorization with suggestions |

Also displays the output location (`{skillsPath}/{name}/`).

### Step 3 — Optional Detail Fields

| Field | Type | Purpose |
|-------|------|---------|
| Target audience | textarea (ghost) | Who will use this skill |
| Key challenges | textarea (ghost) | Top difficulties in this domain |
| What makes your setup unique? | textarea (ghost) | How this differs from standard implementations |
| What does Claude get wrong? | textarea (ghost) | Top things Claude produces incorrectly |

### Ghost suggestions

After the user enters **both** skill name and skill type (800ms debounce),
haiku generates suggestions for all fields. Suggestions appear as faded
italic placeholder text. **Tab key accepts** the suggestion into the field.

- Rust command: `generate_suggestions(skill_name, skill_type, industry, function_role)`
- Uses `claude-haiku-4-5-20251001` with 15-second timeout
- Returns `FieldSuggestions { domain, audience, challenges, scope, unique_setup, claude_mistakes }`
- User context (industry + function role from settings) personalizes suggestions

### GhostInput component

Renders over both `<Input>` and `<Textarea>`. Shows suggestion only when the
field is empty. Intercepts Tab to accept. Placeholder text goes transparent
when ghost is visible.

### Type-specific placeholders

`INTAKE_PLACEHOLDERS` provides context-aware placeholder text per skill type
(Platform: environment promotion, dependency management; Domain: business
compliance; Source: API limits, schema drift; Data Engineering: temporal
patterns, audit trails).

### Design changes from original spec

| Original Design | Actual Implementation |
|-----------------|----------------------|
| 2-level progressive disclosure | 3-step linear wizard |
| Level 1: Name, Type, Domain | Step 1: Name, Type only |
| Level 2 (collapsed): Pain points, unique setup, tool ecosystem, workflow mode | Step 2: Domain, Scope, Tags. Step 3: Audience, Challenges, Unique Setup, Claude Mistakes |
| No AI suggestions | Ghost suggestions on all detail fields (haiku) |
| Tool ecosystem checkboxes (dbt, dlt, etc.) | Removed — replaced by Tags |
| Workflow mode select (Guided/Express/Iterative) | Removed (app-only concept) |

All captured fields persist as `intake_json` (JSON string) via
`buildIntakeJson()`, passed to `create_skill`.

---

## 2. Refine Page ✅

> Implemented: VD-703 (3f5b0bd), VD-745 (926d6f1)

The original design described "Section-Level Regeneration UI" with per-section
regenerate buttons on the workflow step complete view. The actual
implementation is a **full chat-based refine page** with SDK streaming input
mode — a significantly different and more powerful design.

### Layout

Two-panel resizable split:
- **Left panel**: Skill picker + chat message list + input bar
- **Right panel**: File picker + markdown preview / diff toggle

### Skill picker

Dropdown selector at the top of the chat panel. Shows all refinable skills
(those with a generated SKILL.md). Displays skill type badges. Disabled
during agent runs.

### Chat input bar

Textarea with autocomplete for:
- **`@file` syntax** — target specific files (e.g., `@SKILL.md`, `@references/metrics.md`)
- **`/rewrite`** — full skill rewrite or scoped rewrite of targeted files
- **`/validate`** — re-validate the whole skill

Inline pickers (dropdowns) triggered by `@` and `/` keystrokes with arrow key
navigation. Badges display selected files and active command.

### Message flow

```
User types message → handleSend()
  ↓
Snapshot baseline files for diff
  ↓
Add user message to refine-store (role="user", text, targetFiles, command)
  ↓
Call sendRefineMessage(sessionId, text, targetFiles, command) → Rust
  ↓
Rust checks stream_started flag:
  NO  → build_refine_prompt(full context) → stream_start → SidecarPool
  YES → build_followup_prompt(compact)    → stream_message → SidecarPool
  ↓
Sidecar dispatches to refine-skill agent via SDK streaming input mode
  ↓
Agent streams JSON lines → Tauri emits agent-message events → agent-store
  ↓
Agent completes → frontend re-reads skill files → preview panel updates
  ↓
Diff toggle compares baseline vs current files
```

### Preview panel

- File picker dropdown (SKILL.md + references/*.md + context/*.md)
- Markdown rendering or diff view toggle
- Diff mode: line-by-line comparison (added=green, removed=red)
- Baseline captured before each agent run

### SDK streaming input mode

The key architectural innovation. Instead of spawning a new agent per message,
the `StreamSession` class wraps the SDK's streaming input mode:

1. **First message** (`stream_start`): Full prompt with all context (paths,
   metadata, skill type, command). SDK begins a conversation.
2. **Follow-up messages** (`stream_message`): Push new user text into the
   SDK's async generator. SDK maintains full conversation state (tool_use,
   tool_result, assistant messages) across yields.
3. **Session lifecycle**: One persistent sidecar per skill. Max 400 turns per
   session (~20 user messages × 20 agent turns each).

This eliminates context rebuilding overhead — the SDK keeps conversation state
warm across turns.

### Rust commands (refine.rs)

| Command | Purpose |
|---------|---------|
| `list_refinable_skills` | Skills with a generated SKILL.md |
| `get_skill_content_for_refine` | Load SKILL.md + all references and context files |
| `get_refine_diff` | Git diff for skill directory |
| `start_refine_session` | Initialize session (one per skill enforced) |
| `send_refine_message` | Send message to refine agent (first = stream_start, follow-up = stream_message) |
| `close_refine_session` | Clean up session, send stream_end to sidecar |

### Refine store (refine-store.ts)

Zustand store tracking: `selectedSkill`, `sessionId`, `messages[]` (with
role, text, targetFiles, command, agentMessages), `isAgentRunning`,
`baselineFiles`, `skillFiles`.

---

## 3. Companion Skills Menu

> Status: **Agent done** (VD-697), **UI pending** (VD-697 app component)

The companion-recommender agent (shared, see shared.md Section 7) now
produces `<skill-dir>/context/companion-skills.md` with structured YAML
frontmatter. The app UI to surface this data is not yet built.

### Planned UI

- Read `companion-skills.md` artifact
- List recommended companions with reasoning and priority
- Match status against existing skills in workspace and template repo (via haiku)
- Actions per companion:
  - **"Build this skill"** — starts a new workflow pre-filled with the
    companion's suggested scope
  - **"Import template"** — imports from template repo if a match exists
- Status tracking: which companions have been built, which are pending

---

## 4. Convention Skills Deployment

> Status: **Pending** (depends on VD-694 convention skills from shared work)

`ensure_workspace_prompts()` in `workflow.rs` already copies agents to
`.claude/agents/`. Extend it to deploy convention skills to
`.claude/skills/<tool>-conventions/` based on the user's tag selection from
the create wizard. Same copy-on-init pattern, no new mechanism needed.

---

## 5. Template Matching (App Side)

> Status: **Pending** (VD-696)

After the create wizard completes, before starting the research step:

1. Call the template repo API
2. Match using haiku with all scoping inputs (name, type, domain, intake answers)
3. Show a dialog with matches: "I found 2 starter skills that match your
   domain..."
4. On import: populate the skill folder and advance to clarification step
5. On "from scratch": proceed with full research flow

Uses the existing `github_import.rs` infrastructure.

---

## Related Linear Issues

| Issue | Title | Size | Status |
|-------|-------|------|--------|
| [VD-695](https://linear.app/acceleratedata/issue/VD-695) | Simplify create form & two-level wizard with ghost suggestions | M | ⚠️ Code done, ghost suggestions not working at runtime |
| [VD-703](https://linear.app/acceleratedata/issue/VD-703) | Build Refine page with chat UI, skill picker, and diff panel | L | ✅ Done |
| [VD-745](https://linear.app/acceleratedata/issue/VD-745) | Refactor refine to SDK streaming input mode | M | ✅ Done |
| [VD-700](https://linear.app/acceleratedata/issue/VD-700) | Add refine-skill agent | M | ✅ Done (shared) |
| [VD-701](https://linear.app/acceleratedata/issue/VD-701) | Add sidecar refine support | M | ✅ Done (shared) |
| [VD-697](https://linear.app/acceleratedata/issue/VD-697) | Companion skill report with UI menu and template matching | M | Agent ✅, UI pending |
| [VD-699](https://linear.app/acceleratedata/issue/VD-699) | ~~Section-level regeneration UI~~ | L | Superseded by VD-703 (Refine page) |
| [VD-696](https://linear.app/acceleratedata/issue/VD-696) | Template matching (app side) | L | Pending |
| [VD-694](https://linear.app/acceleratedata/issue/VD-694) | Convention skills deployment (app side) | L | Pending (depends on shared VD-694) |

### Dependency order

VD-695 (create wizard) ✅ and VD-703+VD-745 (refine page) ✅ are complete and
independent.

VD-697 companion menu (UI) depends on the companion-recommender agent ✅ and
the companion-skills.md artifact ✅ — both done. UI work can start.

VD-696 (template matching) is independent.

VD-694 (convention deployment, app side) depends on the shared convention
skills being built first (shared VD-694).
