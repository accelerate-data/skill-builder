# Linear Operations — MCP Patterns

This reference covers how to interact with Linear via MCP tools. All Linear operations are performed by sub-agents, not the coordinator.

## MCP Requirement

This skill **requires** Linear MCP tools. If they are not available in the current environment, stop and tell the user:

> "Linear MCP tools are not configured. Please add the Linear MCP server to your Claude Code configuration (in `.claude/settings.json` or `~/.claude/settings.json`) and restart."

Do NOT attempt to use curl, GraphQL, or any other workaround. MCP only.

## Sub-agent Prompt Templates

### Fetch Projects Sub-agent

Spawn this to get the list of available projects before asking the user which one to use.

```
You have access to Linear MCP tools. List all available Linear projects/teams.

Return ONLY a clean list:
- Project name | Project ID

No commentary. Just the list.
```

### Fetch Labels Sub-agent

Spawn this to get existing labels before the coordinator presents options to the user.

```
You have access to Linear MCP tools.

Fetch all labels for team/project: [team or project identifier]

Return ONLY a clean list:
- Label name | Label ID

No commentary. Just the list.
```

### Issue Creation Sub-agent

This is the main Linear operations sub-agent. It handles user lookup, optional label creation, and issue creation in a single call.

```
You have access to Linear MCP tools. Execute the following Linear operations in order.

**Step 1: Look up user**
Find the Linear user with email: [user email]
You need their user ID for assignment.

**Step 2: Create labels (if needed)**
[If new labels were approved by the user, list them here]
Create these labels in team/project: [team/project ID]
Skip this step if no new labels are needed.

**Step 3: Create the issue**
- Title: [title]
- Description:
[full markdown description]
- Team/Project: [team/project ID]
- Assignee: [user ID from step 1]
- Labels: [list of label IDs — existing ones + any created in step 2]
- Estimate: [numeric value]
- Priority: [priority level]

**Return**: The issue identifier (e.g., PROJ-123) and URL if available. Nothing else.
```

## Estimate Mapping

Linear supports custom estimate scales. The user's scale is t-shirt sizes:

| Label | Value | Meaning |
|-------|-------|---------|
| XS | 1 | < 10 min agent effort |
| S | 2 | ~30 min |
| M | 3 | 1-2 hours |
| L | 5 | Half day (maximum single issue size) |

L is the cap. If scope exceeds L, the coordinator should break it into multiple issues rather than creating one oversized ticket. Set the estimate field to the corresponding numeric value.

## Priority Inference

The coordinator infers priority from context before handing off to the creation sub-agent:

- **Urgent**: blocking users, data loss, security
- **High**: significant UX issue, broken flow
- **Medium**: improvement, moderate bug
- **Low**: nice-to-have, cosmetic
- **None**: if unclear, don't set — let user adjust later

## Label Strategy

1. Fetch all labels for the team/project (via sub-agent)
2. Coordinator matches against issue content (feature area, type, component)
3. If a good match exists, use it
4. If no match, coordinator proposes a new label to the user and confirms before including it in the creation sub-agent's instructions
5. Common label patterns: `feature`, `bug`, `improvement`, `ux`, `performance`, `infrastructure`

## Issue Description Quality

The description is the most important output. It stays at the **product manager level**.

It should be:

1. **Concise**: No filler. Every sentence carries information.
2. **Product-level**: Describes what the user experiences, how the feature behaves, what the API contract looks like.
3. **Testable**: Every acceptance criterion can be verified by a PM without reading code.
4. **Free of implementation details**: No file names, component names, architecture, or code patterns.

**Bad acceptance criterion**: "Update the MessageBubble component to use variant-based styling"
**Good acceptance criterion**: "Agent responses are visually distinct from user messages and system messages (e.g., different background color or border)"

**Bad requirement**: "Add a new endpoint GET /api/v2/conversations with pagination"
**Good requirement**: "Users can retrieve their conversation history through the API with pagination support (page size, cursor-based navigation)"
