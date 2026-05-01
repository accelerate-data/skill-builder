# Release Docs CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix release packaging, docs deployment, and PR CI so automated checks are cheap but still catch release-resource and help-doc drift.

**Architecture:** Add two deterministic root scripts: one verifies staged release artifacts against the Tauri resource contract, and one verifies help URLs and VitePress sidebar links against `docs/user-guide`. Wire those scripts into targeted GitHub workflows, then narrow heavyweight PR CI so local `raising-linear-pr` remains the deep validation gate.

**Tech Stack:** GitHub Actions YAML, Tauri v2 resource config, Node.js built-in `node:test`, VitePress, markdown user guide files.

---

## File Structure

- Create `scripts/verify-release-stage.mjs`: CLI and exported verifier for staged release directories.
- Create `scripts/verify-release-stage.test.mjs`: Node built-in tests for release verifier success and missing-file failure.
- Create `scripts/check-help-docs.mjs`: CLI and exported checker for help URL/sidebar markdown targets.
- Create `scripts/check-help-docs.test.mjs`: Node built-in tests for help checker path resolution and missing-file failure.
- Modify `.github/workflows/release.yml`: stage the Tauri resource paths and run release verification before upload.
- Modify `.github/workflows/docs.yml`: use `npm ci`, add lockfile path trigger, and run help-doc checker.
- Modify `.github/workflows/pr-policy.yml`: path-filter docs build/help checks and expand repo-map audit paths.
- Modify `.github/workflows/pr-ci.yml`: make expensive jobs main/manual by default and keep PR checks cheap.
- Modify `docs/.vitepress/config.ts`: keep sidebar links parseable by the help checker.
- Modify `docs/user-guide/**/*.md`: refresh stale help content found during the implementation.
- Modify `AGENTS.md` or `repo-map.json` only if the implementation adds durable commands or structural guidance that should be discoverable by later agents.

## Task 1: Release Stage Verifier

**Files:**

- Create: `scripts/verify-release-stage.mjs`
- Create: `scripts/verify-release-stage.test.mjs`

- [ ] **Step 1: Write the failing release verifier tests**

Create `scripts/verify-release-stage.test.mjs` with Node's built-in test runner:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyReleaseStage } from "./verify-release-stage.mjs";

function makeStage() {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-release-"));
  const files = [
    "skill-builder.exe",
    "sidecar/dist/package.json",
    "sidecar/dist/bootstrap.js",
    "sidecar/dist/agent-runner.js",
    "sidecar/dist/sdk/manifest.json",
    "agent-sources/plugins/skill-creator/LICENSE.txt",
    "agent-sources/skills/skill-test/SKILL.md",
    "workspace/CLAUDE.md",
    "workspace/prompts/workflow-step.txt",
  ];

  for (const file of files) {
    const path = join(root, file);
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, "fixture\n");
  }

  return root;
}

