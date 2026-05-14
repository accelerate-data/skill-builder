# Startup Reconciliation Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead code and stale types from the startup reconciliation flow after backend behavioral changes (gaps 7-10 from implementation-gaps.md).

**Architecture:** The backend (`reconcile_on_startup`) already returns empty `discovered_skills` and no longer performs disk discovery. This plan removes the dead frontend UI, shrinks the auto-apply logic, renames stale type fields, and adds targeted operation-time validation for missing skill content.

**Tech Stack:** Rust (Tauri backend), React + TypeScript (frontend), Vitest (tests)

---

## File Map

| File | Change |
|------|--------|
| `app/src-tauri/src/types/workflow.rs` | Remove `DiscoveredSkill` struct, remove `discovered_skills` field from `ReconciliationResult` |
| `app/src-tauri/src/reconciliation/mod.rs` | Remove `DiscoveredSkill` import, remove `discovered_skills` from return |
| `app/src/lib/types.ts` | Remove `DiscoveredSkill` interface, remove `discovered_skills` from `ReconciliationResult`, remove `DiscoveryResolutionAction` type |
| `app/src/lib/tauri.ts` | Remove `resolveDiscovery` export |
| `app/src/hooks/use-app-startup.ts` | Remove `reconDiscovered` state, remove discovery-related auto-apply branches, remove `DiscoveryResolutionAction` import |
| `app/src/components/reconciliation-ack-dialog.tsx` | Remove `discoveredSkills` prop and all discovery-related UI/logic |
| `app/src/components/layout/app-layout.tsx` | Remove `reconDiscovered` from destructured startup state, remove `discoveredSkills` prop from dialog |
| `app/src/__tests__/components/reconciliation-ack-dialog.test.tsx` | Remove discovery-related tests, keep notification-only tests |
| `app/src/__tests__/components/app-layout.test.tsx` | Remove `discovered_skills` from mock results |
| `app/src-tauri/src/reconciliation/tests.rs` | Remove `discovered_skills` assertions (already empty, just clean up) |
| `app/src-tauri/src/commands/refine/content.rs` | Add missing-content error when `SKILL.md` is absent |
| `app/src-tauri/src/commands/workflow/mod.rs` | Add missing-content validation where skill content is read |

---

### Task 1: Remove `DiscoveredSkill` from Rust types

**Files:**
- Modify: `app/src-tauri/src/types/workflow.rs:107-126`
- Modify: `app/src-tauri/src/reconciliation/mod.rs:4,401-406`
- Test: `app/src-tauri/src/reconciliation/tests.rs` (existing tests, verify compile)

- [ ] **Step 1: Remove `DiscoveredSkill` struct and `discovered_skills` field from Rust types**

In `app/src-tauri/src/types/workflow.rs`, remove lines 107-118 (the `DiscoveredSkill` struct) and line 125 (`discovered_skills` field):

```rust
// REMOVE these lines (107-118):
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSkill {
    pub name: String,
    #[serde(default)]
    pub plugin_slug: Option<String>,
    #[serde(default)]
    pub plugin_display_name: Option<String>,
    #[serde(default)]
    pub is_default_plugin: Option<bool>,
    pub detected_step: i32,
    pub scenario: String,
}

// CHANGE line 125 from:
    pub discovered_skills: Vec<DiscoveredSkill>,
// TO: (remove this field entirely)
```

The resulting `ReconciliationResult` should be:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationResult {
    pub orphans: Vec<OrphanSkill>,
    pub notifications: Vec<String>,
    pub auto_cleaned: u32,
}
```

- [ ] **Step 2: Remove `DiscoveredSkill` import and usage from reconciliation/mod.rs**

In `app/src-tauri/src/reconciliation/mod.rs`, change line 4 from:

```rust
use crate::types::{DiscoveredSkill, ReconciliationResult};
```

to:

```rust
use crate::types::ReconciliationResult;
```

And change the return at lines 401-406 from:

```rust
    Ok(ReconciliationResult {
        orphans: Vec::new(),
        notifications,
        auto_cleaned: 0,
        discovered_skills: Vec::<DiscoveredSkill>::new(),
    })
