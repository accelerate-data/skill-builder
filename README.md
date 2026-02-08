# Skill Builder

A multi-agent workflow for creating Anthropic Claude skills. Domain-agnostic — you choose the functional domain at startup. Skills target data/analytics engineers who need functional context for silver and gold table modeling.

## How It Works

Say **"start"**, **"run the workflow"**, or **"build the skill"** in Claude Code. The coordinator (defined in `CLAUDE.md`) handles everything: creating a team, spawning agents, tracking state, and walking you through each step.

## Workflow Overview

| Step | What Happens | Your Role |
|---|---|---|
| **Initialization** | Choose a domain and skill name | Provide domain, confirm name |
| **Step 1** | Research agent identifies key entities, metrics, KPIs | Wait |
| **Step 2** | Review domain concept questions | Answer each question in the file |
| **Step 3** | Two agents research business patterns + data modeling (parallel) | Wait |
| **Step 4** | Merge agent deduplicates questions | Wait |
| **Step 5** | Review merged clarification questions | Answer each question in the file |
| **Step 6** | Reasoning agent analyzes answers, finds gaps/contradictions | Confirm reasoning, answer follow-ups |
| **Step 7** | Build agent creates the skill files | Review skill output |
| **Step 8** | Validator checks against best practices | Review validation log |
| **Step 9** | Tester generates and runs test prompts | Review test results |
| **Step 10** | Package into a `.skill` zip archive | Done |

## Directory Structure

```
skill-builder/
├── CLAUDE.md                  # Coordinator instructions (read by Claude Code)
├── prompts/
│   ├── shared-context.md      # Skill builder purpose + file format definitions
│   ├── 01-research-domain-concepts.md
│   ├── 03a-research-business-patterns.md
│   ├── 03b-research-data-modeling.md
│   ├── 04-merge-clarifications.md
│   ├── 06-reasoning-agent.md
│   ├── 07-build-agent.md
│   ├── 08-validate-agent.md
│   └── 09-test-agent.md
├── skills/
│   └── <skillname>/
│       ├── workflow-state.md   # Session state (resume checkpoint)
│       ├── context/            # Working files (clarifications, decisions, logs)
│       └── skill/              # Deployable skill files (SKILL.md + references)
└── <skillname>.skill           # Final zip archive (created in Step 10)
```

## Agent Prompt Files

Each prompt file defines a single agent's behavior. The coordinator spawns them as teammates at the right step.

| File | Agent | Model Tier |
|---|---|---|
| `01-research-domain-concepts.md` | Domain concepts researcher | sonnet |
| `03a-research-business-patterns.md` | Business patterns researcher | sonnet |
| `03b-research-data-modeling.md` | Data modeling researcher | sonnet |
| `04-merge-clarifications.md` | Question deduplicator/merger | haiku |
| `06-reasoning-agent.md` | Reasoning + decision engine | opus |
| `07-build-agent.md` | Skill file creator | sonnet |
| `08-validate-agent.md` | Best practices validator | sonnet |
| `09-test-agent.md` | Test prompt generator + evaluator | sonnet |

## Session Resume

The workflow supports resuming from any step. State is tracked in `skills/<skillname>/workflow-state.md`. On restart, you'll be asked whether to continue or reset.

## Prerequisites

- Claude Code with access to sonnet, haiku, and opus models
- All files in this project folder
