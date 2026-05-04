---
functional-specs: []
---

# OpenHands Workspace Management

> **Status:** Draft

## Overview

Skill Builder runs **one** OpenHands Agent Server process per app instance, shared across every UI surface (refine, workflow, eval, scope review). Two filesystem concerns the SDK exposes have been collapsed and conflated in earlier code paths and need to be made explicit:

1. **Where the SDK persists conversation state and per-event JSON** (server-level config, ONE root for ALL conversations).
2. **Where each conversation's agent runs `file_editor` and `terminal` tools, and where it discovers AgentSkills via `.agents/`** (per-conversation working directory, scoped to a single skill).

The OpenHands SDK does **not** expose `persistence_dir` as a per-request field — earlier attempts to thread it through `StartConversationRequest` were silently dropped by Pydantic, and the SDK fell back to its compiled-in default (`"workspace/conversations"` relative to whatever CWD the server happens to be running in — a tempdir in our case). Result: every per-run logs directory we created on disk was empty after the OpenHands runtime migration, and the audit trail lived only in memory until the app was restarted.

This design pins down:

- **Persistence path** → set via `OH_CONVERSATIONS_PATH` env var at server spawn time, pointing at a stable absolute path. ONE shared root, indexed by `conversation_id_hex`.
- **Agent working directory** → per-conversation `StartConversationRequest.workspace.working_dir` set to `<workspace>/<plugin>/<skill>` (already correct).
- **`.agents/` deployment** → two-tier SHA-gated cache. Source bytes drive a content hash; cache invalidates when the source changes; per-skill copies are SHA-gated against the workspace root copy. Live developer edits propagate without an app restart; production runs cache-hit and pay the cost of a SHA-256 pass over a small directory once per dispatch (~1–3 ms total).

## Design Scope

**Covers**

