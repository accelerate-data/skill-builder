# File Formats Reference

## session.json

Location: `.vibedata/<skill-name>/session.json`

Tracks the state of a skill-building session. Written by the coordinator during Scoping; updated at each phase transition.

```json
{
  "skill_name": "sales-pipeline",
  "skill_type": "domain",
  "domain": "sales pipeline analytics",
  "skill_dir": "~/skill-builder/sales-pipeline/",
  "created_at": "2026-02-15T10:30:00Z",
  "last_activity": "2026-02-18T14:20:00Z",
  "current_phase": "clarification",
  "phases_completed": ["scoping", "research"],
  "mode": "guided",
  "research_dimensions_used": ["entities", "metrics", "business-rules"],
  "clarification_status": { "total_questions": 15, "answered": 8 },
  "auto_filled": false
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `skill_name` | string | Kebab-case identifier derived from domain |
| `skill_type` | string | One of: `domain`, `platform`, `source`, `data-engineering` |
| `domain` | string | Human-readable domain name |
| `skill_dir` | string | Path to the skill output directory. Default: `~/skill-builder/<skill-name>/`. Updated if user moves the directory. |
| `created_at` | ISO 8601 | When the session was created |
| `last_activity` | ISO 8601 | When the session was last updated |
| `current_phase` | string | Current phase: `scoping`, `research`, `clarification`, `refinement_pending`, `refinement`, `decisions`, `generation`, `validation` |
| `phases_completed` | array | Ordered list of completed phases |
| `mode` | string | Workflow mode: `guided` or `express` |
| `research_dimensions_used` | array | Dimension IDs used by the research-orchestrator agent |
| `clarification_status` | object | `{ total_questions, answered }` — counts from clarifications.md |
| `auto_filled` | boolean | True if express mode auto-filled any `**Answer:**` fields from recommendations |

### Notes

- `session.json` is coordinator-internal — agents never read or write it directly. The coordinator passes `context_dir` and `skill_dir` to agents.
- Artifact table scan (state detection) overrides `current_phase` when they disagree — `current_phase` is informational only.
- `skill_dir` defaults to `~/skill-builder/<skill-name>/`. If the user moves the directory, the coordinator updates `skill_dir` and moves the files.
