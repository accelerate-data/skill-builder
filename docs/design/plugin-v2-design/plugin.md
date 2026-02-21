# Plugin Design

## Plugin Packages

Four installable plugins:

| Plugin | Contents | Customizable |
|---|---|---|
| `skill-builder` | Coordinator skill + 7 agents + workspace-context.md | No |
| `skill-builder-research` | Research skill (dimension scoring, parallel research, consolidation) | Yes — fork to customize dimensions |
| `skill-builder-validate` | Validate skill (quality check, test evaluation, companion recommendations) | Yes — fork to customize quality rules |
| `skill-builder-practices` | Content guidelines (skill structure, patterns, anti-patterns) | Yes — fork to customize for non-dbt stacks |

---

## Package Contents

### skill-builder

```
.claude-plugin/
  plugin.json
skills/
  generate-skill/
    SKILL.md              ← coordinator (state router + workflow)
agents/
  research-orchestrator.md
  answer-evaluator.md
  detailed-research.md
  confirm-decisions.md
  generate-skill.md
  validate-skill.md
  refine-skill.md
references/
  workspace-context.md   ← injected inline into every agent Task call
```

### skill-builder-research

```
.claude-plugin/
  plugin.json
skills/
  research/
    SKILL.md
    references/
      dimension-sets.md
      scoring-rubric.md
      consolidation-handoff.md
      dimensions/
        *.md              ← 18 dimension spec files
```

### skill-builder-validate

```
.claude-plugin/
  plugin.json
skills/
  validate-skill/
    SKILL.md
    references/
      validate-quality-spec.md
      test-skill-spec.md
      companion-recommender-spec.md
```

### skill-builder-practices

```
.claude-plugin/
  plugin.json
skills/
  skill-builder-practices/
    SKILL.md
    references/
      ba-patterns.md
      de-patterns.md
```

---

## Marketplace Distribution

Hosted as a GitHub repo with a `.claude-plugin/marketplace.json` at root.

```
acceleratedata-plugins/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    ├── skill-builder/
    ├── skill-builder-research/
    ├── skill-builder-validate/
    └── skill-builder-practices/
```

**marketplace.json:**
```json
{
  "name": "acceleratedata-plugins",
  "owner": { "name": "AccelerateData" },
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [
    { "name": "skill-builder",            "source": "./plugins/skill-builder" },
    { "name": "skill-builder-research",   "source": "./plugins/skill-builder-research" },
    { "name": "skill-builder-validate",   "source": "./plugins/skill-builder-validate" },
    { "name": "skill-builder-practices",  "source": "./plugins/skill-builder-practices" }
  ]
}
```

**User setup:**
```bash
claude plugin marketplace add acceleratedata/acceleratedata-plugins
claude plugin install skill-builder
```

---

## Customization Model

Teams fork any of the three inner plugins, publish to a private GitHub marketplace, and install at project scope:

```bash
# Override research skill for a specific project
claude plugin install skill-builder-research --scope project
```

The coordinator calls inner plugins by fixed names (`skill-builder-research:research`, `skill-builder-validate:validate-skill`, `skill-builder-practices:skill-builder-practices`). Same plugin name = drop-in replacement. No coordinator changes needed.

---

## Source of Truth

All plugin content is built from `agent-sources/workspace/`:

| Source | Plugin |
|---|---|
| `agent-sources/workspace/CLAUDE.md` | `skill-builder/references/workspace-context.md` |
| `agent-sources/workspace/skills/research/` | `skill-builder-research` |
| `agent-sources/workspace/skills/validate-skill/` | `skill-builder-validate` |
| `agent-sources/workspace/skills/skill-builder-practices/` | `skill-builder-practices` |

`scripts/build-plugin-skill.sh` copies all outputs from source.

---

## Workspace Context Delivery

Agents in the plugin context do not get a `.claude/CLAUDE.md` auto-loaded. The coordinator injects `references/workspace-context.md` (= `agent-sources/workspace/CLAUDE.md`) inline into every agent `Task` call via `<agent-instructions>` tags.

Inner plugin skills (`skill-builder-research:research`, etc.) are invoked by plugin agents using their namespaced names. No inline content injection needed for skills — they are self-contained packages with their own reference files.
