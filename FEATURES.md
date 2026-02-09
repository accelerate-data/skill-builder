# Feature Checklist

## Plugin Infrastructure

- [x] **F1: Plugin manifest** — `.claude-plugin/plugin.json` with name, version, description, component paths
- [x] **F2: Coordinator skill** — `skills/start/SKILL.md` invocable via `/skill-builder:start`
- [x] **F3: Shared context reference** — `references/shared-context.md` readable by all agents at runtime
- [x] **F4: Plugin root path resolution** — Coordinator uses `$(echo $CLAUDE_PLUGIN_ROOT)` to resolve paths to plugin files

## Agent Definitions

- [x] **F5: research-concepts agent** — `agents/research-concepts.md` with sonnet model, Step 1 instructions
- [x] **F6: research-patterns agent** — `agents/research-patterns.md` with sonnet model, Step 3a instructions
- [x] **F7: research-data agent** — `agents/research-data.md` with sonnet model, Step 3b instructions
- [x] **F8: merge agent** — `agents/merge.md` with haiku model, Step 4 instructions
- [x] **F9: reasoning agent** — `agents/reasoning.md` with opus model, Step 6 instructions
- [x] **F10: build agent** — `agents/build.md` with sonnet model, Step 7 instructions
- [x] **F11: validate agent** — `agents/validate.md` with sonnet model, Step 8 instructions
- [x] **F12: test agent** — `agents/test.md` with sonnet model, Step 9 instructions

## Coordinator Workflow (in `skills/start/SKILL.md`)

- [x] **F13: Initialization** — Ask domain, derive skill name, create directory structure
- [x] **F14: Session resume** — Detect existing `workflow-state.md`, offer continue/reset
- [x] **F15: Step 1 orchestration** — Spawn research-concepts agent, relay summary
- [x] **F16: Step 2 human gate** — Show file path, wait for user to answer questions
- [x] **F17: Step 3 parallel orchestration** — Spawn research-patterns + research-data in single message
- [x] **F18: Step 4 orchestration** — Spawn merge agent after both Step 3 agents complete
- [x] **F19: Step 5 human gate** — Show merged file path, wait for user answers
- [x] **F20: Step 6 orchestration** — Spawn reasoning agent, relay summary, handle follow-up loops
- [x] **F21: Step 7 orchestration** — Spawn build agent, relay structure + summary
- [x] **F22: Step 8 orchestration** — Spawn validate agent, relay pass/fail counts
- [x] **F23: Step 9 orchestration** — Spawn test agent, relay results, offer rebuild loop
- [x] **F24: Step 10 packaging** — Zip skill directory into `.skill` archive
- [x] **F25: Workflow state tracking** — Update `workflow-state.md` at start of each step
- [x] **F26: Progress tracking** — Use shared team task list (TaskCreate/TaskList) for visible step progress
- [x] **F27: Context conservation** — Coordinator never reads agent output files into its own context
- [x] **F28: Error recovery** — Handle agent failures, offer retry for individual steps

## Agent Capabilities (verified by agent definitions)

- [x] **F29: Shared context reading** — All agents can read `shared-context.md` from coordinator-provided path
- [x] **F30: Clarification format** — Research agents output questions in the standard Q&A format
- [x] **F31: Scoped research** — Steps 3a/3b agents read answered Step 1 file to narrow research scope
- [x] **F32: Deduplication logic** — Merge agent identifies duplicates across research outputs
- [x] **F33: Multi-turn reasoning** — Reasoning agent handles follow-up question loops
- [x] **F34: Decision merging** — Reasoning agent rewrites `decisions.md` as clean snapshot
- [x] **F35: Skill structure** — Build agent creates SKILL.md (<500 lines) + references/ layout
- [x] **F36: Best practices fetch** — Validate agent fetches Anthropic best practices URL
- [x] **F37: Auto-fix** — Validate agent auto-fixes straightforward issues
- [x] **F38: Test generation** — Test agent generates 8-10 realistic domain-specific prompts
- [x] **F39: Gap analysis** — Test agent identifies content gaps and suggests PM prompts

## Cleanup

- [x] **F40: Remove prompts/ directory** — Content migrated to agents/ and references/
- [x] **F41: Remove cowork/ directory** — Plugin replaces cowork mode
- [x] **F42: Update .gitignore** — Track plugin `skills/` dir, keep ignoring `.claude/` and `*.skill`
- [x] **F43: Update README.md** — Plugin installation, usage, workflow overview

## Distribution (Future)

- [ ] **F44: Marketplace listing** — Publish to a plugin marketplace
- [x] **F45: Version tagging** — Semantic versioning for plugin updates
- [x] **F46: GitHub source install** — `claude plugin install owner/skill-builder`