- Spawn-time configuration of the OpenHands Agent Server: `OH_CONVERSATIONS_PATH`, server CWD policy, env var hygiene
- On-disk shape of conversation persistence (the SDK's native per-event JSON tree)
- Two-tier SHA-gated deployment of `.agents/` files into the workspace and per-skill subdirectories
- Cache key shape and invalidation rules in `commands/workflow/deploy.rs::ensure_workspace_prompts`
- Removal of dead `persistence_dir` field on `OpenHandsOneShotRequest` and `StartConversationRequest` (Pydantic-dropped wire field)
- Test surface for the env-var setting and the two-tier SHA cache

**Does not cover**

- The agent's working-directory shape (already correct via `workspace_skill_dir`)
- AgentSkill registration in agent frontmatter (covered by `refine-openhands-migration`)
- The OpenHands event projection / DisplayItem rendering (covered by `openhands-event-display-projection`)
- Runtime workspace contracts beyond `.agents/` and `conversations/` (workspace/skill content is owned by other surfaces — workflow, refine, marketplace import)

## Key Decisions

| Decision | Rationale |
|---|---|
| `OH_CONVERSATIONS_PATH=<workspace>/conversations/` set as env var at Agent Server spawn | The SDK's `_StartConversationRequestBase` has no `persistence_dir` field — Pydantic silently drops the field on the wire (verified live: SDK echoed back its compiled default `'workspace/conversations/<conv_id>'` instead of any value we sent). The only supported override is the server-level `Config.conversations_path` field, set at process startup via the `OH_<FIELD_NAME>` env-var convention from the SDK's `from_env` parser. |
| Single root for **all** conversations across all skills | One Agent Server process serves every skill. The SDK indexes inside the root by `conversation_id_hex` automatically. Skill-Builder side already tracks the conversation_id per run (`RefineSession.conversation_id`, summary context), so correlation is a join key — no symlinks or copies needed. |
| Path matches the SDK's native default name (`conversations/`) | Aligns with the SDK convention. Lower cognitive overhead than a renamed `openhands-conversations/`. No risk of collision in the current workspace layout. |
| Agent working directory stays at `<workspace>/<plugin>/<skill>` per request | Correct already. The agent reads `.agents/skills/...` from this CWD when resolving AgentSkills referenced in its frontmatter (`creating-skills`, `researching-skill-requirements`, etc.). |
| Replace `ensure_workspace_prompts` boolean cache with a two-tier SHA-gated cache | The current `COPIED_WORKSPACES: HashSet<workspace_path>` cache marks workspace paths once per session and never invalidates on source-file changes. Developers editing `agent-sources/workspace/agents/skill-creator.md` mid-session get stale agents in the running app until restart. SHA hashing of the source dirs + per-skill dirs is cheap (~1–3 ms total per dispatch) and correct in both dev and prod. |
| Two tiers, both SHA-gated on every dispatch | Tier 1 (source → workspace root) catches dev edits. Tier 2 (workspace root → per-skill) catches drift between root and a specific skill copy (e.g., manual edits in a per-skill dir, or a newly opened skill that hasn't received the latest root yet). Both checks fire on every refine / workflow / eval / scope-review dispatch. Both are cheap; both are necessary. |
| Pydantic-dropped `persistence_dir` field on `StartConversationRequest` is reverted (not silently kept) | Dead code on the wire is misleading. The `OpenHandsOneShotRequest::persistence_dir` field added in commit `e8622297` is removed; so are the unit tests that asserted its serialization. The mechanism is `OH_CONVERSATIONS_PATH`, not a request body field. |

## Architecture

### Spawn-time configuration

`app/src-tauri/src/agents/openhands_server/process.rs::start_once` constructs the `tokio::process::Command` for the Agent Server and spawns it. After this design lands:

```rust
let conversations_path = compute_conversations_path(&workspace_root);
//   = <workspace_root>/conversations  (absolute path)

tokio_command
    .current_dir(runtime_dir.path())                     // tempdir, unchanged
    .env("SESSION_API_KEY",        &session_api_key)
    .env("OH_SESSION_API_KEYS_0",  &session_api_key)
    .env("OH_SECRET_KEY",          &session_api_key)
    .env("OH_CONVERSATIONS_PATH",  conversations_path);  // NEW
```

`compute_conversations_path` is a pure function on `&Path`. Tested in isolation.

The path is computed from the **workspace root** (e.g. `~/Library/Application Support/com.vibedata.skill-builder/workspace/`), which is consistent across all callers. The first dispatch primes the path for the lifetime of the server process — subsequent dispatches reuse the cached server.

### On-disk shape after this lands

```
<workspace_root>/                                           ← OS-specific app data dir
├── conversations/                                          ← OH_CONVERSATIONS_PATH
│   ├── <conversation_id_hex_1>/
│   │   ├── base_state.json
│   │   └── events/
│   │       ├── event-00000-<uuid>.json
│   │       ├── event-00001-<uuid>.json
│   │       └── ...
│   ├── <conversation_id_hex_2>/
│   │   └── ...
│   └── ...
├── .agents/                                                ← workspace-root tier
│   ├── agents/skill-creator.md
│   └── skills/
│       ├── creating-skills/
│       └── researching-skill-requirements/
├── <plugin>/                                               ← per-skill tier
│   └── <skill>/
│       ├── .agents/                                        ← copy of root .agents/
│       │   ├── agents/skill-creator.md
│       │   └── skills/...
│       ├── SKILL.md (managed by skill content, not this design)
│       ├── context/
│       ├── logs/
│       └── ...
└── ...
```

Conversations directory is global; `.agents/` exists at both tiers; the workflow/refine logs and skill content are unchanged.

### Two-tier SHA-gated `.agents/` deployment

Replaces the boolean cache in `commands/workflow/deploy.rs::ensure_workspace_prompts`.

```rust
struct WorkspaceDeployCache {
    /// SHA-256 of the source bytes — agent-sources/workspace/{agents,skills}/.
    /// Computed by walking the source dirs in deterministic order, hashing
    /// (path, separator, bytes) for each file. None until first call.
    source_sha: Option<String>,
    /// SHA-256 of <workspace>/.agents/ at the time of the last copy from
    /// workspace root → that per-skill dir. Keyed by absolute skill dir path.
    per_skill_sha: HashMap<String, String>,
}

static CACHE: Mutex<Option<HashMap<String /* workspace_path */, WorkspaceDeployCache>>>;
```

Each `ensure_workspace_prompts(workspace_path, skill_dir_for_dispatch)` call performs:

1. **Tier 1 — Source → workspace root**
   - Compute `current_source_sha` from the bundled / repo source dirs.
   - If `current_source_sha != cache.source_sha`:
     - Copy source → `<workspace>/.agents/`.
     - Update `cache.source_sha = Some(current_source_sha)`.
     - Clear `cache.per_skill_sha` (every skill is now stale relative to the new root).

2. **Tier 2 — Workspace root → per-skill**
   - Compute `current_root_sha` from `<workspace>/.agents/` (after tier 1).
   - For the dispatched skill's `<workspace>/<plugin>/<skill>/`:
     - If `current_root_sha != cache.per_skill_sha[skill_dir]`:
       - Copy `<workspace>/.agents/` → `<workspace>/<plugin>/<skill>/.agents/`.
       - Update `cache.per_skill_sha[skill_dir] = current_root_sha`.

Both tiers fire on every dispatch. SHA mismatches cascade — a tier-1 source change forces tier-2 redeployments lazily as each skill is touched.

### Hashing

Deterministic SHA-256 over the directory:

```rust
fn compute_dir_sha(roots: &[&Path]) -> Result<String, String> {
    let mut paths: Vec<PathBuf> = vec![];
    for root in roots {
        if !root.is_dir() { continue; }
        for entry in walkdir::WalkDir::new(root).sort_by_file_name() {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().is_file() {
                paths.push(entry.into_path());
            }
        }
    }
    paths.sort();
    let mut hasher = Sha256::new();
    for path in paths {
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        hasher.update(&bytes);
    }
    Ok(hex::encode(hasher.finalize()))
}
```

`sha2`, `walkdir`, and `hex` are already in the Cargo workspace's dependency graph. No new crates.

### Behavior matrix

| Scenario | Tier 1 (source → root) | Tier 2 (root → skill) |
|---|---|---|
| Cold start, first dispatch | ✅ deploys | ✅ deploys for that skill |
| Subsequent dispatch, same skill, no source change | skip (SHA match) | skip (per-skill SHA match) |
| Subsequent dispatch, different skill, no source change | skip | ✅ deploys for the new skill |
| Dev edits `agent-sources/workspace/agents/skill-creator.md`, then opens any skill | ✅ redeploys (source SHA changed) | ✅ redeploys for that skill (root SHA changed; per-skill cache cleared by tier 1) |
| User manually edited `<workspace>/<plugin>/<skill>/.agents/some-file.md` | skip (source unchanged) | ✅ overwrites manual edit (root vs skill SHA mismatch) — restores canonical state |
| Production app launch, bundled resources stable | ✅ first dispatch deploys | ✅ first per-skill dispatch deploys; subsequent skip |

## Implementation Contract

### Files touched

| File | Change |
|---|---|
| `app/src-tauri/src/agents/openhands_server/types.rs` | Revert: drop `OpenHandsOneShotRequest::persistence_dir` and `StartConversationRequest::persistence_dir` fields. Drop the two `start_conversation_request_*persistence_dir*` unit tests. The mechanism is `OH_CONVERSATIONS_PATH`, not a request body field — Pydantic silently dropped the field on the wire. |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Revert: drop the `config.persistence_dir = Some(persistence_path...)` lines added in `dispatch_openhands_one_shot` and `dispatch_openhands_refine_turn` in commit `e8622297`. The `mut config: SidecarConfig` parameter goes back to `config: SidecarConfig`. `create_openhands_persistence_dir` stays — its returned path can be retained as a logging hint, but is no longer functionally required. |
| `app/src-tauri/src/agents/openhands_server/process.rs` | Add `compute_conversations_path(workspace_root: &Path) -> PathBuf`. In `start_once`, call it and `.env("OH_CONVERSATIONS_PATH", ...)` on the spawn command. Workspace root is read from a Tauri-side helper that resolves the app data workspace path (`dirs::data_dir()` or equivalent), since `start_once` has no AppHandle. |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Replace `COPIED_WORKSPACES: HashSet<String>` with `Mutex<Option<HashMap<String /* workspace */, WorkspaceDeployCache>>>`. Update `ensure_workspace_prompts` and `ensure_workspace_prompts_sync` to invoke `compute_dir_sha` for tier 1 and tier 2 checks. Add `compute_dir_sha` helper. Function signatures stay the same; the fix is internal. |

### `compute_conversations_path` resolution

`process.rs::start_once` has no AppHandle. To compute the absolute conversations path the same way the rest of the app does, derive from `dirs::data_dir()`:

```rust
fn compute_conversations_path() -> Option<PathBuf> {
    dirs::data_dir().map(|root|
        root
          .join("com.vibedata.skill-builder")
          .join("workspace")
          .join("conversations")
    )
}
```

Returns `None` if `dirs::data_dir()` fails (it never does on macOS / Linux / Windows in normal app execution). On `None`, fall back to the SDK's compiled default — runs work but persistence lands in the tempdir and is lost on shutdown. Logged as a warning.

The bundle identifier `com.vibedata.skill-builder` is the same one Tauri uses (`tauri.conf.json` → `tauri.bundle.identifier`). Hardcoding it in one place is acceptable; see the existing `migrate_legacy_app_data_dir` in `lib.rs:71` which does the same.

### Tests

| Test | File | Asserts |
|---|---|---|
| `compute_conversations_path_resolves_under_data_dir` | `process.rs` | The returned path ends with `com.vibedata.skill-builder/workspace/conversations`. |
| `start_once_sets_conversations_path_env_var` | `process.rs` | The `tokio::process::Command` produced by the helper has `OH_CONVERSATIONS_PATH` in its env table at the expected absolute value. (Implementation: extract the env-setting into a small testable function on the command.) |
| `compute_dir_sha_is_stable_across_walks` | `deploy.rs` | Two invocations on the same source produce the same SHA, regardless of OS-dependent walk order. |
| `compute_dir_sha_changes_when_byte_changes` | `deploy.rs` | Modify one byte in any file → different SHA. |
| `compute_dir_sha_changes_when_file_added` | `deploy.rs` | Add a new file → different SHA. |
| `compute_dir_sha_changes_when_file_removed` | `deploy.rs` | Remove a file → different SHA. |
| `cache_hit_when_source_unchanged` | `deploy.rs` | Two consecutive `ensure_workspace_prompts` with same source → second is a no-op (no copy I/O). |
| `cache_invalidates_when_source_changes` | `deploy.rs` | Edit source mid-test → second call redeploys. |
| `tier_1_invalidation_clears_per_skill_cache` | `deploy.rs` | After source SHA changes, all per-skill SHAs are wiped → next per-skill dispatch redeploys. |
| `tier_2_invalidation_per_skill_only` | `deploy.rs` | Manual edit to one skill's `.agents/` → only that skill's tier-2 fires; other skills cache-hit. |
| `start_conversation_request_*persistence_dir*` (deletion) | `types.rs` | Old tests asserted a wire field that the SDK silently dropped. Delete them. |

### Migration notes

- Existing per-run logs dirs (`<workspace>/<plugin>/<skill>/logs/<run_id>/`) created by `create_openhands_persistence_dir` are kept as-is. They become organizational placeholders — useful for any future Skill Builder-side per-run artefacts (transcripts, diff snapshots, etc.). Empty for now.
- Existing OpenHands conversations from before this design landed are unrecoverable (they were either never written or written into now-deleted tempdirs). No backfill.
- After this design lands, the canonical audit trail for any past conversation is `<workspace>/conversations/<conversation_id_hex>/`. Cross-reference by the `conversation_id` stored in the run's persisted summary.

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/openhands-agent-server-runtime/README.md` | Defines the Rust-managed Agent Server lifecycle. This spec specifies the env-var and CWD policy at spawn time and the conversation persistence path. |
| `docs/design/openhands-event-display-projection/README.md` | Consumes the events the server writes. The "Known limitations" row in that spec referenced this gap; that row resolves once this design lands. |
| `docs/design/refine-openhands-migration/README.md` | Surfaced the gap during VU-1155 manual smoke. The refine path's `ensure_workspace_prompts` call in `send_refine_message` benefits from this two-tier SHA-gated cache. |
| `docs/design/openhands-native-migration/README.md` | Umbrella migration. This spec is one of the "clean break" details that supports it. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/process.rs` | Spawn-time env-var setting; `compute_conversations_path` |
| `app/src-tauri/src/agents/openhands_server/types.rs` | Cleanup of dead `persistence_dir` field |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Cleanup of dead `config.persistence_dir = ...` lines |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Two-tier SHA-gated `.agents/` deployment cache |
| `app/src-tauri/src/lib.rs:71` | Existing `migrate_legacy_app_data_dir` — reference for hardcoded bundle id pattern |
| `~/.cache/uv/.../openhands/agent_server/config.py` | SDK reference: `Config.conversations_path` field, `OH_` env-var prefix, `from_env` loader |
| `~/.cache/uv/.../openhands/sdk/conversation/request.py` | SDK reference: `_StartConversationRequestBase` confirms the absence of a `persistence_dir` request field |

## Open Questions

1. `[design]` Should the conversations path be configurable by the user (e.g. as a workspace setting), or always derived from the data dir? Initial proposal: always derived. Revisit if a user wants to point to network storage.
2. `[design]` Should `compute_dir_sha` walk symlinks? Initial proposal: do not follow symlinks (use `walkdir`'s default). The source dirs and workspace dirs are not expected to contain symlinks; following them would risk loops.
