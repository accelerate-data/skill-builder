# Plan: Convert Skill Builder CLI to Claude Code Plugin

## Context

The skill builder currently works by relying on `CLAUDE.md` (project-scoped coordinator) and `prompts/*.md` (agent instructions read at runtime). This requires the user to clone the repo and work inside it. Converting to a Claude Code **plugin** makes it installable, distributable, and usable from any project directory — the user just runs `/skill-builder:start` from anywhere.

## Architecture Mapping

| Current (CLI) | Plugin Equivalent |
|---|---|
| `CLAUDE.md` (coordinator) | `skills/start/SKILL.md` (slash command) |
| `prompts/01-*.md`, `03a-*.md`, etc. | `agents/*.md` (subagent definitions with frontmatter) |
| `prompts/shared-context.md` | `references/shared-context.md` (read by agents at runtime) |
| `cowork/cowork.md` | Removed — plugin works natively in Claude Code |
| Spawn via `general-purpose` + prompt file paths | Spawn via named agent types (`skill-builder:<agent-name>`) |
| TeamCreate / SendMessage / TeamDelete | TeamCreate / Task with team_name / SendMessage / TeamDelete (agent teams) |
| TaskCreate / TaskList | TaskCreate / TaskList (shared team task list) |

Key benefit: agent instructions are baked into the agent definitions, so the coordinator just passes runtime parameters (domain, paths) — no more telling agents which prompt files to read.

## Implementation Steps

### Step 1: Create plugin manifest
- **File**: `.claude-plugin/plugin.json`
- **Content**: name, version, description, paths to skills/ and agents/
- **Status**: Pending

### Step 2: Move shared context
- **From**: `prompts/shared-context.md`
- **To**: `references/shared-context.md`
- **Changes**: Content unchanged
- **Status**: Pending

### Step 3: Create agent definitions (8 files)
- **Directory**: `agents/`
- Migrate each `prompts/*.md` to an agent definition with YAML frontmatter

| Source File | Agent File | Model | Tools |
|---|---|---|---|
| `prompts/01-research-domain-concepts.md` | `agents/research-concepts.md` | sonnet | Read, Write, Glob, Grep, WebSearch |
| `prompts/03a-research-business-patterns.md` | `agents/research-patterns.md` | sonnet | Read, Write, Glob, Grep, WebSearch |
| `prompts/03b-research-data-modeling.md` | `agents/research-data.md` | sonnet | Read, Write, Glob, Grep, WebSearch |
| `prompts/04-merge-clarifications.md` | `agents/merge.md` | haiku | Read, Write, Glob, Grep |
| `prompts/06-reasoning-agent.md` | `agents/reasoning.md` | opus | Read, Write, Glob, Grep, Bash |
| `prompts/07-build-agent.md` | `agents/build.md` | sonnet | Read, Write, Glob, Grep |
| `prompts/08-validate-agent.md` | `agents/validate.md` | sonnet | Read, Write, Glob, Grep, WebFetch, Bash |
| `prompts/09-test-agent.md` | `agents/test.md` | sonnet | Read, Write, Glob, Grep |

Each agent file:
- YAML frontmatter: `name`, `description`, `tools`, `model`, `maxTurns`, `permissionMode: acceptEdits`
- Markdown body: instructions migrated from the source prompt file
- References to `shared-context.md` changed to: "Read the shared context file at the path provided by the coordinator"
- References to other prompt files removed (instructions are inline)
- **Status**: Pending

### Step 4: Create coordinator skill
- **File**: `skills/start/SKILL.md`
- **Source**: Current `CLAUDE.md` (276 lines of coordinator logic)
- **Key adaptations**:
  - Add YAML frontmatter (name, description)
  - Add `!`echo $CLAUDE_PLUGIN_ROOT`` for path resolution
  - Use `TeamCreate`/`SendMessage`/`TeamDelete` for agent team orchestration
  - Use `TaskCreate`/`TaskList` for shared team task list progress tracking
  - Replace `subagent_type: "general-purpose"` with `subagent_type: "skill-builder:<agent-name>"` and add `team_name` + `name` parameters
  - Remove "Read prompts/X.md" from spawn prompts (instructions are now in agent definitions)
  - Add shared context path to all spawn prompts: `{plugin_root}/references/shared-context.md`
  - Output paths remain relative to user's CWD: `./workflow-state.md`, `./context/`, `./<skillname>/`
  - Session resume logic unchanged
  - All 10 workflow steps preserved
  - Coordinator role, rules, error recovery preserved
- **Status**: Pending

### Step 5: Update .gitignore
- Remove `skills/` from ignore list (plugin `skills/` dir must be tracked)
- Keep `.claude/`, `*.skill`, `.DS_Store`
- **Status**: Pending

### Step 6: Update README.md
- Rewrite for plugin audience: installation, usage (`/skill-builder:start`), workflow overview
- **Status**: Pending

### Step 7: Delete old files
- Delete `prompts/` directory (content moved to `agents/` + `references/`)
- Delete `cowork/` directory (plugin replaces cowork mode)
- **Status**: Pending

## How Path Resolution Works

1. The coordinator skill uses `!`echo $CLAUDE_PLUGIN_ROOT`` to get the absolute plugin install path
2. When spawning agents, the coordinator passes:
   - `shared_context_path`: `{plugin_root}/references/shared-context.md`
   - Skill directory: `./<skillname>/` (for SKILL.md + references/)
   - Context directory: `./context/` (for working files)
   - `domain`: the user's chosen domain
3. Agents read shared context from the absolute path and write outputs to CWD-relative paths

## Verification

1. **Structure check**: Manually verify all files exist in the right locations
2. **Plugin load**: `claude --plugin-dir .` — confirm no errors
3. **Skill discovery**: `/skill-builder:start` appears in slash command autocomplete
4. **Agent discovery**: All 8 agents available as subagent types
5. **Path resolution**: `$CLAUDE_PLUGIN_ROOT` resolves correctly in skill
6. **E2E smoke test**: Run Steps 1-2 of the workflow from a fresh directory
7. **Session resume**: Start workflow, interrupt, restart and verify resume prompt

## Notes

- The `CLAUDE.md` file is now plugin development documentation (not the coordinator)
- The coordinator logic lives entirely in `skills/start/SKILL.md`
- Agent instructions are self-contained in `agents/*.md` (no external prompt file reads needed)
- `references/shared-context.md` is the only shared file agents read at runtime
