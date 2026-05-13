# Release Packaging & Runtime Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the current implementation with the target release design in [docs/design/release/README.md](/Users/hbanerjee/src/skill-builder/docs/design/release/README.md). Close all remaining gaps from [docs/design/release/implementation-gaps.md](/Users/hbanerjee/src/skill-builder/docs/design/release/implementation-gaps.md) except Gap 3 (already done).

**Architecture:** The target model is: one user-facing desktop app, an internal `runtime/` subtree for bundled bootstrap assets (uv + workspace), bundled `uv` used by the app (not the user), startup auto-installs missing OpenHands runtime packages, and no Node requirement for installed-app use.

**Tech Stack:** Rust (Tauri backend), React (frontend), GitHub Actions CI, Node.js test scripts

---

## Task 1: Introduce `runtime/` Subtree in Release Packaging

**Gaps addressed:** 1, 6

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `scripts/ci/verify-release-stage.mjs`
- Modify: `scripts/ci/verify-release-stage.test.mjs`

- [ ] **Step 1: Update macOS packaging to stage under `Contents/Resources/runtime/`**

In `.github/workflows/release.yml`, change the macOS packaging step so bundled `uv` and workspace assets land under the runtime subtree inside the app bundle:

```bash
# Bundled uv → Contents/Resources/runtime/uv
cp "$UV_BIN" "$STAGE/Skill Builder.app/Contents/Resources/runtime/uv"
chmod +x "$STAGE/Skill Builder.app/Contents/Resources/runtime/uv"

# Workspace assets → Contents/Resources/runtime/workspace/
mkdir -p "$STAGE/Skill Builder.app/Contents/Resources/runtime/workspace"
cp -r "agent-sources/workspace/." "$STAGE/Skill Builder.app/Contents/Resources/runtime/workspace/"
```

Remove the old direct copy to `Contents/Resources/uv`.

- [ ] **Step 2: Update Windows packaging to stage under `runtime/`**

In `.github/workflows/release.yml`, change the Windows packaging step:

```bash
# Bundled uv → runtime/uv.exe
mkdir -p "$STAGE/runtime"
cp "$UV_BIN" "$STAGE/runtime/uv.exe"

# Workspace assets → runtime/workspace/
mkdir -p "$STAGE/runtime/workspace"
cp -r "agent-sources/workspace/." "$STAGE/runtime/workspace/"
```

Remove the old direct copy of `uv.exe` to `$STAGE/uv.exe`. Keep `skill-builder.exe` as the only top-level user-facing executable.

- [ ] **Step 3: Update Tauri config to bundle workspace under `runtime/workspace/`**

In `app/src-tauri/tauri.conf.json`, change the `resources` mapping so workspace assets are bundled under `runtime/workspace/` instead of `workspace/`:

```json
"resources": {
  "../../agent-sources/workspace/": "runtime/workspace"
}
```

- [ ] **Step 4: Update release verification script to assert new paths**

In `scripts/ci/verify-release-stage.mjs`, update `REQUIRED_BY_PLATFORM`:

```js
const REQUIRED_BY_PLATFORM = {
  windows: [
    "skill-builder.exe",
    "runtime/uv.exe",
    "runtime/workspace/CLAUDE.md",
  ],
  macos: [
    "Skill Builder.app",
    "run.sh",
    "Skill Builder.app/Contents/Resources/runtime/uv",
    "Skill Builder.app/Contents/Resources/runtime/workspace/CLAUDE.md",
  ],
};
```

Remove references to `agent-sources/plugins/` and `agent-sources/skills/` — those are legacy paths not part of the installed-app contract.

- [ ] **Step 5: Update release verification tests**

In `scripts/ci/verify-release-stage.test.mjs`, update `WINDOWS_REQUIRED_PATHS` and `MACOS_REQUIRED_PATHS` to match the new paths from Step 4. Update the CLI test assertions accordingly.

- [ ] **Step 6: Run verification tests**

```bash
cd scripts/ci && node --test verify-release-stage.test.mjs
```

Expected: PASS with new `runtime/` subtree paths.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml scripts/ci/verify-release-stage.mjs scripts/ci/verify-release-stage.test.mjs app/src-tauri/tauri.conf.json
git commit -m "feat: package runtime assets under runtime/ subtree"
```

---

## Task 2: Update Bundled `uv` Resolution to Use `runtime/` Path

**Gaps addressed:** 2

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

- [ ] **Step 1: Update `init_bundled_uv_path` to check `runtime/` subtree**

In `process.rs`, update `init_bundled_uv_path` to look for `uv` under `resource_dir/runtime/` instead of directly in `resource_dir`:

```rust
pub fn init_bundled_uv_path(resource_dir: &Path) {
    let uv_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    // Check runtime/ subtree first
    let candidate = resource_dir.join("runtime").join(uv_name);
    if candidate.is_file() {
        log::debug!(
            "[openhands-agent-server] using bundled uv at {}",
            candidate.display()
        );
        let _ = BUNDLED_UV_PATH.set(Some(candidate));
        return;
    }
    // Dev fallback: check resource_dir directly for local builds
    let dev_candidate = resource_dir.join(uv_name);
    if dev_candidate.is_file() {
        log::debug!(
            "[openhands-agent-server] using bundled uv (dev fallback) at {}",
            dev_candidate.display()
        );
        let _ = BUNDLED_UV_PATH.set(Some(dev_candidate));
        return;
    }
    log::debug!(
        "[openhands-agent-server] no bundled uv found; falling back to system uvx"
    );
    let _ = BUNDLED_UV_PATH.set(None);
}
```

- [ ] **Step 2: Run Rust tests**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server::process --quiet
```

