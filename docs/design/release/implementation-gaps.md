# Release Packaging Implementation Gaps

This document compares the target release design in [README.md](/Users/hbanerjee/src/skill-builder/docs/design/release/README.md) with the current implementation.

The target model is:

- one user-facing desktop app
- an internal `runtime/` subtree for bundled bootstrap assets
- bundled `uv` used by the app, not by the user
- startup auto-installs missing OpenHands runtime packages
- startup does not require Node for installed-app use

---

## High-Priority Gaps

### 1. Release artifacts do not use a dedicated `runtime/` subtree yet

Current behavior:

- macOS packaging copies bundled `uv` directly to `Contents/Resources/uv`
- Windows packaging copies `uv.exe` directly to the top level of the staged ZIP

Current code:

- [.github/workflows/release.yml](/Users/hbanerjee/src/skill-builder/.github/workflows/release.yml:102)
- [.github/workflows/release.yml](/Users/hbanerjee/src/skill-builder/.github/workflows/release.yml:121)

Why this is a gap:

- the target design is “one app plus internal runtime folder,” not “multiple peer executables/files at the top level”

Required change:

- stage bundled runtime assets under `runtime/` on Windows
- stage bundled runtime assets under `Contents/Resources/runtime/` on macOS
- keep `skill-builder.exe` as the only top-level user-facing executable on Windows

### 2. Bundled `uv` lookup still expects the old resource layout

Current behavior:

- runtime startup looks for `uv` or `uv.exe` directly under `resource_dir`

Current code:

- [app/src-tauri/src/agents/openhands_server/process.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/agents/openhands_server/process.rs:34)

Why this is a gap:

- once release packaging moves to `runtime/uv`, startup must resolve the bundled binary from that subtree

Required change:

- update bundled-`uv` resolution to check `resource_dir/runtime/uv` and `resource_dir/runtime/uv.exe`
- keep dev fallback behavior explicit if the runtime subtree is absent in local builds

### 3. Startup dependency checks still block on Node

Current behavior:

- startup dependency validation includes Node as a required dependency
- the splash screen blocks startup when dependency checks fail

Current code:

- [app/src-tauri/src/commands/node.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/commands/node.rs:54)
- [app/src/components/layout/app-layout.tsx](/Users/hbanerjee/src/skill-builder/app/src/components/layout/app-layout.tsx:330)
- [app/src/components/splash-screen.tsx](/Users/hbanerjee/src/skill-builder/app/src/components/splash-screen.tsx:122)

Why this is a gap:

- the target release contract explicitly says installed users should not need Node

Required change:

- remove Node from installed-app startup blockers
- rename or re-scope the startup dependency command away from the old `node` framing
- update splash copy and runtime error messaging to stop directing users to install Node

### 4. OpenHands startup probing still assumes `uvx` or system Python

Current behavior:

- startup checks probe OpenHands availability with `uvx`, `python`, or `python3`
- remediation tells users to install `uv/uvx` or install OpenHands packages manually

Current code:

- [app/src-tauri/src/commands/node.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/commands/node.rs:161)
- [app/src-tauri/src/commands/node.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/commands/node.rs:228)

Why this is a gap:

- the target model is bundled `uv` plus automatic package install, not manual `uvx` setup

Required change:

- probe readiness using the same bundled-`uv` launch/bootstrap path used by the runtime
- replace manual-install remediation with bootstrap/install status
- distinguish “can auto-install” from “cannot bootstrap”

### 5. Release verification still asserts the old packaged shape

Current behavior:

- the release verification script validates current staged assets, not the target `runtime/` subtree model

Current code:

- [scripts/ci/verify-release-stage.mjs](/Users/hbanerjee/src/skill-builder/scripts/ci/verify-release-stage.mjs)
- [scripts/ci/verify-release-stage.test.mjs](/Users/hbanerjee/src/skill-builder/scripts/ci/verify-release-stage.test.mjs)

