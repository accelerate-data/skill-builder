# Shared Eval Harness Adoption Guide

Use this guide when adding the shared Promptfoo/OpenCode harness to another repo before the framework is extracted into a package.

## What To Copy

Copy the framework-owned files into the target repo's `tests/evals/` folder:

- `bin/ad-evals.js`
- `scripts/framework/**`
- `scripts/promptfoo.sh`
- framework tests under `scripts/*.test.js` and `scripts/framework/*.test.js`
- `config/eval-tiers.toml`

Copy or adapt these project-owned support files:

- `package.json`
- `eval-map.json`
- `docs/scenario-inventory.md`
- `packages/harness-smoke/promptfooconfig.json`

Do not copy Skill Builder's project-specific packages unless the target repo evaluates the same prompts.

## Required Repo Layout

The target repo should use this layout:

```text
tests/evals/
  bin/ad-evals.js
  config/eval-tiers.toml
  eval-map.json
  package.json
  packages/
    harness-smoke/promptfooconfig.json
    <project-package>/promptfooconfig.json
  scripts/
    framework/
    promptfoo.sh
```

Each package config must be named one of:

- `promptfooconfig.json`
- `promptfooconfig.yaml`
- `promptfooconfig.yml`
- `suite.json`
- `suite.yaml`
- `suite.yml`

Other package-local JSON/YAML files are treated as data, not runnable configs.

## Configure Model And Tier Policy

Edit `tests/evals/config/eval-tiers.toml` for the repo:

```toml
[runtime]
provider_id = "file://scripts/framework/opencode-cli-provider.js"
opencode_config = "opencode.json"
project_dir = "../.."
format = "default"
log_level = "ERROR"
print_logs = false
empty_output_retries = 1

[tiers.light]
agent = "eval_light"

[tiers.standard]
agent = "eval_standard"

[tiers.high]
agent = "eval_high"

[tiers.x_high]
agent = "eval_x_high"
```

Keep model names, step budgets, and agent permissions in `tests/evals/opencode.json`. Package configs choose a tier with:

```json
{
  "metadata": {
    "eval_tier": "standard"
  }
}
```

Do not add `providers` to package configs.

## Add Package Evals

Create one folder per eval package:

```text
tests/evals/packages/<package-name>/
  promptfooconfig.json
  prompt.txt
```

Each package config must include exactly one smoke case:

```json
{
  "description": "Project package behavior.",
  "metadata": {
    "eval_tier": "standard"
  },
  "prompts": ["file://prompt.txt"],
  "tests": [
    {
      "description": "[smoke] package executes through the harness",
      "assert": [
        {
          "type": "javascript",
          "value": "output.trim().length > 0"
        }
      ]
    }
  ]
}
```

Use smoke cases to prove execution. Use regression cases for stricter behavior checks.

## Update `eval-map.json`

Keep `tests/evals/eval-map.json` as the coding-agent navigation file. It should describe:

- commands
- directory ownership
- framework files
- package contract
- every package config and prompt
- runtime state model

Add or update deterministic tests so the map and discovered package configs stay in sync.

## Add Package Scripts

Use these required scripts:

```json
{
  "scripts": {
    "eval:smoke": "node bin/ad-evals.js smoke",
    "eval:regression": "node bin/ad-evals.js regression",
    "test": "node bin/ad-evals.js test",
    "test:harness": "node --test scripts/*.test.js scripts/framework/*.test.js",
    "doctor": "node bin/ad-evals.js doctor",
    "view": "node bin/ad-evals.js view"
  }
}
```

Add optional package aliases for common package-local runs:

```json
{
  "scripts": {
    "eval:my-package": "node bin/ad-evals.js run packages/my-package/promptfooconfig.json"
  }
}
```

## Runtime State

Do not create worktree symlinks for Promptfoo. The framework resolves state when commands run:

- Promptfoo state: Git common dir, `ad-evals/promptfoo`
- OpenCode state: Git common dir, `ad-evals/opencode-state`
- cache/log/media/tmp: current worktree under `tests/evals/`

Run:

```bash
cd tests/evals
npm run doctor
```

Verify shared state is outside the worktree and generated artifacts are inside the worktree.

## Validation

Run these after porting:

```bash
cd tests/evals
npm test
npm run doctor
npm run eval:harness-smoke
npm run eval:smoke
```

For framework-port validation, `eval:smoke` must execute every discovered package and must not fail from config/provider/materialization errors. Scenario failures or model assertion failures are report output; fix them only when the issue is package behavior, not harness wiring.

Run a targeted package when diagnosing package behavior:

```bash
cd tests/evals
npm run eval:<package-alias>
```

## Worktree Setup

Worktree creation should install dependencies but should not link Promptfoo state. If the repo has a worktree helper, remove any step that creates `tests/evals/.promptfoo` symlinks. The eval runtime owns Promptfoo state export.

## Common Failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `metadata.eval_tier` missing | Package config is missing the tier selector | Add `metadata.eval_tier` with `light`, `standard`, `high`, or `x_high`. |
| Package data JSON is executed as a config | File is named like a runnable config | Keep runnable configs named `promptfooconfig.*` or `suite.*`; use other names for data. |
| Provider path is unresolved | `config/eval-tiers.toml` points outside the framework layout | Use `file://scripts/framework/opencode-cli-provider.js`. |
| Promptfoo dirties package files | Eval writes outside generated artifact roots | Move outputs under `.cache/`, `.tmp/`, `output/`, or `results/`. |
| `eval:smoke` reports failures but exits cleanly | Scenario assertions failed after execution | Treat as behavior feedback, not harness-port failure. |

## Extraction Checklist

Before extracting to a standalone package:

- Port Skill Builder with the local framework.
- Port `migration-utility` without changing framework files.
- Confirm Git common-dir state export works in both repos.
- Confirm package discovery ignores package-local data files.
- Confirm `eval-map.json` gives coding agents enough context to add packages safely.
- Keep repo-specific YAML, prompts, fixtures, and assertions out of the framework package.