Expected: PASS — the existing test `agent_server_command_uses_python_module_host_and_selected_port` asserts `uvx` as the program when no bundled uv is initialized, which remains correct.

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/process.rs
git commit -m "feat: resolve bundled uv from runtime/ subtree"
```

---

## Task 3: Update Startup Probing to Use Bundled `uv`

**Gaps addressed:** 4

**Files:**

- Modify: `app/src-tauri/src/commands/node.rs`

- [ ] **Step 1: Pass resource_dir to the startup check or use a shared bundled-uv resolver**

The startup check in `node.rs` needs to probe OpenHands availability using the same bundled-`uv` path that the runtime uses. Add a helper that mirrors `python_module_command_parts()` logic from `process.rs`, or expose a shared function from the `openhands_server` module that returns the command parts for probing.

Add to `app/src-tauri/src/agents/openhands_server/process.rs`:

```rust
/// Return the program + args that would be used to run a Python module
/// via the bundled uv (or system uvx fallback). Used by both runtime
/// launch and startup probing.
pub fn bundled_uv_tool_run_args() -> (String, Vec<String>) {
    python_module_command_parts()
}
```

- [ ] **Step 2: Update `check_openhands_agent_server_available` to use bundled uv**

In `node.rs`, replace `check_python_import` (which probes `uvx`, `py`, `python`, `python3`) with a single probe that uses the bundled-uv path:

```rust
async fn check_openhands_agent_server_available() -> DepStatus {
    let (program, args) = crate::agents::openhands_server::process::bundled_uv_tool_run_args();
    let mut command = tokio::process::Command::new(&program);
    command.args(&args).arg("-c").arg("import openhands.agent_server; print(openhands.agent_server.__file__)");

    match command.output().await {
        Ok(out) if out.status.success() => dep_ok(
            "openhands_agent_server",
            "OpenHands Agent Server",
            String::from_utf8_lossy(&out.stdout).trim().to_string(),
        ),
        Ok(out) => dep_fail(
            "openhands_agent_server",
            "missing_dependency",
            "OpenHands Agent Server",
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
            "The app will attempt to install the required runtime packages automatically on first use.",
        ),
        Err(e) => dep_fail(
            "openhands_agent_server",
            "missing_dependency",
            "OpenHands Agent Server",
            e.to_string(),
            "The app will attempt to install the required runtime packages automatically on first use.",
        ),
    }
}
```

- [ ] **Step 3: Remove `python_import_command_candidates` and `check_python_import`**

These are no longer needed since probing uses the single bundled-uv path. Delete both functions and their tests.

- [ ] **Step 4: Remove the `parse_meets_minimum` function and its Node-version tests**

This was only used for Node version checking, which is already removed. Clean up the dead code.

- [ ] **Step 5: Run Rust tests**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::node --quiet
```

