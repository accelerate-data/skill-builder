# Release Pipeline

Defines the target release and installed-app contract for Skill Builder.

This document covers what the packaged app must contain, what may be downloaded on first launch, and what startup must verify before the app is usable. It is the design source for release packaging and runtime bootstrap behavior.

---

## Goal

A user should be able to install Skill Builder and use it without separately installing Node, `uv`, Python packages, or OpenHands Agent Server by hand.

The target release model is:

1. Ship the desktop app binary.
2. Ship the bundled `uv` executable used to bootstrap the OpenHands runtime.
3. Ship the bundled workspace and agent assets needed by the app itself.
4. On startup, verify whether OpenHands runtime packages are already available.
5. If they are missing, download/install them automatically using bundled `uv`.
6. Block startup only when the app truly cannot bootstrap itself or when a required external dependency is still genuinely required.

Node is not part of the installed-app contract.

---

## Installed-App Contract

Every packaged release must include:

- the desktop app binary
- an internal runtime folder containing the bundled `uv` executable
- bundled workspace assets under that internal runtime folder or app resources
- any app-owned prompts, agents, or skill assets needed for built-in flows

Every packaged release must not require:

- a system-installed Node runtime
- a user-installed `uv` or `uvx`
- a preinstalled OpenHands Agent Server Python package

The app may still depend on other true external prerequisites such as Git if those are still required by runtime behavior.

---

## Runtime Bootstrap Model

The OpenHands runtime is bootstrapped at app startup or first runtime use.

The runtime should be packaged as an internal app-owned subtree rather than as peer user-facing files beside the main executable.

Target shape:

```text
SkillBuilder/
  skill-builder.exe
  runtime/
    uv.exe
    workspace/...
```

On macOS, the equivalent runtime subtree should live inside app resources, for example:

```text
Skill Builder.app/Contents/Resources/runtime/...
```

### Bootstrapped by the installer bundle

These should ship with the app:

- `runtime/uv` or `runtime/uv.exe`
- bundled workspace content under the runtime subtree
- any app-owned OpenHands-side agent/skill assets needed to run built-in agent flows

### Bootstrapped by startup download

These may be downloaded automatically if absent:

- `openhands-agent-server`
- `openhands-tools`
- any explicitly pinned transitive runtime packages required by the chosen startup command

The app should install these using the bundled `uv`, not by telling the user to install them manually.

---

## Startup Check Contract

Startup checks should reflect the runtime bootstrap model rather than an older sidecar model.

### Startup must verify

- bundled runtime bootstrap files are present in the runtime subtree
- app-owned workspace assets are present in that runtime subtree
- OpenHands runtime packages are already available or can be installed automatically
- any truly external dependencies that still remain part of the runtime contract

### Startup must do when OpenHands packages are missing

- attempt automatic installation using bundled `uv`
- surface progress and failure clearly in the startup UI
- continue only after the runtime is ready, or fail with a bootstrap-specific error

### Startup must not do

- require Node as a blocker for installed-app startup
- instruct the user to install `uv` or OpenHands Agent Server manually for the normal packaged-app flow

---

## Node Dependency Policy

The old release/startup model assumed a Node sidecar or a startup Node dependency check.

That is no longer the target design.

Target policy:

- packaged releases do not bundle Node
- packaged releases do not require system Node
- startup checks do not block on Node
- runtime error messaging should not direct installed users to `nodejs.org`

If Node remains in the codebase, it is transitional debt and should be removed or scoped to development-only flows.

---

## Release Artifact Shape

### macOS

The macOS ZIP should contain:

- `Skill Builder.app`
- `run.sh` if the release flow still uses it for quarantine stripping or launch ergonomics
- a runtime subtree inside app resources
- bundled `uv` inside that runtime subtree
- bundled workspace assets inside that runtime subtree

### Windows

The Windows ZIP should contain:

- `skill-builder.exe`
- a `runtime/` folder
- bundled `runtime/uv.exe`
- bundled workspace assets in `runtime/`

The release verification step should assert the actual packaged assets for the OpenHands-native runtime path, not legacy Node-sidecar paths.

---

## Bundled Workspace Content

The bundled workspace content is part of the installed-app contract because built-in flows depend on it.

The release design assumes:

- the app ships the canonical `agent-sources/workspace` tree
- built-in agents and skill assets referenced by the OpenHands runtime are available from that shipped workspace content
- startup may validate presence of critical app-owned assets, but missing skill content should be treated as a packaging defect, not as library reconciliation

If additional app-owned OpenHands SDK or agent-server support files become necessary for offline bootstrap, they must be added to the release bundle and reflected in the release verification script.

---

## Release Verification

The release pipeline must verify the staged artifact contents before upload.

Verification should assert:

- desktop binary present
- bundled `uv` present
- bundled workspace assets present
- no legacy packaging assumptions such as Node sidecars or obsolete `agent-sources/plugins` paths

Verification should fail the release job if the packaged artifact would not satisfy the installed-app contract.

---

## Relationship To Startup Reconciliation

[docs/design/startup-recon/README.md](/Users/hbanerjee/src/skill-builder/docs/design/startup-recon/README.md) defines what startup is allowed to repair.

This document defines what startup must be able to bootstrap.

The boundary is:

- release design decides what ships and what can be downloaded automatically
- startup reconciliation decides what app-owned startup state can be normalized or cleaned
- missing runtime packages are a bootstrap concern
- missing tracked skill files are not a release bootstrap concern and should fail at operation time

---

## Current Known Drift To Eliminate

The current codebase still contains drift from the old model, including:

- release documentation that still refers to bundled Node
- startup dependency checks that still block on Node
- startup dependency checks that still probe OpenHands availability via `uvx` or system Python assumptions instead of the bundled-`uv` bootstrap path

Those are implementation gaps against this design, not part of the intended release contract.
