# Evals Generator Pluggable

## Current Binding

Pluggable: **skill-creator**
Plugin path: `plugins/skill-creator/`

## Path Resolution

Resolve absolute paths to the plugin at runtime:

1. Start from this file's own location (`skill-evals-generator/references/`)
2. Walk up three levels to reach the `plugins/` directory
3. Skill-creator root = `<plugins-dir>/skill-creator/skills/skill-creator/`
4. References root = `<plugins-dir>/skill-creator/skills/skill-creator/references/`

In bash (relative to this file's directory):

```bash
PLUGINS_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
SKILL_CREATOR_ROOT="$PLUGINS_DIR/skill-creator/skills/skill-creator"
SCHEMAS_ROOT="$SKILL_CREATOR_ROOT/references"
```

## References Used

### SKILL.md

The **Test Cases** section defines eval quality standards (realistic prompts, atomic verifiable
assertions, eval_name + slug requirements).

```bash
cat "$SKILL_CREATOR_ROOT/SKILL.md"
```

### schemas.md

Full JSON schema definitions for evals (eval_name, slug, prompt, expectations[]).

```bash
cat "$SCHEMAS_ROOT/schemas.md"
```

## Output Contract

Any replacement skill must:

1. Accept a prompt containing a scenario intent and an absolute output path
2. Write `pending-eval.json` to the specified path
3. Output must match the PendingEval schema: `eval_name`, `slug`, `prompt`, `expectations[]`
4. No other files or output — JSON only

## Swapping the Pluggable

To replace skill-creator with a different backend:

1. Update **Skill-creator root** and **References root** paths in this file to point to the new plugin
2. Verify the new plugin provides `SKILL.md` with a Test Cases quality section
3. Verify the new plugin provides `references/schemas.md` with eval schema
4. No changes to `SKILL.md` are required
