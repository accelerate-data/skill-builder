# Plugin v2: Plugin-Specific Changes

Plugin coordinator rewrite — replacing the rigid 7-step sequential script with
a state-aware router that dynamically selects agents based on conversation
context and filesystem state.

---

## 1. Skill Rename

| Current | New |
|---------|-----|
| Skill directory | `skills/building-skills/` |
| Skill name (frontmatter) | `building-skills` |
| Plugin trigger | `/skill-builder:building-skills` |
| Description | "Build domain-specific Claude skills for dbt silver and gold layer modeling. Use when the user asks to create, build, or generate a new skill for data/analytics engineers. Handles domain, platform, source, and data-engineering skill types. Also use when the user says 'new skill', 'skill builder', 'I need a skill for [domain]', or 'help me build a skill'." |

Agent filenames (`agents/*.md`) stay as-is — agents are not skills and don't
need gerund naming.

### Plugin manifest

```json
{
  "name": "skill-builder",
  "version": "0.2.0",
  "description": "Multi-agent workflow for creating domain-specific Claude skills. Targets data/analytics engineers who need functional context for silver and gold table modeling.",
  "skills": "./skills/"
}
```

---

## 2. State-Aware Router

The router replaces the current step-counter coordinator. It reads filesystem
state, classifies user intent, and dispatches agents via the `Task` tool.

### State x Intent dispatch matrix

| Filesystem State              | User Intent           | Action                              |
|-------------------------------|-----------------------|-------------------------------------|
| Empty                         | "Build me a skill"    | Scoping phase                       |
| Empty                         | Specific domain named | Scoping with pre-filled domain      |
| clarifications.md exists      | "I answered them"     | Check answers → decisions or refine |
| clarifications.md, unanswered | Continues session     | Show clarification status, prompt   |
| decisions.md exists           | Continues             | Generate skill                      |
| SKILL.md exists               | "Validate"            | Run validation only                 |
| SKILL.md exists               | "Improve X section"   | Targeted regeneration               |
| Any                           | Process question       | Answer about the process            |
| Any                           | "Skip ahead"          | Jump forward, auto-fill defaults    |
| Any                           | "Start fresh"         | Delete artifacts, begin scoping     |

### Phase backbone

Phases exist conceptually but the router navigates them adaptively:

```
Scoping → Research → Clarification → [Refinement] → Decisions → Generation → Validation
   │          │           │                │             │            │           │
   │          │           │                │             │            │           └─ Loop to Generation
   │          │           │                │             │            └─ Targeted regen possible
   │          │           │                │             └─ Auto-proceed if answers are unambiguous
   │          │           │                └─ OPTIONAL (skip if answers are detailed)
   │          │           └─ ASYNC (user can leave for days)
   │          └─ Skippable (user provides spec → jump to Decisions)
   └─ Can pre-fill from user's first message
```

### Agent dispatch

The router dispatches agents via direct `Task` tool calls. No team lifecycle
management needed:

| Current | Router Replacement |
|---------|-------------------|
| `TeamCreate` / `TeamDelete` | Not needed |
| `TaskCreate` | State tracked via `session.json` + filesystem artifacts |
| `SendMessage` | Spawn a new `Task` with feedback context |

---

## 3. Directory Structure

### Two directories, clearly separated

| Concept | Purpose | Contents |
|---------|---------|----------|
| **Plugin workspace** (`.vibedata/`) | Plugin internals — state, logs, config | Session manifests, logs, plugin config. Local only, never committed. |
| **Skill context** (`<skill-dir>/context/`) | User-facing working files | `clarifications.md`, `decisions.md`, `agent-validation-log.md`, `test-skill.md` |
| **Skill output** (`<skill-dir>/`) | Deployable skill | `SKILL.md` + `references/` |

### Layout

```
.vibedata/                                  # Plugin workspace (local only)
├── plugin/                                 # Cross-skill plugin data
│   ├── config.json                         # Plugin settings, preferences
│   └── dimension-cache.json                # Cached planner selections (optional)
│
├── sales-pipeline/                         # Per-skill internal state
│   ├── session.json                        # Session state (phase, progress, skill-dir path)
│   └── logs/                               # Agent execution logs (optional)
│
└── revenue-recognition/                    # Another skill's internal state
    ├── session.json
    └── ...

~/skill-builder/sales-pipeline/             # Skill dir (default: ~/skill-builder/<skill-name>/)
├── SKILL.md                                # Deployable skill
├── references/                             # Deployable reference files
│   ├── entity-model.md
│   └── metrics.md
└── context/                                # User-facing working files
    ├── clarifications.md
    ├── decisions.md
    ├── agent-validation-log.md
    └── test-skill.md
```

