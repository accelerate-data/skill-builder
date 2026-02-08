# Test Plan

## T1: Plugin Structure Validation

### T1.1: Manifest exists and is valid
- `.claude-plugin/plugin.json` exists
- Contains required fields: `name`, `version`, `description`
- `skills` and `agents` paths point to existing directories
- **How to test**: `cat .claude-plugin/plugin.json | python3 -m json.tool`

### T1.2: All agent files exist
- `agents/research-concepts.md` exists
- `agents/research-patterns.md` exists
- `agents/research-data.md` exists
- `agents/merge.md` exists
- `agents/reasoning.md` exists
- `agents/build.md` exists
- `agents/validate.md` exists
- `agents/test.md` exists
- **How to test**: `ls agents/`

### T1.3: Agent frontmatter is valid
- Each agent file has YAML frontmatter delimited by `---`
- Each has `name`, `description`, `tools`, `model`
- Models match the model selection table (sonnet/haiku/opus)
- **How to test**: For each file, verify frontmatter parses correctly

### T1.4: Skill file exists
- `skills/start/SKILL.md` exists
- Has YAML frontmatter with `name` and `description`
- **How to test**: `cat skills/start/SKILL.md | head -20`

### T1.5: Shared context exists
- `references/shared-context.md` exists
- Content matches original `prompts/shared-context.md`
- **How to test**: `diff references/shared-context.md` against original (on main branch)

### T1.6: Old files removed
- `prompts/` directory does not exist
- `cowork/` directory does not exist
- **How to test**: `ls prompts/ cowork/` should fail

### T1.7: .gitignore updated
- `skills/` is NOT in .gitignore (plugin skills dir must be tracked)
- `.claude/` IS in .gitignore
- `*.skill` IS in .gitignore
- **How to test**: `cat .gitignore`

## T2: Plugin Loading

### T2.1: Plugin loads without errors
- Run `claude --plugin-dir /path/to/repo`
- No error messages about manifest, agents, or skills
- **How to test**: `claude --plugin-dir . --print-plugins` (or equivalent)

### T2.2: Skill appears in slash commands
- `/skill-builder:start` appears in autocomplete
- **How to test**: Type `/skill-builder` in Claude Code session with plugin loaded

### T2.3: Agents are discoverable
- All 8 agents are available as subagent types
- **How to test**: In a session with the plugin, try spawning each agent via Task tool

## T3: Coordinator Skill Behavior

### T3.1: Initialization flow
- Invoke `/skill-builder:start`
- Coordinator asks for domain
- User provides domain (e.g., "sales pipeline")
- Coordinator derives skill name, asks for confirmation
- Coordinator creates `./context/` and `./<name>/references/` directories
- Coordinator writes `./workflow-state.md`
- **How to test**: Run `/skill-builder:start`, provide a domain, verify directories created

### T3.2: Session resume — continue
- Start a workflow, complete Step 1
- Exit session
- Start new session, invoke `/skill-builder:start` with same skill name
- Coordinator detects existing `workflow-state.md`
- Coordinator offers continue/reset
- Choose continue — coordinator resumes from recorded step
- **How to test**: Manual walkthrough

### T3.3: Session resume — reset
- Same as T3.2 but choose reset
- Coordinator deletes skill directory and starts fresh
- **How to test**: Manual walkthrough, verify old files deleted

### T3.4: Plugin root path resolution
- Coordinator correctly resolves `$CLAUDE_PLUGIN_ROOT`
- Passes correct path to agents for `shared-context.md`
- **How to test**: Check agent Task prompts include absolute path to `references/shared-context.md`

### T3.5: Context conservation
- Coordinator does NOT read agent output files into its context
- Coordinator shows summaries returned by agents
- Coordinator tells user file paths for manual review
- **How to test**: Observe coordinator behavior through Steps 1-2

## T4: Agent Execution

### T4.1: Research concepts agent (Step 1)
- Spawned via `Task(subagent_type: "skill-builder:research-concepts")`
- Reads shared context from provided path
- Writes `clarifications-concepts.md` in correct format
- Output has questions with choices, recommendations, empty Answer fields
- Returns a brief summary (not full content)
- **How to test**: Run Step 1 and verify output file

### T4.2: Research patterns agent (Step 3a)
- Reads answered `clarifications-concepts.md` to narrow scope
- Only researches patterns for confirmed in-scope concepts
- Writes `clarifications-patterns.md` in correct format
- **How to test**: Run Step 3 and verify output file