```

to:

```rust
    Ok(ReconciliationResult {
        orphans: Vec::new(),
        notifications,
        auto_cleaned: 0,
    })
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd app/src-tauri && cargo check`
Expected: No compilation errors.

- [ ] **Step 4: Clean up `discovered_skills` assertions in tests**

In `app/src-tauri/src/reconciliation/tests.rs`, remove all `assert!(result.discovered_skills.is_empty());` lines. These are now compile errors since the field is gone. Affected lines:
- Line 110: `assert!(result.discovered_skills.is_empty());`
- Line 145: `assert!(result.discovered_skills.is_empty());`
- Line 1005: `assert!(result.discovered_skills.is_empty());`
- Line 1028: `assert!(result.discovered_skills.is_empty());`
- Line 1055: `assert!(result.discovered_skills.is_empty()); // disk-only-skill...`
- Line 1237: `assert!(result.discovered_skills.is_empty());`

- [ ] **Step 5: Run Rust tests**

Run: `cd app/src-tauri && cargo test reconciliation::`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/types/workflow.rs app/src-tauri/src/reconciliation/mod.rs app/src-tauri/src/reconciliation/tests.rs
git commit -m "refactor: remove DiscoveredSkill from Rust types and reconciliation"
```

---

### Task 2: Remove `DiscoveredSkill` and discovery types from frontend

**Files:**
- Modify: `app/src/lib/types.ts:232-246,544`
- Modify: `app/src/lib/tauri.ts:237-238`

- [ ] **Step 1: Remove `DiscoveredSkill`, `discovered_skills`, and `DiscoveryResolutionAction` from types.ts**

In `app/src/lib/types.ts`, remove lines 232-239 (the `DiscoveredSkill` interface):

```typescript
// REMOVE these lines:
export interface DiscoveredSkill {
  name: string
  plugin_slug?: string | null
  plugin_display_name?: string | null
  is_default_plugin?: boolean | null
  detected_step: number
  scenario: string
}
```

Change the `ReconciliationResult` interface from:

```typescript
export interface ReconciliationResult {
  orphans: OrphanSkill[]
  notifications: string[]
  auto_cleaned: number
  discovered_skills: DiscoveredSkill[]
}
```

to:

```typescript
export interface ReconciliationResult {
  orphans: OrphanSkill[]
  notifications: string[]
  auto_cleaned: number
}
```

Remove line 544:

```typescript
// REMOVE this line:
export type DiscoveryResolutionAction = "add-skill-builder" | "add-imported" | "remove"
```

- [ ] **Step 2: Remove `resolveDiscovery` from tauri.ts**

In `app/src/lib/tauri.ts`, remove lines 237-238:

```typescript
// REMOVE these lines:
export const resolveDiscovery = (skillName: string, action: DiscoveryResolutionAction, pluginSlug?: string | null) =>
  invokeCommand("resolve_discovery", { skillName, action, pluginSlug: pluginSlug ?? null });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd app && npx tsc --noEmit`
Expected: No type errors (will fail until downstream consumers are updated — that's expected for now, proceed to next tasks).

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/types.ts app/src/lib/tauri.ts
git commit -m "refactor: remove DiscoveredSkill and DiscoveryResolutionAction from frontend types"
```

---

### Task 3: Simplify reconciliation dialog — remove discovery UI

**Files:**
- Modify: `app/src/components/reconciliation-ack-dialog.tsx` (full rewrite)
- Test: `app/src/__tests__/components/reconciliation-ack-dialog.test.tsx`

- [ ] **Step 1: Rewrite reconciliation-ack-dialog.tsx without discovery support**

Replace the entire file content with:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Info } from "lucide-react"

interface ReconciliationAckDialogProps {
  notifications: string[]
  open: boolean
  requireApply: boolean
  applying?: boolean
  onApply: () => void
  onCancel: () => void
}

