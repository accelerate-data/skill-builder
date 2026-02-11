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
| Research (Steps 0, 2) | Sonnet | `"sonnet"` |
| Reasoner (Step 4) | Opus | `"opus"` |
| Builder/Validator/Tester (Steps 5-7) | Sonnet | `"sonnet"` |

## Workflow (9 Steps)

0. **Research Concepts** — research agent writes `clarifications-concepts.md`
1. **Concepts Review** — user answers questions via form UI
2. **Research Patterns + Data + Merge** — single orchestrator (spawns sub-agents internally)
3. **Human Review** — user answers merged questions via form UI
4. **Reasoning** — multi-turn conversation, produces `decisions.md`
5. **Build** — creates SKILL.md + reference files
6. **Validate** — checks against best practices
7. **Test** — generates and evaluates test prompts
8. **Package** — creates `.skill` zip archive

## Data Model (Repo Structure)

```
<repo>/
  <skill-name>/
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
