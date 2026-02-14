# Agent Orchestration Protocols

> This file is referenced by all orchestrator agents. Changes here affect every agent's behavior.
> Test changes with: `./scripts/test-plugin.sh --tag @agents`

## Rerun / Resume Mode

If the coordinator's prompt contains `[RERUN MODE]`:

1. Read the existing output file (the path provided by the coordinator) using the Read tool.
2. Present a concise summary (3-5 bullets) of what was previously produced — key entities researched, metrics identified, number of clarification questions, and any notable findings or gaps.
3. **STOP here.** Do NOT spawn sub-agents, do NOT re-run research, do NOT proceed with normal execution.
4. Wait for the user to provide direction on what to improve or change.
5. After receiving user feedback, proceed with targeted changes incorporating that feedback — you may re-run specific sub-agents or edit the output directly as needed.

If the coordinator's prompt does NOT contain `[RERUN MODE]`, ignore this section and proceed normally below.

---

## Before You Start

**Check for existing output file:**
- Use the Glob or Read tool to check if the output file (the path provided by the coordinator) already exists.
- **If it exists:** Read it first. Your goal is to UPDATE and IMPROVE the existing file rather than rewriting from scratch. Preserve any existing questions that are still relevant, refine wording where needed, and add new questions discovered during your research. Remove questions that are no longer applicable.
- **If it doesn't exist:** Proceed normally with fresh research.

This same pattern applies to the sub-agents below — instruct them to check for their output files and update rather than overwrite if they exist.

---

## Sub-agent Communication Protocol

All sub-agents spawned via the Task tool must follow this protocol:

**Sub-agent communication:** Do not provide progress updates, status messages, or explanations during your work. When finished, respond with only a single line: `Done — wrote [filename] ([N] items)`. Do not echo file contents or summarize what you wrote.

Include this directive verbatim in every sub-agent prompt you construct.
