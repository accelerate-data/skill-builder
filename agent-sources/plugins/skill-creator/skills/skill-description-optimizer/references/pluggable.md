# Description Optimization Pluggable

## Current Binding

Pluggable: **skill-creator**
Plugin path: `plugins/skill-creator/`

## Path Resolution

Resolve absolute paths to the plugin at runtime:

1. Start from this file's own location (`skill-description-optimizer/references/`)
2. Walk up three levels to reach the `plugins/` directory
3. Scripts root = `<plugins-dir>/skill-creator/skills/skill-creator/scripts/`
4. Assets root = `<plugins-dir>/skill-creator/skills/skill-creator/assets/`
5. Local scripts root = `<plugins-dir>/skill-creator/skills/skill-description-optimizer/scripts/`

In bash (relative to this file's directory):

```bash
PLUGINS_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS_ROOT="$PLUGINS_DIR/skill-creator/skills/skill-creator/scripts"
ASSETS_ROOT="$PLUGINS_DIR/skill-creator/skills/skill-creator/assets"
LOCAL_SCRIPTS_ROOT="$PLUGINS_DIR/skill-creator/skills/skill-description-optimizer/scripts"
```

## Script Interfaces

### run_loop.py

Runs the full eval/improve loop.

```bash
uv run "$SCRIPTS_ROOT/run_loop.py" \
  --eval-set <path-to-json> \
  --skill-path <skill-dir> \
  --project-root <repo-root-with-.claude> \
  --model <model-id> \
  [--max-iterations 5] \
  [--verbose]
```

stdout: single pretty-printed JSON object

- Success: `{"ok": true, "best_description": "...", "original_description": "...", "best_score": "N/N", "iterations_run": N, "history": [...]}`
- Error: `{"ok": false, "error": "...", "hint": "..."}`

stderr: diagnostics

### improve_description.py

Called internally by `run_loop.py` — not invoked directly.

## Asset Interfaces

### eval_review.html

Interactive HTML editor for reviewing and editing eval queries before the optimization run.

Path: `$ASSETS_ROOT/eval_review.html`

Placeholders to replace before opening:

| Placeholder | Replace with |
|---|---|
| `__EVAL_DATA_PLACEHOLDER__` | JS array literal — no surrounding quotes |
| `__SKILL_NAME_PLACEHOLDER__` | skill name string |
| `__SKILL_DESCRIPTION_PLACEHOLDER__` | current description string |

User edits queries and clicks "Export Eval Set" → downloads `eval_set.json` to `~/Downloads/`.
Check for the most recent file if multiples exist (e.g. `eval_set (1).json`).

## Swapping the Pluggable

To replace skill-creator with a different description optimization backend:

1. Update **Scripts root** and **Assets root** paths in this file to point to the new plugin
2. Verify the new plugin provides `run_loop.py` matching the JSON output schema above
3. Verify the new plugin provides an `eval_review.html` with the same three placeholders
4. No changes to `SKILL.md` are required