### Key principles

1. **Plugin workspace is internal** — `.vibedata/` is local only. Users never
   look inside it.
2. **Context is user-facing** — `<skill-dir>/context/` contains files the user
   reads and edits.
3. **Skill output is the deliverable** — `SKILL.md` + `references/` at the
   skill dir root. Clean enough to deploy directly.
4. **Skill dir location is configurable** — `session.json` tracks `skill_dir`.
   Default `~/skill-builder/<skill-name>/`, movable anywhere.
5. **Moving the skill dir is first-class** — "Move my skill to
   `./skills/sales-pipeline/`" updates `session.json.skill_dir`, moves files.
6. **Cross-skill data persists** — `.vibedata/plugin/` survives across skills.

### Path resolution

**Coordinator-internal** (not passed to agents):

| Path | Purpose |
|------|---------|
| `.vibedata/<skill-name>/` | Session state, logs |
| `.vibedata/plugin/` | Cross-skill config, dimension cache |

**Agent-facing** (passed to every agent):

| Parameter | Example | Purpose |
|-----------|---------|---------|
| `context_dir` | `~/skill-builder/sales-pipeline/context/` | Working files |
| `skill_dir` | `~/skill-builder/sales-pipeline/` | Deployable output |

### Session manifest (`session.json`)

```json
{
  "skill_name": "sales-pipeline",
  "skill_type": "domain",
  "domain": "sales pipeline analytics",
  "skill_dir": "~/skill-builder/sales-pipeline/",
  "created_at": "2026-02-15T10:30:00Z",
  "last_activity": "2026-02-18T14:20:00Z",
  "current_phase": "clarification",
  "phases_completed": ["scoping", "research"],
  "mode": "guided",
  "research_dimensions_used": ["entities", "metrics", "business-rules"],
  "clarification_status": {
    "total_questions": 15,
    "answered": 8
  },
  "auto_filled": false
}
```

### Artifact-to-phase mapping

| Artifact | Phase Completed |
|----------|-----------------|
| `session.json` with `phases_completed: ["scoping"]` | Scoping |
| `clarifications.md` (no Refinements) | Research |
| `clarifications.md` (answered, no Refinements) | Clarification |
| `clarifications.md` (with `#### Refinements`) | Refinement |
| `clarifications.md` (refinements answered) | Refinement review |
| `decisions.md` | Decisions |
| `SKILL.md` in skill dir | Generation |
| `agent-validation-log.md` + `test-skill.md` | Validation |

---

## 4. State Management

### Offline clarification flow

1. Research completes → coordinator writes `clarifications.md` to context dir + updates `session.json`
2. User told: "Questions are in `~/skill-builder/sales-pipeline/context/clarifications.md`. Answer them whenever you're ready."
3. User closes terminal, answers over days
4. User returns, triggers `/skill-builder:building-skills`
5. Router scans `.vibedata/` for skill workspaces, reads `session.json`, locates context dir
6. Counts answered vs unanswered questions in `clarifications.md`
7. Presents status: "Welcome back. 8 of 15 questions answered. 7 remaining."
8. User can: answer more, proceed with defaults for unanswered, or ask for help

### Auto-fill rule

Empty `**Answer:**` fields use the `**Recommendation:**` as the answer:

> "You have 7 unanswered questions. I can proceed using recommended defaults,
> or you can answer them first. Which do you prefer?"

---

## 5. Workflow Modes

### Guided mode (default)

Full workflow with all phases.

```
Scoping → Research → Clarification → Refinement → Decisions → Generation → Validation
```

### Express mode

Skips research and/or clarification. Triggered by:
- User provides a detailed spec or existing documentation
- User says "proceed with defaults" at any clarification gate
- User says "skip research" or "I know what I want"

```
Scoping → Decisions (from user spec) → Generation → Validation
```

### Iterative mode