### T4.3: Research data agent (Step 3b)
- Runs in parallel with Step 3a (both in single message)
- Reads answered `clarifications-concepts.md` to narrow scope
- Writes `clarifications-data.md` in correct format
- **How to test**: Run Step 3 and verify both agents complete

### T4.4: Merge agent (Step 4)
- Reads `clarifications-patterns.md` and `clarifications-data.md`
- Does NOT re-merge `clarifications-concepts.md`
- Identifies and removes duplicate questions
- Writes merged `clarifications.md` with sequential numbering
- Original files preserved
- **How to test**: Run Step 4, verify merge summary comment, check for duplicates

### T4.5: Reasoning agent (Step 6)
- Reads answered `clarifications-concepts.md` and `clarifications.md`
- Reads existing `decisions.md` if present
- Returns reasoning summary (implications, gaps, contradictions)
- If follow-ups needed: adds questions to `clarifications.md` under `## Follow-up Questions`
- After confirmation: writes/rewrites `decisions.md` as clean snapshot
- **How to test**: Run Step 6, verify reasoning summary and decisions.md output

### T4.6: Build agent (Step 7)
- Reads `decisions.md` from context directory
- Reads shared context from provided path
- Creates `SKILL.md` at skill directory root (<500 lines)
- Creates reference files in `references/` subdirectory
- Each reference file self-contained per topic
- **How to test**: Run Step 7, verify skill structure

### T4.7: Validate agent (Step 8)
- Fetches best practices from Anthropic URL
- Inventories all skill files
- Checks against best practices criteria
- Auto-fixes straightforward issues
- Writes `agent-validation-log.md` with summary and per-criterion results
- **How to test**: Run Step 8, verify validation log

### T4.8: Test agent (Step 9)
- Generates 8-10 realistic test prompts
- Evaluates skill coverage for each (PASS/PARTIAL/FAIL)
- Identifies content gaps and organization issues
- Suggests additional PM prompts
- Writes `test-skill.md` with full report
- **How to test**: Run Step 9, verify test report

## T5: Human Gates

### T5.1: Step 2 gate
- Coordinator shows file path to `clarifications-concepts.md`
- Does NOT proceed until user explicitly confirms answers are filled
- **How to test**: Try to advance without confirming — coordinator should block

### T5.2: Step 5 gate
- Same as T5.1 but for `clarifications.md`

### T5.3: Step 6 reasoning confirmation
- Coordinator shows reasoning summary
- Waits for user to confirm or correct
- If follow-ups: directs user to answer new questions, re-runs reasoning
- Only proceeds to build after explicit confirmation

### T5.4: Step 7 structure confirmation
- Build agent proposes folder structure
- Waits for user confirmation before drafting

## T6: End-to-End Workflow

### T6.1: Full workflow completion
- Run all 10 steps from initialization to packaging
- Verify all intermediate files created in correct locations
- Verify final `.skill` zip archive created
- Verify `workflow-state.md` shows status = "completed"
- **How to test**: Full manual walkthrough with a real domain

### T6.2: Parallel agent execution (Step 3)
- Both research-patterns and research-data agents spawn simultaneously
- Both complete independently
- Coordinator waits for both before proceeding to Step 4
- **How to test**: Observe Step 3 execution timing

### T6.3: Error recovery — agent failure
- If an agent fails, coordinator reports the failure
- Coordinator offers to retry just that agent
- Retry succeeds and workflow continues
- **How to test**: Simulate by interrupting an agent

### T6.4: Rebuild loop (Step 9 → Step 7)
- If test agent finds significant gaps
- Coordinator offers to loop back to build step
- Re-build addresses the gaps
- Re-validation and re-testing pass
- **How to test**: Manual — review test results and choose to rebuild

## T7: Regression (vs. CLI version)

### T7.1: Output format compatibility
- `clarifications-*.md` files follow same Q&A format as CLI version
- `decisions.md` follows same D1/D2/D3 format
- `SKILL.md` follows same metadata + overview + references structure
- **How to test**: Compare output format against CLI-generated files

### T7.2: Content principles preserved
- Agents follow shared-context.md content principles:
  - Omit what LLMs know
  - Focus on hard-to-find domain knowledge
  - Guide what/why, not exact how
- **How to test**: Review agent output for adherence

### T7.3: Model tier preservation
- research agents use sonnet
- merge uses haiku
- reasoning uses opus
- build/validate/test use sonnet
- **How to test**: Verify agent frontmatter models match table