export default function ReconciliationAckDialog({
  notifications,
  open,
  requireApply,
  applying = false,
  onApply,
  onCancel,
}: ReconciliationAckDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent size="lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Info className="size-5" style={{ color: "var(--color-pacific)" }} />
            Startup Reconciliation
          </AlertDialogTitle>
          <AlertDialogDescription>
            The following changes were made during startup.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[400px] overflow-auto">
          {notifications.length > 0 && (
            <ul className="flex flex-col gap-2 py-2">
              {notifications.map((notification, i) => (
                <li
                  key={i}
                  className="break-words rounded-md border px-3 py-2 text-sm text-foreground"
                >
                  {notification}
                </li>
              ))}
            </ul>
          )}
        </div>

        <AlertDialogFooter>
          {requireApply ? (
            <>
              <AlertDialogCancel onClick={onCancel}>
                Continue Without Applying
              </AlertDialogCancel>
              <AlertDialogAction onClick={onApply} disabled={applying}>
                {applying ? "Applying..." : "Apply Reconciliation"}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction onClick={onApply}>
              Acknowledge
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 2: Rewrite reconciliation-ack-dialog tests**

Replace the entire test file with:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReconciliationAckDialog from "@/components/reconciliation-ack-dialog";

describe("ReconciliationAckDialog", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("renders notifications", () => {
    render(
      <ReconciliationAckDialog
        notifications={["Database updated", "Workspace synced"]}
        open={true}
        requireApply={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Startup Reconciliation")).toBeInTheDocument();
    expect(screen.getByText("Database updated")).toBeInTheDocument();
    expect(screen.getByText("Workspace synced")).toBeInTheDocument();
  });

  it("calls onApply when acknowledge is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const onApply = vi.fn();

    render(
      <ReconciliationAckDialog
        notifications={["Notification 1"]}
        open={true}
        requireApply={false}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );

    const acknowledgeButton = screen.getByRole("button", { name: /Acknowledge/i });
    await user.click(acknowledgeButton);

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when apply is required and user continues without applying", async () => {
    const user = userEvent.setup({ delay: null });
    const onCancel = vi.fn();

    render(
      <ReconciliationAckDialog
        notifications={["Notification 1"]}
        open={true}
        requireApply={true}
        onApply={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Continue Without Applying/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables apply button when applying", () => {
    render(
      <ReconciliationAckDialog
        notifications={["Notification 1"]}
        open={true}
        requireApply={true}
        applying={true}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const applyButton = screen.getByRole("button", { name: /Applying.../i });
    expect(applyButton).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run frontend tests**

Run: `cd app && npm run test:unit -- --testPathPattern=reconciliation-ack-dialog`
Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/reconciliation-ack-dialog.tsx app/src/__tests__/components/reconciliation-ack-dialog.test.tsx
git commit -m "refactor: remove discovery UI from reconciliation dialog"
```

---

### Task 4: Simplify use-app-startup hook — remove discovery auto-apply

**Files:**
- Modify: `app/src/hooks/use-app-startup.ts`
- Modify: `app/src/components/layout/app-layout.tsx`

- [ ] **Step 1: Remove discovery-related state and auto-apply branches from use-app-startup.ts**

In `app/src/hooks/use-app-startup.ts`, make these changes:

Remove `DiscoveredSkill` from the import on line 7:

```typescript
// CHANGE line 7 from:
import type { AppSettings, DiscoveredSkill, ModelSettings, OrphanSkill } from "@/lib/types";
// TO:
import type { AppSettings, ModelSettings, OrphanSkill } from "@/lib/types";
```

Remove `reconDiscovered` from `StartupState` interface (line 17):

```typescript
// REMOVE this line:
  reconDiscovered: DiscoveredSkill[];
```

Remove from the return interface (line 27):

```typescript
// REMOVE this line:
  setReconDiscovered: (discovered: DiscoveredSkill[]) => void;
```

Remove the state declaration (line 70):

```typescript
// REMOVE this line:
  const [reconDiscovered, setReconDiscovered] = useState<DiscoveredSkill[]>([]);
```

Remove the entire auto-apply branch for discovered skills (lines 140-156):

```typescript
// REMOVE this entire block:
        if (result.notifications.length === 0 && result.discovered_skills.length > 0) {
          reconcileStartup(true)
            .then((applied) => {
              if (cancelledRef.current) return;
              queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }).catch((err) =>
                console.warn("[app-layout] op=refresh_skills_after_auto_recon status=failure err=%s", err),
              );
              if (applied.orphans.length > 0) {
                setOrphans(applied.orphans);
              }
              setReconciled(true);
            })
            .catch((err) => {
              console.warn("[app-layout] auto-apply reconciliation failed:", err);
              setReconciled(true);
            });
          return;
        }
```

Remove the discovered-skills preview branch (lines 158-168):

```typescript
// REMOVE this entire block:
        if (result.discovered_skills.length > 0) {
          console.warn(
            "[app-layout] Reconciliation preview produced %d notifications, %d discovered skills",
            result.notifications.length,
            result.discovered_skills.length,
          );
          setReconNotifications(result.notifications);
          setReconDiscovered(result.discovered_skills);
          setReconRequiresApply(true);
          setAckDone(false);
        }
```

Remove from the return object (lines 242, 249):

```typescript
// REMOVE these lines from the return:
    reconDiscovered,
    setReconDiscovered,
```

Remove `setReconDiscovered` from the `handleApplyReconciliation` function (line 216):

```typescript
// REMOVE this line:
      setReconDiscovered([]);
```

Remove `setReconDiscovered` from the `handleCancelReconciliation` function (line 233):

```typescript
// REMOVE this line:
    setReconDiscovered([]);
```

Update the `recordReconciliationCancel` call (line 229) to remove the discovered count:

```typescript
// CHANGE line 229 from:
    recordReconciliationCancel(reconNotifications.length, reconDiscovered.length)
// TO:
    recordReconciliationCancel(reconNotifications.length, 0)
```

- [ ] **Step 2: Remove `reconDiscovered` from app-layout.tsx**

In `app/src/components/layout/app-layout.tsx`, remove `reconDiscovered` from the destructured hook result (line 80):

```typescript
// CHANGE lines 75-87 from:
  const {
    settingsLoaded,
    reconciled,
    orphans,
    reconNotifications,
    reconDiscovered,
    ackDone,
    reconRequiresApply,
    reconApplying,
    setOrphans,
    handleApplyReconciliation,
    handleCancelReconciliation,
  } = useAppStartup();
// TO:
  const {
    settingsLoaded,
    reconciled,
    orphans,
    reconNotifications,
    ackDone,
    reconRequiresApply,
    reconApplying,
    setOrphans,
    handleApplyReconciliation,
    handleCancelReconciliation,
  } = useAppStartup();
```

Remove `discoveredSkills` prop from the dialog (line 441):

```typescript
// CHANGE the ReconciliationAckDialog usage from:
        <ReconciliationAckDialog
          notifications={reconNotifications}
          discoveredSkills={reconDiscovered}
          requireApply={reconRequiresApply}
          applying={reconApplying}
          open
          onApply={handleApplyReconciliation}
          onCancel={handleCancelReconciliation}
        />
// TO:
        <ReconciliationAckDialog
          notifications={reconNotifications}
          requireApply={reconRequiresApply}
          applying={reconApplying}
          open
          onApply={handleApplyReconciliation}
          onCancel={handleCancelReconciliation}
        />
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd app && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/use-app-startup.ts app/src/components/layout/app-layout.tsx
git commit -m "refactor: remove discovery auto-apply and state from startup hook"
```

---

### Task 5: Clean up app-layout tests

**Files:**
- Modify: `app/src/__tests__/components/app-layout.test.tsx`

- [ ] **Step 1: Remove `discovered_skills` from all mock reconciliation results**

In `app/src/__tests__/components/app-layout.test.tsx`, remove `discovered_skills: []` from all mock objects. This affects multiple lines. Use `replaceAll` to remove every occurrence of the pattern `,?\n\s*discovered_skills: \[\]` or `discovered_skills: \[\],?\n\s*`.

Specifically, find and remove these patterns from mock return objects:
- Line 171: `discovered_skills: [],`
- Line 253: `discovered_skills: [],`
- Line 261: `discovered_skills: [],`
- Line 283: `discovered_skills: [],`
- Line 291: `discovered_skills: [],`
- Line 315: `discovered_skills: []`
- Line 764: `discovered_skills: [],`
- Line 1240: `discovered_skills: [{ name: "partial-skill", detected_step: 2, scenario: "7a" }],`
- Line 1266: `discovered_skills: [],`
- Line 1293: `discovered_skills: [],`
- Line 1322: `discovered_skills: [],`

For line 1240, also remove the entire test case that tests discovered skills flow if it exists (the test that sets `discovered_skills` to a non-empty array). Search for the test that uses this mock and either remove it or update it to test notifications-only behavior.

- [ ] **Step 2: Run frontend tests**

Run: `cd app && npm run test:unit -- --testPathPattern=app-layout`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/__tests__/components/app-layout.test.tsx
git commit -m "test: remove discovered_skills from app-layout test mocks"
```

---

### Task 6: Remove workspace_path — stop creating `<data_dir>/workspace` directory

**Goal:** Eliminate the `workspace_path` concept entirely. OpenHands runs in `{skills_path}/{plugin}/skills/{name}/`, not in a separate workspace directory. Bundled skill seeding, eval cleanup, and workspace directory creation are all removed.

**Files:**
- Modify: `app/src-tauri/src/lib.rs:335-343`
- Modify: `app/src-tauri/src/commands/workspace.rs` (simplify `init_workspace`)
- Modify: `app/src-tauri/src/commands/reconciliation.rs` (remove workspace_path usage)
- Modify: `app/src-tauri/src/reconciliation/mod.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/reconciliation/skill_builder.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs` (use skills_path for {{skill_dir}})
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs` (remove eval cleanup)
- Modify: `app/src-tauri/src/commands/workflow_lifecycle.rs` (remove workspace_path validation)
- Modify: `app/src-tauri/src/commands/workflow/settings.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/commands/refine/*.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/commands/skill/*.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/commands/imported_skills/bundled.rs` (remove or keep for reference)
- Modify: `app/src-tauri/src/types/settings.rs` (remove workspace_path field)
- Modify: `app/src-tauri/src/db/settings.rs` (remove workspace_path from DB operations)
- Modify: `app/src-tauri/src/fs_validation.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/cleanup.rs` (remove workspace_path parameter)
- Modify: `app/src-tauri/src/logging.rs` (remove workspace_path from transcript pruning)
- Modify: `app/src-tauri/src/commands/api_validation.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/commands/files.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/commands/git.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/commands/github_import/commands.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/commands/imported_skills/lifecycle.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/commands/imported_skills/upload.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/agents/event_types.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/agents/run_persist.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/contracts/agent_events.rs` (remove workspace_path)
- Modify: `app/src-tauri/src/reconciliation/tests.rs` (update tests)
- Modify: `app/src-tauri/src/commands/workflow/tests.rs` (update tests)
- Modify: `app/src-tauri/src/commands/refine/tests.rs` (update tests)
- Modify: `app/src-tauri/src/commands/skill/tests.rs` (update tests)
- Modify: `app/src-tauri/src/db/tests.rs` (remove workspace_path from settings tests)

- [ ] **Step 1: Remove `init_workspace()` call from lib.rs**

In `app/src-tauri/src/lib.rs`, remove lines 335-343:

```rust
// REMOVE these lines:
            // Initialize workspace directory and deploy bundled prompts
            let db_state = app.state::<db::Db>();
            let handle = app.handle().clone();
            let workspace_path = commands::workspace::init_workspace(&handle, &db_state, &data_dir)
                .expect("failed to initialize workspace");

            // Prune old transcript files before any agents are spawned.
            // Non-fatal: errors are logged as warnings and startup continues.
            logging::prune_transcript_files(&workspace_path);
```

Also remove `get_workspace_path` from the invoke handler list (line 395):

```rust
// REMOVE this line:
            commands::workspace::get_workspace_path,
```

- [ ] **Step 2: Remove `workspace_path` from AppSettings and DB schema**

In `app/src-tauri/src/types/settings.rs`, remove `workspace_path` field from `AppSettings` struct (line 351):

```rust
// REMOVE this line:
    pub workspace_path: Option<String>,
```

And remove it from the Debug impl (line 401):

```rust
// REMOVE this line:
            .field("workspace_path", &self.workspace_path)
```

And from the default impl (line 429):

```rust
// REMOVE this line:
            workspace_path: None,
```

In `app/src-tauri/src/db/settings.rs`, remove `workspace_path` from the SELECT query (line 160), the row parsing (line 189), the INSERT/UPDATE (lines 227, 252, 274), and all test helpers.

- [ ] **Step 3: Remove bundled skill seeding and eval cleanup from reconciliation**

In `app/src-tauri/src/reconciliation/mod.rs`, remove the `clean_all_incomplete_iterations` call (line 304):

```rust
// REMOVE this line:
    crate::commands::workflow::evaluation::clean_all_incomplete_iterations(workspace_path);
```

Remove `workspace_path` parameter from `reconcile_on_startup` function signature and all internal usage.

- [ ] **Step 4: Update prompt templates to use skills_path for {{skill_dir}}**

In `app/src-tauri/src/commands/workflow/prompt.rs`, change all `build_step*_prompt` functions to use `skills_path` instead of `workspace_path` for resolving `{{skill_dir}}`:

```rust
// Change render_workspace_prompt to take skills_path instead of workspace_path:
fn render_skills_path_prompt(
    template: &str,
    skill_name: &str,
    skills_path: &str,
    plugin_slug: &str,
) -> String {
    let skill_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    let skill_dir_str = skill_dir.to_string_lossy().replace('\\', "/");
    template
        .trim_end_matches('\n')
        .replace("{{skill_name}}", skill_name)
        .replace("{{skill_dir}}", &skill_dir_str)
}
```

Update all callers to pass `skills_path` instead of `workspace_path`.

For `build_step3_prompt`, both `{{skill_dir}}` and `{{skill_output_dir}}` should resolve from `skills_path` (they're the same directory now).

For `build_evaluator_prompt`, same change — use `skills_path` for `{{skill_dir}}`.

- [ ] **Step 5: Remove workspace_path from workflow runtime and lifecycle**

In `app/src-tauri/src/commands/workflow/runtime.rs`, remove `workspace_path` parameter from:
- `run_workflow_step_inner` (line 333)
- `run_workflow_step` (line 559)
- `run_answer_evaluator` (line 706)

Update all internal calls to use `skills_path` from settings instead.

In `app/src-tauri/src/commands/workflow_lifecycle.rs`, remove `workspace_path` parameter from `validate_run_request` (line 63) and the existence check (lines 68-78).

- [ ] **Step 6: Remove workspace_path from remaining commands**

Systematically remove `workspace_path` parameter from:
- `commands/refine/content.rs` — `get_skill_content_for_refine`
- `commands/refine/mod.rs` — `send_refine_message`
- `commands/refine/output.rs` — `finalize_refine_run`, `clean_benchmark_snapshot`
- `commands/refine/protocol.rs` — refine protocol functions
- `commands/skill/crud.rs` — skill CRUD operations
- `commands/skill/metadata.rs` — metadata operations
- `commands/files.rs` — file operations
- `commands/git.rs` — git operations
- `commands/api_validation.rs` — model validation
- `commands/github_import/commands.rs` — GitHub import
- `commands/imported_skills/lifecycle.rs` — lifecycle operations
- `commands/imported_skills/upload.rs` — upload operations
- `commands/workflow/settings.rs` — workflow settings
- `commands/workflow/output_format.rs` — output format
- `commands/workflow/evaluation.rs` — evaluation (also remove `clean_all_incomplete_iterations`)
- `commands/workflow/deploy.rs` — deployment (remove workspace_path references)
- `agents/event_types.rs` — event types
- `agents/openhands_server/mod.rs` — OpenHands server
- `agents/run_persist.rs` — run persistence
- `contracts/agent_events.rs` — agent events
- `cleanup.rs` — cleanup functions
- `fs_validation.rs` — fs validation
- `logging.rs` — transcript pruning

- [ ] **Step 7: Remove bundled.rs file entirely**

Delete `app/src-tauri/src/commands/imported_skills/bundled.rs` and remove the re-export from `mod.rs`:

```rust
// REMOVE from mod.rs:
pub(crate) use bundled::{purge_stale_bundled_skills, seed_bundled_skills};
```

- [ ] **Step 8: Simplify workspace.rs**

In `app/src-tauri/src/commands/workspace.rs`:
- Remove `init_workspace()` function entirely
- Remove `get_workspace_path` command
- Remove `resolve_workspace_path` function
- Remove `cleanup_legacy_vibedata` function
- Remove `migrate_workspace_layout` function (or keep as standalone migration)
- Remove `migrate_flatten_openhands_dir` function
- Remove `migrate_delete_workspace_skill_dirs` function
- Remove `cleanup_stale_snapshots` function
- Keep `clear_workspace` command (still needed for clearing skills_path)
- Keep migration functions that are still needed (marketplace layout, per-skill repos)

- [ ] **Step 9: Update all tests**

Update tests in:
- `reconciliation/tests.rs` — remove workspace_path parameters
- `commands/workflow/tests.rs` — remove workspace_path parameters
- `commands/refine/tests.rs` — remove workspace_path parameters
- `commands/skill/tests.rs` — remove workspace_path parameters
- `db/tests.rs` — remove workspace_path from settings tests
- `types/mod.rs` — remove workspace_path from settings tests
- `db/settings.rs` tests — remove workspace_path tests

- [ ] **Step 10: Verify Rust compiles**

Run: `cd app/src-tauri && cargo check`
Expected: No compilation errors.

- [ ] **Step 11: Run Rust tests**

Run: `cd app/src-tauri && cargo test`
Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: remove workspace_path concept and <data_dir>/workspace directory"
```

---

### Task 7: Add operation-time validation for missing skill content (Gap 10)

**Files:**
- Modify: `app/src-tauri/src/commands/refine/content.rs:60-85`
- Modify: `app/src-tauri/src/commands/workflow/mod.rs` (wherever `read_skill_content_by_name` or `read_skill_content` is called)

- [ ] **Step 1: Add missing-content validation in refine content command**

In `app/src-tauri/src/commands/refine/content.rs`, find the function that calls `read_skill_content_by_name` (around line 68-80). Add validation before the read call:

```rust
// In the function that reads skill content for refine, add before read_skill_content_by_name:

let skill_dir = crate::skill_paths::resolve_existing_skill_dir(
    Path::new(skills_path),
    plugin_slug,
    skill_name,
);
if !skill_dir.join("SKILL.md").exists() && !skill_dir.join("references").is_dir() {
    return Err(format!(
        "Skill '{}' has no published content. The skill may have been moved or deleted. Run the skill workflow to regenerate it.",
        skill_name
    ));
}
```

The existing code at lines 68-80 already calls `read_skill_content_by_name` which will fail with a filesystem error if the directory doesn't exist, but we want a clearer error message. Check the actual function signature and add the guard at the appropriate location.

- [ ] **Step 2: Find all Rust commands that read skill content and add validation**

Search for all places where skill content is read for operations that require it:

```bash
cd app/src-tauri && rg "read_skill_content|read_skill_content_by_name|get_skill_content" --type rust -l
```

For each command that reads skill content for an operation (not for listing/display), add a guard that checks `SKILL.md` or `references/` exists and returns a clear error if missing.

Key operations to check:
- `get_skill_content_for_refine` — already handled in Step 1
- `get_skill_content_at_path` — may need guard
- `run_answer_evaluator` — needs guard (reads skill content for evaluation)
- `finalize_refine_run` — needs guard

For each, add a pattern like:

```rust
let skill_dir = crate::skill_paths::resolve_existing_skill_dir(
    Path::new(skills_path),
    plugin_slug,
    skill_name,
);
if !skill_dir.join("SKILL.md").exists() && !skill_dir.join("references").is_dir() {
    return Err(format!(
        "Skill '{}' has no published content. Run the skill workflow to generate it.",
        skill_name
    ));
}
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd app/src-tauri && cargo check`
Expected: No compilation errors.

- [ ] **Step 4: Run Rust tests**

Run: `cd app/src-tauri && cargo test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/
git commit -m "feat: add operation-time validation for missing skill content"
```

---

### Task 8: Final verification and cleanup

**Files:**
- All changed files

- [ ] **Step 1: Run full test suite**

Run: `cd app && npm run test:unit`
Run: `cd app/src-tauri && cargo test`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript type check**

Run: `cd app && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run Rust clippy**

Run: `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
Expected: No warnings.

- [ ] **Step 4: Verify no remaining references to removed types**

Run these searches to confirm clean removal:
```bash
cd app && rg "DiscoveredSkill|discovered_skills|DiscoveryResolutionAction|resolveDiscovery" --type ts --type tsx
cd app/src-tauri && rg "DiscoveredSkill|discovered_skills" --type rust
```
Expected: No results (except possibly in comments or docs).

- [ ] **Step 5: Commit final cleanup if needed**

```bash
git add -A
git commit -m "chore: clean up remaining references to removed discovery types"
```

---

## Self-Review

**1. Spec coverage check:**

| Gap | Task |
|-----|------|
| 7. UI still models discovered skills | Task 3 (dialog rewrite) |
| 8. Auto-applies discovery-driven reconciliation | Task 4 (startup hook cleanup) |
| 9. Terminology/result shapes still old | Tasks 1, 2 (Rust + frontend type removal) |
| 10. Operation-time validation coverage | Task 6 (add guards to content-reading commands) |

**2. Placeholder scan:** No TBD/TODO patterns found. All code blocks contain actual content.

**3. Type consistency:** `ReconciliationResult` struct is updated consistently in Rust (Task 1) and TypeScript (Task 2). The dialog props (Task 3) match the new interface. The startup hook return type (Task 4) matches what app-layout consumes.