Why this is a gap:

- once packaging changes, verification must assert the new runtime-folder contract

Required change:

- update expected macOS paths to `Contents/Resources/runtime/...`
- update expected Windows paths to `runtime/...`
- keep checks focused on user-facing app plus internal runtime assets

---

## Medium-Priority Gaps

### 6. Bundled workspace assets are not consistently modeled as part of `runtime/`

Current behavior:

- the workflow copies workspace assets, but not under a dedicated internal runtime root
- release design now treats bundled workspace content as part of the runtime subtree

Current code:

- [.github/workflows/release.yml](/Users/hbanerjee/src/skill-builder/.github/workflows/release.yml:117)
- [app/src-tauri/tauri.conf.json](/Users/hbanerjee/src/skill-builder/app/src-tauri/tauri.conf.json)

Why this is a gap:

- the runtime subtree should group bundled bootstrap files and bundled workspace assets under one internal boundary

Required change:

- align packaged workspace resource locations with the new runtime subtree
- update any resource-path assumptions in Tauri config or runtime helpers

### 7. Startup/bootstrap status shape is still dependency-check oriented

Current behavior:

- the frontend shows a generic dependency checklist driven by `StartupDeps`
- failures are categorized as compatibility or missing dependency problems

Current code:

- [app/src-tauri/src/types/startup.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/types/startup.rs)
- [app/src/components/splash-screen.tsx](/Users/hbanerjee/src/skill-builder/app/src/components/splash-screen.tsx:102)

Why this is a gap:

- the target UX is closer to “runtime bootstrap in progress / ready / failed” than “please install missing dependencies”

Required change:

- redesign the startup result shape around bootstrap readiness
- support statuses like “bundled runtime found”, “installing OpenHands packages”, and “bootstrap failed”

### 8. Node-specific UI and error paths still exist outside startup checks

Current behavior:

- frontend runtime error handling still has Node-specific error types and links

Current code:

- [app/src/components/runtime-error-dialog.tsx](/Users/hbanerjee/src/skill-builder/app/src/components/runtime-error-dialog.tsx)
- [app/src/__tests__/components/runtime-error-dialog.test.tsx](/Users/hbanerjee/src/skill-builder/app/src/__tests__/components/runtime-error-dialog.test.tsx)

Why this is a gap:

- the installed-app release model should not surface Node installation as a normal remediation path

Required change:

- remove or retire Node-specific installed-app messaging
- replace it with bootstrap/runtime-specific remediation where appropriate

---

## Follow-On Gaps

### 9. Package pin consistency should be verified across bootstrap surfaces

Current behavior:

- OpenHands package pins are defined in runtime code and may differ from other repo references

Current code:

- [app/src-tauri/src/agents/openhands_server/process.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/agents/openhands_server/process.rs:15)
- [app/src-tauri/requirements.txt](/Users/hbanerjee/src/skill-builder/app/src-tauri/requirements.txt)

Why this is a gap:

- automatic startup install should have one clear source of truth for runtime package versions

Required change:

- choose one authoritative pin source or add a guard that keeps these definitions in sync

### 10. Release-pipeline docs and tests should be realigned together

Current behavior:

- design has moved ahead of packaging implementation

Why this is a gap:

- artifact shape, startup probing, and verification tests need to evolve together or the docs will drift again

Required change:

- land packaging, startup, and verification updates in one implementation slice
- update any related user-facing install or troubleshooting docs at the same time

---

## Parts Of The Current Implementation That Still Fit The Target Model

These pieces appear directionally correct and should likely remain:

- release pipeline already bundles `uv` instead of requiring a user-installed copy
- runtime launch already prefers a bundled `uv` path when present
- release verification exists and can be tightened rather than invented from scratch
- bundled workspace assets are already part of the staged release artifacts

The remaining work is mainly path layout, startup bootstrap behavior, and removal of stale Node-era assumptions.
