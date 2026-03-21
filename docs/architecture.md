# Skill Builder — Architecture Deep Dive

> A guided tour of the frontend, backend, and sidecar, written to help you build a mental model
> of every component, module, and state flag.

---

## The Analogy: A Recording Studio

Think of Skill Builder as a **recording studio**:

- The **Frontend (React)** is the **mixing board and control room** — the engineer sees meters, presses buttons, queues tracks, and monitors what's happening.
- The **Rust Backend (Tauri)** is the **studio infrastructure** — locks on studio rooms, the tape vault (SQLite), the intercom (IPC), and the building security system.
- The **Node.js Sidecar** is the **session musician** sitting in the live room — it actually plays (runs Claude agents), communicates with the control room over a dedicated intercom (JSONL over stdin/stdout), and can be swapped out or put on standby between sessions.

The engineer (frontend) never picks up a guitar. The musician (sidecar) never touches the mixing board. The infrastructure (Rust) makes sure only one engineer can be in a room at a time and that the session logs are stored safely.

---

## System Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        TAURI DESKTOP APP                                 │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    FRONTEND (React 19 + Vite)                    │    │
│  │                                                                   │    │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │    │
│  │  │   AppLayout  │  │  WorkflowPage    │  │  WorkspaceShell  │  │    │
│  │  │  (root shell)│  │  (step machine)  │  │  (completed skill│  │    │
│  │  │              │  │                  │  │   overview+refine│  │    │
│  │  │ ┌──────────┐ │  │ ┌──────────────┐│  └──────────────────┘  │    │
│  │  │ │IconRail  │ │  │ │4 hooks:      ││                          │    │
│  │  │ └──────────┘ │  │ │ Persistence  ││  ┌──────────────────┐  │    │
│  │  │ ┌──────────┐ │  │ │ Autosave     ││  │  SettingsPage    │  │    │
│  │  │ │SkillList │ │  │ │ Session      ││  └──────────────────┘  │    │
│  │  │ │ Panel    │ │  │ │ StateMachine ││                          │    │
│  │  │ └──────────┘ │  │ └──────────────┘│                          │    │
│  │  └──────────────┘  └──────────────────┘                          │    │
│  │                                                                   │    │
│  │  Zustand Stores: workflow · agent · skill · refine · settings    │    │
│  │                  imported-skills · usage                          │    │
│  └──────────────────────────────┬────────────────────────────────────┘    │
│                                 │ Tauri IPC (invoke/emit)                  │
│  ┌──────────────────────────────▼────────────────────────────────────┐    │
│  │                 RUST BACKEND (Tauri v2)                            │    │
│  │                                                                    │    │
│  │  commands/        agents/              db/          reconciliation/│    │
│  │  ├─ workflow/     ├─ sidecar_pool.rs   ├─ db.rs     └─ startup    │    │
│  │  ├─ skill/        ├─ events.rs         ├─ locks.rs    state machine│    │
│  │  ├─ refine/       └─ sidecar.rs        └─ migrations/             │    │
│  │  ├─ settings/                                                      │    │
│  │  ├─ workspace/    SQLite (rusqlite)                                │    │
│  │  └─ usage/        skills · workflow_runs · workflow_steps          │    │
│  │                   agent_runs · workflow_sessions · skill_locks     │    │
│  └──────────────────────────────┬────────────────────────────────────┘    │
│                                 │ stdin/stdout JSONL                       │
│  ┌──────────────────────────────▼────────────────────────────────────┐    │
│  │              NODE.JS SIDECAR (TypeScript + esbuild)                │    │
│  │                                                                    │    │
│  │  bootstrap.js → agent-runner.ts → persistent-mode.ts             │    │
│  │                                                                    │    │
│  │  ┌─────────────────┐  ┌───────────────────┐                       │    │
│  │  │  One-shot runs  │  │  Streaming session │                       │    │
│  │  │  run-agent.ts   │  │  stream-session.ts │                       │    │
│  │  └────────┬────────┘  └─────────┬──────────┘                       │    │
│  │           └────────────┬────────┘                                   │    │
│  │                        ▼                                            │    │
│  │             MessageProcessor                                         │    │
│  │             (SDK msgs → DisplayItems + AgentEvents)                 │    │
│  │                        ▼                                            │    │
│  │         @anthropic-ai/claude-agent-sdk ──► Anthropic API           │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — Frontend

### 1.1 Router & Pages

TanStack Router manages 5 routes:

| Route | Page | Purpose |
|-------|------|---------|
| `/` | DashboardPage | Default landing; empty state or workspace |
| `/skill/$skillName` | WorkflowPage | Workflow step machine for a specific skill |
| `/settings` | SettingsPage | Configuration |
| `/refine` | → redirects to `/?tab=refine` | Legacy |
| `/skills` | → redirects to `/settings?tab=skills` | Legacy |

### 1.2 Shell Layout — AppLayout

`AppLayout` is the root component. Think of it as the **studio's main console**.

```text
AppLayout
├── IconRail (52px left column: nav icons + gear)
├── SkillListPanel (260px resizable: unified skill list)
└── main area
    ├── WorkspaceShell (for completed/imported/marketplace skills)
    │   ├── Tab: Overview → WorkspaceOverview
    │   ├── Tab: Refine   → WorkspaceRefine
    │   ├── Tab: Evals    (disabled stub)
    │   └── Tab: Description (disabled stub)
    └── Outlet (WorkflowPage for /skill/$skillName, SettingsPage for /settings)
```

**AppLayout responsibilities on mount:**

1. Load settings from Rust (API key, paths, models)
2. Run `reconcileStartup()` — compare DB vs filesystem
3. Load GitHub auth state
4. Set up global keyboard shortcuts (Cmd+, → Settings)
5. Check for marketplace skill updates

---

### 1.3 Zustand Stores — The Studio's Memory

All state lives in Zustand stores. No global React context. Here is every store:

#### `workflow-store` — The Core State Machine

> **Analogy:** This is the **session tape** currently loaded in the machine. Everything about the current workflow run lives here.

```typescript
interface WorkflowState {
  // Identity
  skillName: string | null
  purpose: string | null

  // Step progress
  currentStep: number                  // 0-4
  steps: WorkflowStep[]                // [{id, name, description, status}]

  // Execution state
  isRunning: boolean                   // Agent actively streaming
  isInitializing: boolean              // Sidecar startup in progress
  initProgressMessage: string | null   // e.g. "Loading SDK modules..."
  initStartTime: number | null
  runtimeError: RuntimeError | null    // Sidecar startup failure

  // Session tracking
  workflowSessionId: string | null     // UUID, created when isRunning→true

  // UI modes
  reviewMode: boolean                  // true = browse completed steps (default)

  // Gate evaluation
  gateLoading: boolean                 // Answer-evaluator agent running (transient)

  // Step guards
  disabledSteps: number[]              // Scope/decision guards block these steps

  // Persistence
  hydrated: boolean                    // DB state has been loaded

  // Pre-navigation flags (see deep dive below)
  pendingUpdateMode: boolean
  pendingNoReviewMode: boolean
}
```

**⚠️ The Navigation Flags — Deep Dive**

These three flags are the source of most navigation confusion. Here is exactly what each one does:

---

##### `pendingUpdateMode`

> **Analogy:** You're about to press Record on a track that already has content. You haven't pressed it yet — the button is *primed* but not fired.

**Set by:** SkillListPanel when the user clicks a skill that has never started a workflow (step 0 or null), OR when the user clicks "Redo" to restart from scratch.

**Consumed by:** The `useWorkflowPersistence` hook on mount inside WorkflowPage. When it sees `pendingUpdateMode=true`, it auto-starts the agent for the current step immediately after hydrating from DB.

**Why it exists:** Navigation in TanStack Router is asynchronous. The SkillListPanel triggers `navigate({ to: "/skill/$skillName" })` but WorkflowPage hasn't mounted yet. You can't call `handleStartAgentStep()` before the component exists. So instead, the panel primes the flag, the page reads it on mount and fires.

**Lifecycle:**

```text
SkillListPanel (click fresh skill)
  → setPendingUpdateMode(true)
  → navigate("/skill/$skillName")
      ↓
WorkflowPage mounts
  → useWorkflowPersistence hydrates from DB
  → sees pendingUpdateMode=true
  → calls setPendingUpdateMode(false)   ← consumed/cleared
  → fires handleStartAgentStep()        ← auto-start
```

---

##### `pendingNoReviewMode` (previously `pendingReviewMode`)

> **Analogy:** You're entering a studio room but you've left a note on the door saying "Don't auto-play anything when I arrive."

**Set by:** SkillListPanel when the user clicks a skill that is *mid-progress* (has some completed steps but isn't done). In this case, we want to land in review mode without auto-starting the agent.

**Consumed by:** `useWorkflowPersistence` — if `pendingNoReviewMode=true`, it hydrates the state but does NOT call `handleStartAgentStep()`.

**Why it exists:** Without this flag, clicking any in-progress skill would auto-start the current incomplete step, which is jarring and wasteful.

---

##### `reviewMode` (the actual toggle, not a "pending" flag)

> **Analogy:** The "Monitor" vs "Record" switch on a mixing channel.

- `reviewMode=true` (default): The user can browse completed steps, scroll through output, look at artifacts. No agent can start.
- `reviewMode=false` (Update mode): The agent can be started/restarted for the current step.

**Controlled by:** The `ReviewModeToggle` button in WorkflowMainHeader. Users switch between these modes manually.

**Important:** `reviewMode` is the *current live state*. The `pendingUpdateMode`/`pendingNoReviewMode` flags are only *pre-navigation signals* — they don't survive longer than the mount of WorkflowPage.

---

##### `wasToggle` (what the user asked about)

After searching the codebase, `wasToggle` does not exist as a variable name. It may be a concept the user was thinking of regarding the ReviewModeToggle. The toggle that switches between Review ↔ Update mode is the `reviewMode` boolean described above, controlled via `setReviewMode(bool)`.

---

**`workflowSessionId` — When it's created:**

```typescript
setRunning(running: boolean) {
  if (running && !get().workflowSessionId) {
    // UUID created lazily on first isRunning→true transition
    set({ isRunning: true, workflowSessionId: crypto.randomUUID() })
  } else if (!running) {
    set({ isRunning: false })
    // sessionId NOT cleared — preserved for the session's lifetime
  }
}
```

It's created once per workflow "session" (single run of the entire workflow), persisted to SQLite via `createWorkflowSession()` before the agent starts.

---

#### `agent-store` — Live Agent Streaming State

> **Analogy:** The **VU meters** on the console — they show exactly what's happening right now in the live room.

```typescript
interface AgentStore {
  runs: Record<string, AgentRun>   // agentId → run data
  activeAgentId: string | null     // which run is displayed in main panel
}

interface AgentRun {
  agentId: string
  model: string
  status: "running" | "completed" | "error" | "shutdown"
  displayItems: DisplayItem[]      // structured UI items (thinking, text, tool calls, results)
  startTime: number
  endTime?: number
  totalCost?: number
  tokenUsage?: { input, output }
  contextHistory: ContextSnapshot[]
  contextWindow: number
  compactionEvents: CompactionRecord[]
  thinkingEnabled: boolean
  skillName?: string
  resultSubtype?: string           // "success" | "error_max_turns" | ...
  runSource?: "workflow" | "refine" | "test"
  usageSessionId?: string
}
```

**Display item batching:** Items from the sidecar arrive at high frequency. Rather than calling `setState` per item (which would re-render the entire tree per item), the store uses a `requestAnimationFrame` buffer — items are queued and flushed in batches on the next animation frame.

```text
Sidecar emits 50 display items in 10ms
   ↓
addDisplayItem() → push to buffer[], schedule RAF if not already scheduled
   ↓
Next RAF fires → flush buffer → single setState call → single re-render
```

---

#### `skill-store` — Builder Skills List

```typescript
interface SkillStore {
  skills: SkillSummary[]            // all builder skills
  activeSkill: string | null        // selected skill name
  isLoading: boolean
  lockedSkills: Set<string>         // skills locked by other instances
}
```

---

#### `settings-store` — User Configuration

```typescript
interface SettingsStore {
  anthropicApiKey: string | null
  workspacePath: string | null      // workspace root (e.g. ~/.claude/workspace)
  skillsPath: string | null         // where SKILL.md files live
  preferredModel: string | null
  logLevel: string
  extendedThinking: boolean
  interleavedThinkingBeta: boolean
  sdkEffort: string | null
  fallbackModel: string | null
  refinePromptSuggestions: boolean
  githubOauthToken: string | null
  githubUserLogin: string | null
  marketplaceRegistries: MarketplaceRegistry[]
  isConfigured: boolean             // computed: !!apiKey && !!skillsPath
}
```

---

#### `refine-store` — Refine Session & Chat State

```typescript
interface RefineStore {
  // Skill selection
  selectedSkill: SkillSummary | null
  refinableSkills: SkillSummary[]

  // File editor
  skillFiles: SkillFile[]           // [{filename, content}]
  activeFileTab: string             // currently shown file
  diffMode: boolean
  gitDiff: RefineDiff | null        // git patch from finalize
  previewRevision: number           // incremented on file update → forces PreviewPanel re-render

  // Chat messages
  messages: RefineMessage[]

  // Session state
  activeAgentId: string | null
  isRunning: boolean
  sessionId: string | null          // backend refine session ID
  sessionExhausted: boolean         // max turns reached

  // Cross-page nav state
  pendingInitialMessage: string | null  // pre-populated first message (from Test page)
}
```

**Key behavior:** `selectSkill()` resets ALL session state (messages, agent, files, diff) but intentionally does NOT reset `pendingInitialMessage` — that cross-page state is consumed separately.

---

#### `imported-skills-store` — Uploaded & Marketplace Skills

```typescript
interface ImportedSkillsStore {
  skills: ImportedSkill[]           // user-uploaded + marketplace
  isLoading: boolean
  error: string | null
}
```

---

#### `usage-store` — Analytics & Cost Tracking

```typescript
interface UsageStore {
  summary: UsageSummary | null      // total_cost, total_runs
  recentSessions: WorkflowSessionRecord[]
  agentRuns: AgentRunRecord[]
  byStep: UsageByStep[]
  byModel: UsageByModel[]
  byDay: UsageByDay[]
  loading: boolean
  hideCancelled: boolean
  dateRange: "7d" | "14d" | "30d" | "90d" | "all"
  skillFilter: string | null
  modelFamilyFilter: string | null
  loadGeneration: number            // prevents stale data from overwriting newer requests
}
```

---

### 1.4 SkillListPanel — Navigation Hub

The skill list panel is the **primary navigation surface** of the app. It merges builder + imported skills into a unified list and drives all navigation.

#### Source Detection

```typescript
// Builder skill with marketplace source_url → "marketplace"
source: s.skill_source === "marketplace" ? "marketplace" : "builder"

// Imported skill with marketplace_source_url → "marketplace", else → "imported"
source: s.marketplace_source_url ? "marketplace" : "imported"
```

#### Status Dots

Each skill row shows a colored dot derived from state:

| Color | Meaning | Detection |
|-------|---------|-----------|
| 🔵 Pacific (blue) | Marketplace skill | `source === "marketplace"` |
| 🟣 Violet | Uploaded (file-imported) skill | `source === "imported"` |
| 🟢 Seafoam (green) | Builder skill, all steps complete | `status === "completed"` |
| 🟡 Amber (yellow) | Builder skill, mid-progress | `current_step >= 1` |
| 🔴 Red | Builder skill, never started | `current_step === null or 0` |
| ✨ Pulsing | Agent actively running | `agentStore.activeAgentId` matches |

#### Click Navigation Logic

```text
User clicks skill
├── If marketplace or imported → WorkspaceShell (Overview tab)
├── If builder + completed     → WorkspaceShell (Overview tab)
├── If builder + fresh (step 0 or null)
│   → setPendingUpdateMode(true)
│   → navigate("/skill/$skillName")
│   → WorkflowPage auto-starts agent on mount
└── If builder + mid-progress
    → setPendingNoReviewMode(true)
    → navigate("/skill/$skillName")
    → WorkflowPage lands in review mode, no auto-start
```

#### Locking

While any workflow is running, all other skill rows are locked:

- Own-instance lock: derived from `workflowStore.isRunning` + `skillStore.lockedSkills`
- External instance locks: fetched via `getExternallyLockedSkills()` Tauri command
- Locked rows: 45% opacity, `Lock` icon, `cursor-not-allowed`, click blocked

---

### 1.5 WorkflowPage — Step State Machine

The workflow page is the most complex component. It uses **4 hooks** in sequence:

```text
WorkflowPage
├── useWorkflowPersistence  (1) Load saved state from SQLite
├── useWorkflowAutosave     (2) Debounced clarifications editor
├── useWorkflowSession      (3) Navigation guard + skill lock lifecycle
└── useWorkflowStateMachine (4) Core orchestration — step transitions, agent lifecycle, gates
```

#### useWorkflowPersistence

Runs on mount. Loads the persisted workflow state for this skill from SQLite:

1. `getWorkflowState(skillName)` → completed step IDs + currentStep
2. `loadWorkflowState(completedStepIds, savedCurrentStep)` in store
3. Read clarifications file from disk (if step 0 complete)
4. Set `hydrated=true`
5. If `pendingUpdateMode=true` → clear flag, fire auto-start
6. If `pendingNoReviewMode=true` → clear flag, stay in review mode (no auto-start)

#### useWorkflowStateMachine

This is the **conductor**. Key actions it exposes:

| Action | When called | What it does |
|--------|------------|-------------|
| `handleStartAgentStep()` | User clicks "Start" or auto-start on mount | Acquires lock, calls `runWorkflowStep()`, registers agent run, starts streaming |
| `handleReviewContinue()` | User clicks "Continue" to next step | Checks gate if step 1→2; if passes, advances `currentStep` |
| `performStepReset(stepId)` | User clicks "Reset from step N" | Calls `resetWorkflowStep()`, resets step statuses in store |
| `handleGateSkip()` | User skips gate dialog | Advances without evaluation |
| `handleGateResearch()` | User wants to revise answers | Goes back to step 1 |
| `handleGateContinueAnyway()` | User overrides gate verdict | Forces advancement |

#### Gate Evaluation Flow

The "gate" is the Answer Evaluator that runs between step 1 (Detailed Research) and step 2 (Decisions). It checks whether the research answers are sufficient to generate a high-quality skill.

```text
User completes step 1, clicks "Continue"
  ↓
Gate dialog opens (loading state)
  ↓
run_answer_evaluator() → sidecar runs answer-evaluator agent
  ↓
Verdict: sufficient / mixed / insufficient
  Per-question breakdown: clear | needs_refinement | not_answered | vague | contradictory
  ↓
User sees dialog with options:
  ├── Skip → advance to step 2
  ├── Research → go back to step 1 (do more research)
  ├── Continue Anyway → override and advance
  └── Let Me Answer → close dialog, stay in edit mode
```

---

### 1.6 WorkspaceShell + Overview + Refine

**WorkspaceShell** wraps completed/imported skills in a tabbed interface.

**WorkspaceOverview** shows skill metadata and two actions:

- **Open Refine** → switches to Refine tab
- **Redo Workflow** (builder only) → confirmation dialog → `resetWorkflowStep(0)` → navigate to `/skill/$skillName` with `pendingUpdateMode=true`

**WorkspaceRefine** is the live refine chat. Its lifecycle:

```text
Mount
├── acquireLock(skillName)
├── startRefineSession(skillName, workspacePath)
│   └── Rust creates RefineSessionManager entry
├── getSkillContentForRefine(skillName)
│   └── Loads SKILL.md + references/

User sends message
├── sendRefineMessage(sessionId, text, targetFiles, command)
│   └── Rust streams to sidecar via StreamSession
├── agentStore.registerRun(agentId, "refine")
│   └── Display items stream to UI

Agent completes turn
├── finalizeRefineRun(skillName)
│   └── Rust writes files to disk + git commits
├── updateSkillFiles(newFiles)
│   └── previewRevision++ → PreviewPanel re-renders

Unmount / navigation
├── closeRefineSession()
├── releaseLock(skillName)
└── refineStore.clearSession()
```

---

## Layer 2 — Rust Backend

### 2.1 Module Map

```text
app/src-tauri/src/
├── lib.rs                  App entry point, Tauri builder
├── commands/
│   ├── skill/              CRUD, tags, locks, metadata, suggestions
│   ├── workflow/
│   │   ├── runtime.rs      Step execution engine (run_workflow_step)
│   │   ├── evaluation.rs   State persistence (get/save/reset workflow state)
│   │   ├── output_format.rs Deserialize agent output
│   │   ├── packaging.rs    .zip export
│   │   ├── step_config.rs  Per-step config (model, tools, thinking budget)
│   │   ├── prompt.rs       Prompt construction
│   │   ├── guards.rs       Scope + decision guards
│   │   └── deploy.rs       Deploy bundled prompts to workspace
│   ├── refine/             Multi-turn refine session management
│   ├── workspace.rs        Workspace init, reconciliation commands
│   ├── settings.rs         App configuration
│   ├── usage.rs            Analytics queries
│   ├── agent.rs            Agent lifecycle
│   ├── files.rs            Skill filesystem read/write
│   ├── git.rs              Skill version history
│   ├── imported_skills/    Uploaded + marketplace skill management
│   ├── github_import/      Marketplace browser + import
│   ├── github_auth.rs      Device flow OAuth
│   ├── node.rs             Node.js version check
│   ├── feedback.rs         GitHub issue creation
│   └── sidecar_lifecycle.rs Graceful shutdown
├── agents/
│   ├── sidecar_pool.rs     Persistent sidecar lifecycle
│   ├── events.rs           Sidecar event routing → frontend
│   └── sidecar.rs          SidecarConfig + spawn_sidecar()
├── db/
│   ├── db.rs               Connection pool, migration runner
│   ├── locks.rs            Skill lock acquire/release/reclaim
│   └── migrations/         Numbered SQL migrations (37+)
├── reconciliation/         Startup DB-vs-disk sync
└── types/                  Shared Rust structs
```

### 2.2 SQLite Schema

> **Analogy:** The **studio's booking system and archive**. Every session, every take, and who has the room booked is recorded here.

#### Core Tables

**`skills`** — Master registry of all skills

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT UNIQUE | Skill identifier |
| `skill_source` | TEXT | `'skill-builder'` \| `'marketplace'` \| `'imported'` |
| `purpose` | TEXT | Platform/domain/source/data-engineering |
| `description` | TEXT | User-visible description |
| `version` | TEXT | Semantic version |
| `deleted_at` | TEXT | Soft delete timestamp |

**`workflow_runs`** — Workflow execution state per skill

| Column | Type | Notes |
|--------|------|-------|
| `skill_name` | TEXT PK | |
| `current_step` | INTEGER | 0–4 |
| `status` | TEXT | `'pending'` \| `'running'` \| `'completed'` |
| `purpose` | TEXT | User-provided purpose |

**`workflow_steps`** — Per-step completion records

| Column | Type | Notes |
|--------|------|-------|
| `skill_name` | TEXT | Composite PK with step_id |
| `step_id` | INTEGER | 0=research, 1=detailed, 2=decisions, 3=generate |
| `status` | TEXT | `'pending'` \| `'running'` \| `'completed'` |

**`skill_locks`** — Exclusive edit locks

| Column | Type | Notes |
|--------|------|-------|
| `skill_id` | INTEGER FK→skills.id | Unique (one lock per skill) |
| `instance_id` | TEXT | UUID of locking app instance |
| `pid` | INTEGER | OS process ID (for dead lock detection) |
| `acquired_at` | TEXT | |

**`agent_runs`** — Usage telemetry, immutable append-only

| Column | Type | Notes |
|--------|------|-------|
| `agent_id` | TEXT | Composite PK with model |
| `model` | TEXT | |
| `skill_name` | TEXT | Snapshot (no FK — survives parent delete) |
| `step_id` | INTEGER | |
| `input_tokens` | INTEGER | |
| `output_tokens` | INTEGER | |
| `total_cost` | REAL | USD |
| `workflow_session_id` | TEXT | Groups runs into a session |

**`workflow_sessions`** — Session lifecycle

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | TEXT PK | UUID |
| `skill_id` | INTEGER FK→skills.id CASCADE | |
| `pid` | INTEGER | For orphan detection |
| `started_at` | TEXT | |
| `ended_at` | TEXT | Null = still active |

**`imported_skills`** — User-uploaded and marketplace skills

| Column | Type | Notes |
|--------|------|-------|
| `skill_id` | TEXT PK | UUID |
| `skill_name` | TEXT UNIQUE | |
| `disk_path` | TEXT | Absolute path to SKILL.md |
| `marketplace_source_url` | TEXT | Null = file-uploaded, non-null = marketplace |
| `is_bundled` | INTEGER | Pre-shipped vs user-added |

### 2.3 Skill Lock System

> **Analogy:** A **physical key system** — only one person can hold the key to a studio room at a time. If they leave without returning the key but their car is gone from the lot (dead PID), the manager can reclaim it.

```text
acquire_skill_lock(skill_name, instance_id, pid)
  ↓
BEGIN IMMEDIATE transaction (prevents race)
  ↓
Check existing lock?
  ├── No lock → INSERT new lock → COMMIT ✓
  ├── Same instance_id → already ours → COMMIT ✓
  ├── Different instance, PID alive → ROLLBACK, return Err (locked)
  └── Different instance, PID dead → DELETE old lock, INSERT new → COMMIT ✓ (reclaimed)
```

PID liveness check:

- **Unix:** `kill(pid, 0)` — signal 0 returns success if process exists
- **Windows:** `tasklist /FI "PID eq N"` — parse output

### 2.4 Sidecar Pool — Persistent Process Management

> **Analogy:** The **live room** in the studio. Rather than hiring and firing musicians for each song (spawning a new Node.js process per agent run), you keep the musician in the room. The intercom (stdin/stdout) stays open. When a new take starts, you just give them the new sheet music (request JSON).

```text
SidecarPool
└── HashMap<skill_name, PersistentSidecar>
    └── PersistentSidecar
        ├── Child process (node bootstrap.js --persistent)
        ├── stdin: Arc<Mutex<ChildStdin>>   // serialized writes
        ├── stdout_task: JoinHandle          // async reader
        ├── stderr_task: JoinHandle
        ├── heartbeat_task: JoinHandle       // 30s ping/pong health check
        └── last_activity: Arc<Mutex<Instant>>
```

**Lifecycle:**

```text
spawn_sidecar(skill_name, config)
  ↓
SidecarPool.get_or_spawn(skill_name)
  ├── Exists + alive → return existing sidecar
  └── Missing or dead
      ├── Acquire spawning guard (prevents duplicate spawns)
      ├── Spawn: node bootstrap.js --persistent
      ├── Wait for {"type":"sidecar_ready"} on stdout
      ├── Start heartbeat task (ping every 30s)
      └── Add to pool
  ↓
Write request JSON to sidecar stdin
  ↓
stdout_task routes responses:
  ├── display_item → emit "agent-message" to frontend
  ├── agent_event (run_result) → persist to SQLite
  ├── agent_event (turn_complete) → emit to frontend
  ├── pong → update heartbeat timestamp
  └── terminal → handle_sidecar_exit()
```

**Idle cleanup:** Every 60s, sidecars idle >600s are gracefully shut down and removed from the pool.

**Heartbeat:** If no pong within 5s of a ping, the sidecar is considered dead and removed.

### 2.5 Reconciliation — Startup Sync

On every startup, the reconciler compares the DB with the filesystem and resolves discrepancies:

```text
Pass 1: For each skill in DB
  ├── skill-builder source
  │   ├── Workspace marker exists? → check step artifacts → advance/reset DB
  │   └── Workspace marker missing? → notify user
  ├── marketplace source
  │   ├── SKILL.md exists in skills_path? → OK
  │   └── SKILL.md gone? → remove from master
  └── imported source → skip

Pass 2: Scan skills_path for folders NOT in DB
  ├── Folder, no SKILL.md → auto-delete, notify
  ├── Folder with SKILL.md, all artifacts → offer import or discard
  └── Folder with SKILL.md, partial artifacts → offer import or discard
```

---

## Layer 3 — Node.js Sidecar

### 3.1 Process Architecture

> **Analogy:** The sidecar is the **session musician**. It sits in the live room (a persistent Node.js process), reads sheet music (agent instructions via stdin), plays (runs Claude SDK), and sends back a recording (display items + events via stdout). Between songs, it waits quietly.

```text
Rust spawns: node bootstrap.js --persistent
  ↓
bootstrap.js catches module load errors → imports agent-runner.js
  ↓
agent-runner.ts: installs signal/exception handlers → calls runPersistent()
  ↓
persistent-mode.ts: emits sidecar_ready, enters readline loop
  ↓
For each JSON line on stdin:
  ├── agent_request → runAgentRequest()    (one-shot workflow step)
  ├── stream_start  → new StreamSession()  (refine chat session)
  ├── stream_message → session.pushMessage()
  ├── stream_end    → session.close()
  ├── ping          → emit pong
  ├── cancel        → abortController.abort()
  └── shutdown      → wait for in-flight, exit(0)
```

### 3.2 One-Shot vs Streaming Sessions

**One-shot** (workflow steps): Single prompt → agent runs to completion → result.

```text
runAgentRequest(config, onMessage, signal)
  ├── MOCK_AGENTS? → runMockAgent()
  └── else
      ├── Discover plugins in {cwd}/.claude/plugins/
      ├── Build SDK options (model, tools, thinking, env)
      ├── for await (message of sdk.query(options))
      │     MessageProcessor.process(message) → emit display items + events
      └── emit run_result
```

**Streaming** (refine chat): Continuous conversation, user sends multiple messages.

```text
StreamSession (stream_start)
├── Async generator as SDK prompt:
│   ├── yield config.prompt   (first message)
│   └── loop:
│       ├── check pending queue
│       └── await pushMessage()   (parks here until user sends next message)
├── for await (message of sdk.query({prompt: generator}))
│     MessageProcessor.process(message)
│     if turn_complete → emit turn_complete event (frontend shows it's ready for next message)
└── On close/shutdown → generator exits → SDK wraps up
```

### 3.3 MessageProcessor — SDK Events to UI

> **Analogy:** A **sound engineer mixing live inputs** — raw signals from microphones (SDK messages) are processed, routed to the right channel (display item type), and the levels balanced (filtered/transformed) before hitting the speakers (frontend UI).

```text
Raw SDK Message → classifyRawMessage()
  ├── hardNoise → drop (filtered)
  ├── system   → emit init_progress / run_config / run_init events
  ├── user     → link tool results to pending tool calls
  └── ai
      ├── assistant
      │   ├── thinking block → ThinkingDisplayItem
      │   ├── text block     → OutputDisplayItem
      │   ├── tool_use block → ToolCallDisplayItem (status: pending)
      │   │   └── if Task/Agent → SubagentDisplayItem (nested)
      │   └── emit turn_usage event
      ├── result → emit RunResultEvent + ResultDisplayItem
      │   └── extract structured_output (JSON from last text block fallback)
      └── error → emit ErrorDisplayItem
```

**Tool linking:** Tool calls are emitted with `status: "pending"`. When the corresponding tool result arrives (in a `user` message), the item is updated with the result and re-emitted with `status: "ok"` or `"error"`. The frontend does an in-place replacement using `toolUseId`.

### 3.4 Mock Mode

When `MOCK_AGENTS=true`, the sidecar replays pre-recorded JSONL templates instead of calling the Anthropic API. This is used for frontend development and testing.

```text
resolveStepTemplate(agentName, skillName)
  ├── research-orchestrator → step0-research.jsonl
  ├── detailed-research     → step1-detailed-research.jsonl
  ├── confirm-decisions     → step2-confirm-decisions.jsonl
  ├── generate-skill        → step3-generate-skill.jsonl
  ├── rewrite-skill         → rewrite-skill.jsonl
  └── answer-evaluator      → gate-answer-evaluator.jsonl

For each line in template.jsonl:
  ├── Update timestamp to now
  ├── MessageProcessor.process(line)   ← same pipeline as live mode
  └── emit display items + events

Write mock output files to workspace:
  └── Copy mock-templates/outputs/{stepDir}/ → skill workspace
      (so verify_step_output() passes and workflow can advance)
```

---

## End-to-End Flow: User Creates a New Skill

Here's the complete journey from "user clicks +" to "SKILL.md exists on disk":

```text
1. User clicks + in SkillListPanel
   → SkillDialog opens (create mode)
   → User enters skill name + purpose
   → createSkill() Tauri command
     └── INSERT into skills, INSERT into workflow_runs

2. SkillDialog closes, navigation fires
   → setPendingUpdateMode(true)
   → navigate("/skill/my-new-skill")

3. WorkflowPage mounts
   → useWorkflowPersistence:
     getWorkflowState("my-new-skill") → step 0, pending
     loadWorkflowState([]) → store initialized
     sees pendingUpdateMode=true → auto-start

4. Auto-start fires: handleStartAgentStep()
   → acquireLock("my-new-skill")
   → createWorkflowSession() → workflowSessionId UUID
   → runWorkflowStep(workspacePath, "my-new-skill", 0)
     └── Rust: validate, deploy bundled prompts, build prompt
     └── sidecarPool.get_or_spawn("my-new-skill")
     └── Write request JSON to sidecar stdin
     └── Return agentId to frontend

5. Frontend: agentStore.startRun(agentId, model)
   → activeAgentId set → UI shows streaming panel

6. Sidecar: receives agent_request
   → discoverPlugins → buildQueryOptions
   → sdk.query() starts
   → MessageProcessor processes messages
   → Emit display items → frontend renders thinking/text/tool calls

7. Step 0 agent completes
   → sidecar emits run_result → Rust persists to agent_runs
   → sidecar emits final display item
   → frontend: completeRun(agentId)
   → save_workflow_state(stepId=0, status="completed")
   → WorkflowStepComplete card shown

8. User reviews output, clicks "Continue"
   → currentStep = 1, same cycle repeats for steps 1, 2

9. After step 1: Gate evaluation
   → run_answer_evaluator() → answer-evaluator agent
   → Verdict "sufficient" → advance to step 2

10. Step 3 (generate-skill) completes
    → SKILL.md + references/ written to skillsPath
    → save_workflow_state(status="completed")
    → workflowStore.status = "completed"
    → SkillListPanel shows 🟢 seafoam dot

11. User navigates back to dashboard
    → navigation guard fires → endWorkflowSession()
    → releaseLock("my-new-skill")
    → WorkspaceShell opens (Overview tab)
```

---

## Common Gotchas

### 1. `pendingUpdateMode` is a one-way trip

Once set, it **must** be consumed (cleared) on WorkflowPage mount. If WorkflowPage fails to mount for any reason (navigation interrupted, error boundary), the flag stays `true` and the next time you navigate to that skill, the agent auto-starts unexpectedly. The fix is always: clear the flag before firing the action.

### 2. Sidecar stdout is protocol-only

The sidecar writes **only JSON lines to stdout**. Any `console.log()` in the sidecar code goes to stderr. If you accidentally write non-JSON to stdout (e.g., `console.log("debug")`), Rust's JSON parser will throw and the sidecar message will be dropped silently. This is the most common debugging footgun.

### 3. `workflowSessionId` is per-session, not per-run

One workflow session = one complete run from step 0 through step 3. A session can have **many agent runs** (one per step + gate evaluation). The `agent_runs` table groups them by `workflow_session_id`. If you reset and redo, a new `workflowSessionId` is created.

### 4. `agent_runs` has no FK to `skills`

Intentional. Agent runs are immutable usage snapshots. If a skill is deleted (soft-deleted), its run history is preserved. The `skill_name` column is a snapshot value, not a foreign key.

### 5. Skills master vs workflow_runs

Before migration 24, skill metadata (description, version, model) lived in `workflow_runs`. It was moved to the `skills` master table. If you see columns in `workflow_runs` that look like metadata, they're legacy and may be null. Always read metadata from `skills`.

### 6. The gate blocks on the frontend side, not the backend

The Answer Evaluator gate dialog and verdict logic lives entirely in `useWorkflowStateMachine` on the frontend. The backend just runs the agent and returns the output. The decision of "should we block progression to step 2" is made by the frontend reading the verdict from the agent's structured output.

### 7. `previewRevision` is the PreviewPanel's render key

The `PreviewPanel` in WorkspaceRefine doesn't watch `skillFiles` directly. It watches `previewRevision` (an integer that increments on every file update). This prevents unnecessary re-renders when file content hasn't changed semantically but the reference has.

---

## Key Files Quick Reference

| File | What it does |
|------|-------------|
| `app/src/components/layout/app-layout.tsx` | Root shell, all dialogs, reconciliation |
| `app/src/components/skill-list-panel.tsx` | Unified skill list, navigation, status dots |
| `app/src/components/workspace/workspace-shell.tsx` | Tabbed workspace for completed skills |
| `app/src/components/workspace/workspace-overview.tsx` | Skill metadata + Redo action |
| `app/src/components/workspace/workspace-refine.tsx` | Live refine chat with lock lifecycle |
| `app/src/pages/workflow.tsx` | Workflow step machine (4 hooks) |
| `app/src/stores/workflow-store.ts` | Core workflow state + navigation flags |
| `app/src/stores/agent-store.ts` | Live streaming state + display items |
| `app/src/lib/tauri.ts` | All IPC commands |
| `app/src-tauri/src/lib.rs` | Tauri app entry, startup sequence |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Step execution engine |
| `app/src-tauri/src/commands/workflow/evaluation.rs` | State persistence |
| `app/src-tauri/src/agents/sidecar_pool.rs` | Persistent sidecar pool |
| `app/src-tauri/src/db/locks.rs` | Skill lock acquire/release |
| `app/sidecar/src/persistent-mode.ts` | JSONL protocol handler |
| `app/sidecar/src/message-processor.ts` | SDK → display items pipeline |
| `app/sidecar/src/stream-session.ts` | Multi-turn refine session |
| `app/sidecar/src/mock-agent.ts` | Mock template replay |