test("verifyReleaseStage accepts a complete Windows stage", () => {
  const root = makeStage();
  try {
    assert.deepEqual(verifyReleaseStage(root, "windows"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseStage reports every missing required path", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-release-missing-"));
  try {
    const missing = verifyReleaseStage(root, "windows");
    assert.ok(missing.includes("skill-builder.exe"));
    assert.ok(missing.includes("sidecar/dist/bootstrap.js"));
    assert.ok(missing.includes("agent-sources/plugins/skill-creator/LICENSE.txt"));
    assert.ok(missing.includes("workspace/prompts/workflow-step.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the release verifier tests and confirm they fail**

Run:

```bash
node --test scripts/verify-release-stage.test.mjs
```

Expected: FAIL with an import error because `scripts/verify-release-stage.mjs` does not exist yet.

- [ ] **Step 3: Implement the release verifier**

Create `scripts/verify-release-stage.mjs`:

```javascript
#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_BY_PLATFORM = {
  windows: [
    "skill-builder.exe",
    "sidecar/dist/package.json",
    "sidecar/dist/bootstrap.js",
    "sidecar/dist/agent-runner.js",
    "sidecar/dist/sdk/manifest.json",
    "agent-sources/plugins/skill-creator/LICENSE.txt",
    "agent-sources/skills/skill-test/SKILL.md",
    "workspace/CLAUDE.md",
    "workspace/prompts/workflow-step.txt",
  ],
  macos: [
    "Skill Builder.app",
    "run.sh",
  ],
};

export function verifyReleaseStage(stageDir, platform) {
  const required = REQUIRED_BY_PLATFORM[platform];
  if (!required) {
    throw new Error(`Unknown release platform: ${platform}`);
  }

  return required.filter((relativePath) => !existsSync(resolve(stageDir, relativePath)));
}

function main() {
  const [stageDir, platform] = process.argv.slice(2);
  if (!stageDir || !platform) {
    console.error("Usage: node scripts/verify-release-stage.mjs <stage-dir> <windows|macos>");
    process.exit(2);
  }

  const missing = verifyReleaseStage(stageDir, platform);
  if (missing.length > 0) {
    console.error(`Release stage is missing ${missing.length} required path(s):`);
    for (const path of missing) {
      console.error(`- ${path}`);
    }
    process.exit(1);
  }

  console.log(`Release stage verified for ${platform}: ${stageDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run the release verifier tests and confirm they pass**

Run:

```bash
node --test scripts/verify-release-stage.test.mjs
```

Expected: PASS with two passing tests.

- [ ] **Step 5: Commit the release verifier**

Run:

```bash
git add scripts/verify-release-stage.mjs scripts/verify-release-stage.test.mjs
git commit -m "VU-1134: add release stage verifier"
```

## Task 2: Release Workflow Packaging Repair

**Files:**

- Modify: `.github/workflows/release.yml`
- Test: `scripts/verify-release-stage.test.mjs`

- [ ] **Step 1: Replace stale Windows resource staging**

In `.github/workflows/release.yml`, update the `Package Windows release` step so the staging block copies the Tauri resource contract instead of old `agents` and `references` folders:

```bash
          # Copy sidecar JS files. The Rust exe-relative fallback looks for
          # {exe_dir}/sidecar/dist/...
          mkdir -p "$STAGE/sidecar/dist/sdk"
          cp "app/sidecar/dist/package.json" "$STAGE/sidecar/dist/"
          cp "app/sidecar/dist/bootstrap.js" "$STAGE/sidecar/dist/"
          cp "app/sidecar/dist/agent-runner.js" "$STAGE/sidecar/dist/"
          cp "app/sidecar/dist/sdk/cli.js" "$STAGE/sidecar/dist/sdk/"
          cp "app/sidecar/dist/sdk/manifest.json" "$STAGE/sidecar/dist/sdk/"
          cp app/sidecar/dist/sdk/*.wasm "$STAGE/sidecar/dist/sdk/" 2>/dev/null || true
          if [ -d "app/sidecar/dist/sdk/vendor" ]; then
            cp -r "app/sidecar/dist/sdk/vendor" "$STAGE/sidecar/dist/sdk/"
          fi

          mkdir -p "$STAGE/agent-sources" "$STAGE/workspace"
          cp -r "agent-sources/plugins" "$STAGE/agent-sources/plugins"
          cp -r "agent-sources/skills" "$STAGE/agent-sources/skills"
          cp -r "agent-sources/workspace/." "$STAGE/workspace/"

          node scripts/verify-release-stage.mjs "$STAGE" windows
```

- [ ] **Step 2: Add macOS stage verification**

In the `Package macOS release` step, run the verifier before zipping:

```bash
          chmod +x "$STAGE/run.sh"
          node scripts/verify-release-stage.mjs "$STAGE" macos
          zip -r "${STAGE}.zip" "$STAGE"
```

- [ ] **Step 3: Run YAML and verifier checks**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import yaml
for path in Path(".github/workflows").glob("*.yml"):
    yaml.safe_load(path.read_text())
print("workflow yaml ok")
PY
node --test scripts/verify-release-stage.test.mjs
```

Expected: `workflow yaml ok` and the release verifier tests pass.

- [ ] **Step 4: Commit release workflow repair**

Run:

```bash
git add .github/workflows/release.yml
git commit -m "VU-1134: repair release resource packaging"
```

## Task 3: Help Docs Freshness Checker

**Files:**

- Create: `scripts/check-help-docs.mjs`
- Create: `scripts/check-help-docs.test.mjs`
- Modify: `docs/.vitepress/config.ts`

- [ ] **Step 1: Write the failing help checker tests**

Create `scripts/check-help-docs.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { helpLinkToMarkdownPath, findMissingHelpDocs } from "./check-help-docs.mjs";

test("helpLinkToMarkdownPath resolves root and nested guide links", () => {
  const root = "/repo/docs/user-guide";
  assert.equal(helpLinkToMarkdownPath(root, "/"), "/repo/docs/user-guide/index.md");
  assert.equal(
    helpLinkToMarkdownPath(root, "/workflow/step-1-research"),
    "/repo/docs/user-guide/workflow/step-1-research.md",
  );
});

test("findMissingHelpDocs reports missing sidebar and app help links", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-help-"));
  try {
    mkdirSync(join(root, "docs/user-guide/workflow"), { recursive: true });
    mkdirSync(join(root, "docs/.vitepress"), { recursive: true });
    mkdirSync(join(root, "app/src/lib"), { recursive: true });
    writeFileSync(join(root, "docs/user-guide/index.md"), "# Home\n");
    writeFileSync(join(root, "app/src/lib/help-urls.ts"), "const BASE = \"https://hbanerjee74.github.io/skill-builder\";\nexport const x = `${BASE}/workflow/missing`;\n");
    writeFileSync(join(root, "docs/.vitepress/config.ts"), "export default { themeConfig: { sidebar: [{ items: [{ text: 'Missing', link: '/missing' }] }] } };\n");

    const missing = findMissingHelpDocs(root);
    assert.ok(missing.includes("/workflow/missing -> docs/user-guide/workflow/missing.md"));
    assert.ok(missing.includes("/missing -> docs/user-guide/missing.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the help checker tests and confirm they fail**

Run:

```bash
node --test scripts/check-help-docs.test.mjs
```

Expected: FAIL with an import error because `scripts/check-help-docs.mjs` does not exist yet.

- [ ] **Step 3: Implement the help checker**

Create `scripts/check-help-docs.mjs`:

```javascript
#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://hbanerjee74.github.io/skill-builder";

export function helpLinkToMarkdownPath(docsRoot, link) {
  const clean = link.replace(BASE_URL, "").replace(/#.*$/, "") || "/";
  if (clean === "/") return resolve(docsRoot, "index.md");
  return resolve(docsRoot, `${clean.replace(/^\/+/, "")}.md`);
}

function collectLinksFromText(text) {
  const links = new Set();
  const patterns = [
    /https:\/\/hbanerjee74\.github\.io\/skill-builder(\/[^`"'\s)]*)?/g,
    /\$\{BASE\}(\/[^`"'\s)]*)/g,
    /link:\s*["'](\/[^"']*)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      if (value.startsWith("${")) continue;
      links.add(value.replace(/[`"',)]*$/, ""));
    }
  }

  return [...links];
}

export function findMissingHelpDocs(repoRoot = process.cwd()) {
  const docsRoot = resolve(repoRoot, "docs/user-guide");
  const sources = [
    "app/src/lib/help-urls.ts",
    "docs/.vitepress/config.ts",
  ];
  const missing = [];

  for (const source of sources) {
    const sourcePath = resolve(repoRoot, source);
    if (!existsSync(sourcePath)) continue;

    const links = collectLinksFromText(readFileSync(sourcePath, "utf8"));
    for (const link of links) {
      const markdownPath = helpLinkToMarkdownPath(docsRoot, link);
      if (!existsSync(markdownPath)) {
        missing.push(`${link.replace(BASE_URL, "") || "/"} -> ${relative(repoRoot, markdownPath)}`);
      }
    }
  }

  return [...new Set(missing)].sort();
}

function main() {
  const missing = findMissingHelpDocs(process.cwd());
  if (missing.length > 0) {
    console.error("Missing help documentation targets:");
    for (const item of missing) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  console.log("Help documentation links verified.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run the help checker tests and live checker**

Run:

```bash
node --test scripts/check-help-docs.test.mjs
node scripts/check-help-docs.mjs
```

Expected: tests pass and live checker prints `Help documentation links verified.`

- [ ] **Step 5: Commit help checker**

Run:

```bash
git add scripts/check-help-docs.mjs scripts/check-help-docs.test.mjs
git commit -m "VU-1134: add help docs freshness checker"
```

## Task 4: Docs Workflow and Help Page Refresh

**Files:**

- Modify: `.github/workflows/docs.yml`
- Modify: `.github/workflows/pr-policy.yml`
- Modify: `docs/user-guide/**/*.md`
- Test: `scripts/check-help-docs.mjs`

- [ ] **Step 1: Make docs deploy deterministic**

In `.github/workflows/docs.yml`, add `docs/package-lock.json` to the trigger and replace `npm install` with `npm ci`:

```yaml
    paths:
      - "docs/user-guide/**"
      - "docs/.vitepress/**"
      - "docs/package.json"
      - "docs/package-lock.json"
```

```yaml
      - name: Install dependencies
        run: npm ci
        working-directory: docs

      - name: Check help documentation links
        run: node scripts/check-help-docs.mjs
```

The checker step runs from the repository root, so do not set `working-directory` for that step.

- [ ] **Step 2: Path-filter docs policy build**

In `.github/workflows/pr-policy.yml`, update `docs-build` to detect docs changes before installing dependencies:

```yaml
      - name: Detect relevant changes
        id: changes
        uses: dorny/paths-filter@v4
        with:
          filters: |
            docs:
              - 'docs/user-guide/**'
              - 'docs/.vitepress/**'
              - 'docs/package.json'
              - 'docs/package-lock.json'
              - 'scripts/check-help-docs.mjs'
```

Add `if: steps.changes.outputs.docs == 'true'` to the Node setup, install, checker, and build steps. Add this skip step:

```yaml
      - name: Skip (no docs changes)
        if: steps.changes.outputs.docs != 'true'
        run: echo "No docs changes detected — skipping."
```

- [ ] **Step 3: Refresh stale user guide pages**

Read the current pages under `docs/user-guide/` and update any stale references to removed UI or old page names. Keep each page product-facing and concise. At minimum, confirm these pages match the current app navigation:

```bash
sed -n '1,220p' docs/user-guide/index.md
sed -n '1,220p' docs/user-guide/dashboard.md
sed -n '1,220p' docs/user-guide/refine.md
sed -n '1,220p' docs/user-guide/settings.md
sed -n '1,220p' docs/user-guide/test.md
sed -n '1,220p' docs/user-guide/usage.md
```

If edits are needed, make surgical markdown changes only. Do not add implementation details, internal file paths, or agent runtime architecture to the user guide.

- [ ] **Step 4: Run docs checks**

Run:

```bash
node scripts/check-help-docs.mjs
cd docs && npm ci && npm run build
cd .. && npx markdownlint-cli2 "docs/user-guide/**/*.md"
```

Expected: help links verified, VitePress build passes, and markdownlint reports `0 error(s)`.

- [ ] **Step 5: Commit docs workflow and guide updates**

Run:

```bash
git add .github/workflows/docs.yml .github/workflows/pr-policy.yml docs/user-guide scripts/check-help-docs.mjs scripts/check-help-docs.test.mjs
git commit -m "VU-1134: make help docs checks deterministic"
```

If Task 3 was already committed, omit `scripts/check-help-docs.mjs` and `scripts/check-help-docs.test.mjs` from this commit.

## Task 5: Cheap PR CI Restructure

**Files:**

- Modify: `.github/workflows/pr-ci.yml`
- Modify: `.github/workflows/pr-policy.yml`
- Test: workflow YAML parser

- [ ] **Step 1: Keep heavyweight platform CI off ordinary PRs**

In `.github/workflows/pr-ci.yml`, change the `pull_request` trigger to a manual/main-oriented workflow by removing the PR trigger or making each heavyweight job skip PR events. The preferred minimal change is to remove this block:

```yaml
  pull_request:
    branches:
      - main
    paths-ignore:
      - '**/*.md'
      - 'LICENSE'
```

Keep `workflow_dispatch` and `push` to `main`. This makes multi-platform cargo, clippy, full frontend tests, and integration tests available on demand and on main without making every PR pay for them.

- [ ] **Step 2: Expand repo-map audit coverage in PR policy**

In `.github/workflows/pr-policy.yml`, add structural areas introduced by this branch to `STRUCTURAL_DIRS`:

```bash
          STRUCTURAL_DIRS=(
            ".github/"
            "scripts/"
            "tests/evals/"
            "app/src-tauri/src/commands/"
            "app/src/stores/"
            "app/src/pages/"
            "app/src/components/"
            "app/src/lib/"
            "app/src/hooks/"
          )
```

This keeps the cheap PR policy job honest when workflow, script, or eval harness structure changes.

- [ ] **Step 3: Ensure policy jobs cover the new deterministic scripts**

In `.github/workflows/pr-policy.yml`, add a lightweight script-tests job:

```yaml
  script-tests:
    name: script-tests
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Detect relevant changes
        id: changes
        uses: dorny/paths-filter@v4
        with:
          filters: |
            scripts:
              - 'scripts/*.mjs'

      - name: Run script tests
        if: steps.changes.outputs.scripts == 'true'
        run: node --test scripts/*.test.mjs

      - name: Skip (no script changes)
        if: steps.changes.outputs.scripts != 'true'
        run: echo "No script changes detected — skipping."
```

- [ ] **Step 4: Run workflow syntax checks**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import yaml
for path in Path(".github/workflows").glob("*.yml"):
    yaml.safe_load(path.read_text())
print("workflow yaml ok")
PY
node --test scripts/*.test.mjs
```

Expected: YAML parses and script tests pass.

- [ ] **Step 5: Commit cheap CI restructure**

Run:

```bash
git add .github/workflows/pr-ci.yml .github/workflows/pr-policy.yml
git commit -m "VU-1134: keep PR CI cheap and targeted"
```

## Task 6: Final Verification and Push

**Files:**

- Verify: all changed files
- Modify only if required by verification: `AGENTS.md`, `repo-map.json`, `TEST_MANIFEST.md`

- [ ] **Step 1: Run all deterministic checks for this implementation**

Run:

```bash
node --test scripts/*.test.mjs
node scripts/check-help-docs.mjs
node scripts/verify-release-stage.mjs "$(mktemp -d)" windows || true
python3 - <<'PY'
from pathlib import Path
import yaml
for path in Path(".github/workflows").glob("*.yml"):
    yaml.safe_load(path.read_text())
print("workflow yaml ok")
PY
cd docs && npm ci && npm run build
cd .. && npx markdownlint-cli2 "docs/user-guide/**/*.md" "docs/superpowers/**/*.md"
```

Expected:

- `node --test scripts/*.test.mjs` passes.
- `node scripts/check-help-docs.mjs` prints `Help documentation links verified.`
- The intentionally empty release-stage command exits non-zero and prints missing required paths; this confirms the CLI failure path.
- YAML parser prints `workflow yaml ok`.
- Docs build succeeds.
- Markdownlint reports `0 error(s)`.

- [ ] **Step 2: Audit repo-map and manifest requirements**

Run:

```bash
git diff --name-status origin/main...HEAD
```

If files were added or removed under `app/src-tauri/src/commands/`, `app/src/stores/`, `app/src/pages/`, `app/src/components/`, `app/src/lib/`, `app/src/hooks/`, `.github/`, `scripts/`, or `tests/evals/`, update `repo-map.json` in the same branch before final push. If Rust command files or E2E specs changed, update `TEST_MANIFEST.md`.

- [ ] **Step 3: Review final diff**

Run:

```bash
git diff --stat origin/main...HEAD
git diff --check
```

Expected: diff is scoped to release/docs/CI planning and implementation, and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Commit any verification-driven doc metadata updates**

If Step 2 required metadata updates, run:

```bash
git add AGENTS.md repo-map.json TEST_MANIFEST.md
git commit -m "VU-1134: update repository metadata for CI checks"
```

If no metadata updates were needed, do not create an empty commit.

- [ ] **Step 5: Push the branch**

Run:

```bash
git status --short --branch
git push
```

Expected: branch pushes cleanly to `origin/feature/vu-1134-replace-agent-eval-harness-with-migration-utility-tiered`.
