# Skill Builder -- Claude Code Plugin

Claude Code plugin providing the multi-agent skill-building workflow. Entry point: `/skill-builder:start`.

## Plugin Structure

```
skill-builder/
├── .claude-plugin/
│   ├── plugin.json                  # Plugin manifest
│   └── marketplace.json             # Marketplace registry
├── .claude/
│   └── settings.json                # Dev hooks (runs validate.sh after Edit/Write)
├── scripts/
│   ├── validate.sh                  # Automated structural validation (T1 checks)
│   └── tests/                       # Test harness scripts (T1-T5)
├── skills/
│   └── start/
│       └── SKILL.md                 # Coordinator skill (entry point)
├── agents/                          # Agent prompts (see CLAUDE.md for layout)
└── references/
    └── shared-context.md            # Shared context read by all agents
```

## Architecture

Three layers:

1. **Coordinator skill** (`skills/start/SKILL.md`) -- invoked via `/skill-builder:start`. Contains the 9-step workflow (Steps 0-8). Uses `` !`echo $CLAUDE_PLUGIN_ROOT` `` to resolve paths to plugin files at runtime.

2. **Subagents** (`agents/{type}/*.md` and `agents/shared/*.md`) -- each has YAML frontmatter (name, model, tools, permissions) and markdown instructions. Type-specific agents are spawned via `Task(subagent_type: "skill-builder:{type_prefix}-{agent}")`, shared agents via `Task(subagent_type: "skill-builder:{agent}")`.

3. **Shared reference** (`references/shared-context.md`) -- domain definitions, file formats, content principles. Read by agents at the path the coordinator passes in the Task prompt.

## Development Guide

### Adding/modifying an agent

Agent files in `agents/{type}/` are **generated** — do not edit them directly.

1. Edit the template in `agents/templates/` (shared logic) or the config in `agents/types/{type}/` (type-specific content)
2. Run `./scripts/build-agents.sh` to regenerate all 20 type-specific agent files
3. Use `./scripts/build-agents.sh --check` to verify generated files match templates (used in CI)
4. Shared agents (`agents/shared/`) are edited directly — they are not generated

### Modifying the workflow

Edit `skills/start/SKILL.md`. This contains the full coordinator logic: all 9 steps (0-8), session resume, human review gates, error recovery, and context conservation rules.

### Testing changes

**Automated validation** runs after every Edit/Write via a Claude Code hook (`.claude/settings.json`). It checks:
- Manifest validity (JSON, required fields)
- All 23 agent files exist with valid frontmatter
- Model tiers match the spec (sonnet/haiku/opus)
- Coordinator skill exists with required keywords

Run manually: `./scripts/validate.sh`

For test commands, tiers, and quick rules, see the Testing section in CLAUDE.md.

### Key constraints

- **`references/shared-context.md`**: Read by every agent. Changes here affect all agents.
- **Plugin caching**: Plugins are copied to a cache dir on install. All file references must be within the plugin directory or in the user's CWD.