User has an existing skill and wants to improve it. Triggered by:
- SKILL.md exists in the target directory
- User says "improve", "modify", "update", or "fix"

```
[Read existing skill] → Targeted Decisions → Targeted Generation → Validation
```

### Mode detection

The router infers the mode from the user's first message + filesystem state.

### Explicit mode override

Users can force a mode by naming it directly ("build in express mode", "guided
mode for this one"). Explicit override always wins over inference.

---

## 6. Progressive Scoping (Plugin)

The router asks 2-3 scoping questions conversationally before spawning the
research planner:

```
Router: "Before I generate the full question set, let me ask the most
important ones. How do you define pipeline coverage?
  a) Open pipeline / Annual quota
  b) Open pipeline / Quarterly target
  c) Weighted pipeline / Adjusted target"

[user answers 3-4 questions]

Router: "Great. I've generated 12 more detailed questions in
~/skill-builder/sales-pipeline/context/clarifications.md. Answer
them whenever you're ready -- I'll proceed with recommended
defaults if you want to skip ahead."
```

---

## 7. Targeted Regeneration (Plugin)

Instead of regenerating the entire skill, the router accepts natural language
requests for partial updates:

```
User: "The metrics section is missing win rate calculation"
Router: Spawns generate-skill with targeted prompt for just that section
        Uses Edit tool to update in-place rather than full rewrite
```

The router detects targeted edit intent (vs full regeneration) when SKILL.md
already exists. The generate-skill agent reads existing files, uses Edit for
surgical changes scoped to the relevant section/file.

---

## 8. Dimension Caching

If a user builds multiple skills in the same domain family, cache the planner's
dimension selections in `.vibedata/plugin/dimension-cache.json`:

```json
{
  "domain": {
    "common": ["entities", "metrics", "business-rules", "segmentation-and-periods"],
    "occasional": ["modeling-patterns", "layer-design"],
    "rare": ["extraction", "config-patterns"]
  }
}
```

---

## 9. Plugin Packaging

The build script packages convention skills into the plugin's reference
structure. The plugin coordinator deploys the relevant convention skills to
`.vibedata/skills/` based on tool ecosystem selection during init.

`scripts/build-plugin-skill.sh` update: add `.session.json` format to
file-formats section, add convention skills to build output.

---

## Related Linear Issues

| Issue | Title | Size |
|-------|-------|------|
| [VD-672](https://linear.app/acceleratedata/issue/VD-672) | Rename skill from `generate-skill` to `building-skills` | S |
| [VD-673](https://linear.app/acceleratedata/issue/VD-673) | Simplify coordinator to direct Task dispatch | M |
| [VD-675](https://linear.app/acceleratedata/issue/VD-675) | Update plugin manifest and documentation for v2 | S |
| [VD-676](https://linear.app/acceleratedata/issue/VD-676) | Formalize workspace/skill dir structure and session tracking | M |
| [VD-677](https://linear.app/acceleratedata/issue/VD-677) | Replace step counter with state x intent router | L |
| [VD-678](https://linear.app/acceleratedata/issue/VD-678) | Add workflow modes: guided, express, iterative | M |
| [VD-679](https://linear.app/acceleratedata/issue/VD-679) | Add auto-fill express flow for clarifications | S |
| [VD-684](https://linear.app/acceleratedata/issue/VD-684) | Add progressive scoping questions before research | S |
| [VD-689](https://linear.app/acceleratedata/issue/VD-689) | Add interactive + offline hybrid clarification flow | M |
| [VD-698](https://linear.app/acceleratedata/issue/VD-698) | Add targeted section regeneration to plugin workflow | M |

**Note:** VD-688 (original targeted regen) is superseded by VD-698 (plugin)
+ VD-699 (app) which are more specific.

### Dependency order

```
VD-672 (rename) ──┬──→ VD-675 (manifest/docs)
                   │
VD-673 (simplify) ┘
                   │
                   └──→ VD-676 (session.json)
                              │
                              └──→ VD-677 (ROUTER) ←── critical path
                                        │
                              ┌─────────┼─────────┐
                              │         │         │
                              ▼         ▼         ▼
                         VD-678    VD-679    VD-684
                         (modes)   (auto-   (scoping)
                                   fill)
                                              │
                              VD-689          VD-698
                              (hybrid         (targeted
                              clarify)        regen)
```
