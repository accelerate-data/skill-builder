---
inclusion: always
---

# Agent Orchestration

## Claude Agent SDK (Node.js Sidecar)

Agents run via the **Claude Agent SDK** in a Node.js sidecar process. This provides all Claude Code tools for free.

### How It Works

1. **Rust backend** spawns `node agent-runner.js` as child process
2. Writes agent config to stdin (JSON): prompt, model, API key, cwd, allowed tools
3. **Sidecar** uses SDK's `query()` function
4. SDK handles full tool execution loop (Read, Write, Glob, Grep, Bash, Task)
5. Sidecar streams `SDKMessage` objects as JSON lines to stdout
6. **Rust backend** reads stdout, parses JSON, emits Tauri events
7. **Frontend** subscribes to Tauri events for real-time display
8. To cancel: Rust kills the child process

### Key Benefits

- **No prompt modifications** — existing prompts work as-is
- **Sub-agents work** — SDK supports Task tool for spawning sub-agents
- **No tool execution loop to build** — SDK handles internally
- **Session resume** — SDK supports `resume: sessionId` for continuing conversations

### Model Mapping

| Agent | Model | SDK Value |
|-------|-------|-----------|
| Research (Steps 1, 3) | Sonnet | `"sonnet"` |
| Merger (Step 4) | Haiku | `"haiku"` |
| Reasoner (Step 6) | Opus | `"opus"` |
| Builder/Validator/Tester (Steps 7-9) | Sonnet | `"sonnet"` |

## Workflow (10 Steps)

1. **Research Domain Concepts** — research agent writes `clarifications-concepts.md`
2. **Domain Concepts Review** — user answers questions via form UI
3. **Research Patterns + Data Modeling** — two agents run in parallel
4. **Merge** — deduplicate questions into `clarifications.md`
5. **Human Review** — user answers merged questions via form UI
6. **Reasoning** — multi-turn conversation, produces `decisions.md`
7. **Build** — creates SKILL.md + reference files
8. **Validate** — checks against best practices
9. **Test** — generates and evaluates test prompts
10. **Package** — creates `.skill` zip archive

## Data Model (Repo Structure)

```
<repo>/
  <skill-name>/
    workflow.md                    # Session state
    SKILL.md                       # Main skill file
    references/                    # Deep-dive reference files
    <skill-name>.skill             # Packaged zip
    context/                       # Intermediate working files
      clarifications-concepts.md
      clarifications-patterns.md
      clarifications-data.md
      clarifications.md
      decisions.md
      agent-validation-log.md
      test-skill.md
```