Expected: PASS — the old Node version tests are gone; the OpenHands probe test should verify it uses the bundled-uv command.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/node.rs app/src-tauri/src/agents/openhands_server/process.rs
git commit -m "feat: probe OpenHands availability via bundled uv at startup"
```

---

## Task 4: Redesign Startup Bootstrap Status Shape

**Gaps addressed:** 7

**Files:**

- Modify: `app/src-tauri/src/types/startup.rs`
- Modify: `app/src-tauri/src/commands/node.rs`
- Modify: `app/src/components/splash-screen.tsx`
- Modify: `app/src/hooks/use-node-validation.ts`
- Modify: `app/src/lib/types.ts` (or wherever `DepStatus` / `StartupDeps` TypeScript types live)

- [ ] **Step 1: Redesign the Rust startup result shape**

Replace `DepStatus` / `StartupDeps` with a bootstrap-oriented shape in `startup.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BootstrapStatus {
    Ready,
    Installing { detail: String },
    Failed { detail: String, remediation: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupResult {
    pub status: BootstrapStatus,
    pub checks: Vec<BootstrapCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapCheck {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}
```

- [ ] **Step 2: Update `check_startup_deps` to return the new shape**

In `node.rs`, update the command to return `StartupResult` instead of `StartupDeps`. The checks should report on:

- Bundled runtime found (uv present)
- Git available
- OpenHands Agent Server available (or installable)

- [ ] **Step 3: Update TypeScript types**

In `app/src/lib/types.ts`, update the `DepStatus` and `StartupDeps` types to match the new Rust shape. Rename to `BootstrapCheck` and `StartupResult` for clarity.

- [ ] **Step 4: Update splash screen to show bootstrap-oriented UI**

In `splash-screen.tsx`, replace the generic dependency checklist with bootstrap-oriented messaging:

- Show "Checking runtime..." during checks
- Show individual check results with simple pass/fail
- Replace "Startup blocked by dependency checks" with "Startup blocked — runtime not ready"
- Remove `failureKind`-based categorization (compatibility/transient/missing_dependency)

- [ ] **Step 5: Update the validation hook**

In `use-node-validation.ts`, update the type references from `StartupDeps` to `StartupResult`. Rename the hook from `useStartupValidation` to `useStartupBootstrap` or keep the name but update internal types.

- [ ] **Step 6: Run frontend tests**

```bash
cd app && npm run test:unit -- --grep "splash"
```

Expected: PASS with updated type references.

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/types/startup.rs app/src-tauri/src/commands/node.rs app/src/components/splash-screen.tsx app/src/hooks/use-node-validation.ts app/src/lib/types.ts
git commit -m "feat: redesign startup status around bootstrap readiness"
```

---

## Task 5: Remove Node-Specific UI and Error Paths

**Gaps addressed:** 8

**Files:**

- Modify: `app/src/components/runtime-error-dialog.tsx`
- Modify: `app/src/__tests__/components/runtime-error-dialog.test.tsx`

- [ ] **Step 1: Remove Node-specific error types from the dialog**

In `runtime-error-dialog.tsx`:

- Remove `node_missing` and `node_incompatible` cases from `getErrorTitle()`
- Remove `node_missing` and `node_incompatible` cases from `getErrorIcon()`
- Remove `showNodeLink()` function entirely (no more nodejs.org link)
- Remove Node-specific branch from `getFailureClass()`

- [ ] **Step 2: Update tests**

In `runtime-error-dialog.test.tsx`, remove any tests that assert on `node_missing` or `node_incompatible` error types, the nodejs.org link, or Node-specific icons.

- [ ] **Step 3: Run frontend tests**

```bash
cd app && npm run test:unit -- --grep "runtime-error-dialog"
```

Expected: PASS with Node-specific cases removed.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/runtime-error-dialog.tsx app/src/__tests__/components/runtime-error-dialog.test.tsx
git commit -m "feat: remove Node-specific error paths from runtime dialog"
```

---

## Task 6: Fix Package Pin Consistency

**Gaps addressed:** 9

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`
- Modify: `app/src-tauri/requirements.txt`

- [ ] **Step 1: Align version pins**

The current drift:

- `process.rs` pins `openhands-agent-server==1.21.0` and `openhands-tools==1.21.0`
- `requirements.txt` pins `openhands-agent-server==1.21.1` and `openhands-tools==1.21.1`

Choose one authoritative source. Since `process.rs` is the runtime truth (used by both startup probing and runtime launch), update `requirements.txt` to match:

```txt
openhands-agent-server==1.21.0
openhands-tools==1.21.0
```

- [ ] **Step 2: Add a comment documenting the sync requirement**

In `requirements.txt`, update the header comment to make the sync rule explicit:

```txt
# Python packages used by the OpenHands agent server.
# IMPORTANT: versions MUST match process.rs constants:
#   OPENHANDS_AGENT_SERVER_PACKAGE
#   OPENHANDS_TOOLS_PACKAGE
# This file exists solely for Dependabot pip tracking.
```

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/requirements.txt
git commit -m "fix: align package pins between requirements.txt and process.rs"
```

---

## Task 7: Update Implementation Gaps Document

**Gaps addressed:** 10

**Files:**

- Modify: `docs/design/release/implementation-gaps.md`

- [ ] **Step 1: Mark all gaps as resolved**

Update `implementation-gaps.md` to reflect that all gaps have been addressed. Either:

- Add a "Resolved" annotation to each gap, or
- Move all gaps to a "Resolved Gaps" section at the bottom, or
- Replace the document with a short summary noting that all gaps are closed and point to the design doc as the current source of truth

- [ ] **Step 2: Commit**

```bash
git add docs/design/release/implementation-gaps.md
git commit -m "docs: mark all release packaging gaps as resolved"
```

---

## Validation Summary

After all tasks, run:

```bash
# Rust tests
cargo test --manifest-path app/src-tauri/Cargo.toml --quiet

# Frontend tests
cd app && npm run test:unit

# Agent structural tests
cd app && npm run test:agents:structural

# Release verification tests
cd scripts/ci && node --test verify-release-stage.test.mjs

# TypeScript check
cd app && npx tsc --noEmit
```

All should pass. The release artifact shape, startup bootstrap, and error messaging should now match the target design in `docs/design/release/README.md`.
