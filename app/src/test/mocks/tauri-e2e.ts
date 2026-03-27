/**
 * E2E mock for Tauri APIs. This file is loaded via vite plugin
 * when TAURI_E2E=true, replacing @tauri-apps/api/core.
 *
 * It provides mock responses for all invoke commands so the frontend
 * can render without the Rust backend.
 */


// E2E root matches test-paths.ts joinE2ePath() output at runtime.
// Browser mocks can't access os.tmpdir(), so we use a synthetic root
// that E2E tests override via __TAURI_MOCK_OVERRIDES__ when needed.
const E2E_ROOT = "/e2e-test";
const E2E_SKILLS_PATH = `${E2E_ROOT}/skills`;
const E2E_DEFAULT_SKILLS_PATH = `${E2E_ROOT}/default-skills`;

const defaultSettings = {
  anthropic_api_key: "sk-ant-test-e2e",
  workspace_path: null,
  skills_path: E2E_SKILLS_PATH,
  preferred_model: null,
  log_level: "info",
};

const mockResponses: Record<string, unknown> = {
  get_settings: defaultSettings,
  save_settings: undefined,
  update_user_settings: undefined,
  test_api_key: true,
  set_log_level: undefined,
  get_default_skills_path: E2E_DEFAULT_SKILLS_PATH,
  check_node: {
    available: true,
    version: "v20.11.0",
    meets_minimum: true,
    error: null,
    source: "system",
  },
  check_startup_deps: {
    all_ok: true,
    checks: [
      { code: "node_runtime", name: "Node.js", ok: true, detail: "v20.11.0 (system)" },
      { code: "agent_sidecar_bundle", name: "Agent sidecar", ok: true, detail: "sidecar/dist/agent-runner.js" },
      { code: "claude_sdk_cli", name: "Claude SDK", ok: true, detail: "sidecar/dist/sdk/cli.js" },
      { code: "git_binary", name: "Git", ok: true, detail: "git version 2.50.1" },
    ],
  },
  list_skills: [],
  create_skill: undefined,
  delete_skill: undefined,
  update_skill_tags: undefined,
  get_all_tags: [],
  parse_clarifications: {
    sections: [
      {
        heading: "Domain Concepts",
        questions: [
          {
            id: "Q1",
            title: "Primary focus",
            question: "What is the primary focus area for this skill?",
            choices: [
              { letter: "a", text: "Sales forecasting", rationale: "predict future revenue" },
              { letter: "b", text: "Pipeline management", rationale: "track deal progression" },
              { letter: "c", text: "Other (please specify)", rationale: "" },
            ],
            recommendation: "b — most actionable for day-to-day work",
            answer: null,
          },
        ],
      },
    ],
  },
  save_clarification_answers: undefined,
  save_clarifications_content: undefined,
  read_file: "",
  check_workspace_path: true,
  check_marketplace_updates: { library: [], workspace: [], registry_name: null, registry_names: [] },
  has_running_agents: false,
  start_agent: "agent-001",
  run_workflow_step: "agent-001",
  run_parallel_agents: { agent_id_a: "agent-001", agent_id_b: "agent-002" },

// Workflow state
  get_workflow_state: { run: null, steps: [] },
  save_workflow_state: undefined,
  capture_step_artifacts: [],
  get_artifact_content: null,
  save_artifact_content: undefined,
  reset_workflow_step: undefined,
  // Sidecar lifecycle
  cleanup_skill_sidecar: undefined,
  clean_benchmark_snapshot: undefined,
  // Reconciliation
  reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0, discovered_skills: [] },
  record_reconciliation_cancel: undefined,
  // Skill locks
  acquire_lock: undefined,
  release_lock: undefined,
  create_workflow_session: undefined,
  get_locked_skills: [],
  // Refine page
  start_refine_session: {
    session_id: "e2e-refine-session-001",
    skill_name: "test-skill",
    created_at: new Date().toISOString(),
  },
  send_refine_message: "refine-test-skill-e2e-001",
  answer_refine_question: undefined,
  cancel_refine_turn: undefined,
  close_refine_session: undefined,
  list_refinable_skills: [
    {
      name: "test-skill",
      display_name: "Test Skill",
      current_step: null,
      status: "completed",
      last_modified: null,
      purpose: "domain",
    },
  ],
  get_skill_content_for_refine: [
    { path: "SKILL.md", content: "# Test Skill\n\nA skill for testing.\n\n## Instructions\n\nFollow these steps..." },
    { path: "references/glossary.md", content: "# Glossary\n\n- **Term**: Definition" },
    { path: "references/checklist.md", content: "# Delivery Checklist\n\n- Validate inputs\n- Log failures\n- Add regression coverage" },
    { path: "references/troubleshooting.md", content: "# Troubleshooting\n\n## Common failures\n\n- Missing configuration\n- Invalid payload shape\n- Timeout during sync" },
  ],
  finalize_refine_run: {
    files: [
      { path: "SKILL.md", content: "# Test Skill\n\nA skill for testing.\n\n## Instructions\n\nFollow these steps..." },
      { path: "references/glossary.md", content: "# Glossary\n\n- **Term**: Definition" },
      { path: "references/checklist.md", content: "# Delivery Checklist\n\n- Validate inputs\n- Log failures\n- Add regression coverage" },
      { path: "references/troubleshooting.md", content: "# Troubleshooting\n\n## Common failures\n\n- Missing configuration\n- Invalid payload shape\n- Timeout during sync" },
    ],
    diff: { stat: "no changes", files: [] },
    commit_sha: null,
  },
  // Auth
  github_get_user: null,
  github_logout: undefined,
  // Repos
  list_user_repos: [],
  validate_remote_repo: undefined,
  // Plugins
  list_plugins: [
    { id: 1, slug: "skills", display_name: "Skills", version: null, source_type: "synthetic", source_url: null, is_default: true },
  ],
  // Imported skills (Skills Library page)
  list_imported_skills: [],
  list_workspace_skills: [],
  // Skill history (WorkspaceOverview version history)
  get_skill_history: [],
  get_externally_locked_skills: [],
  upload_skill: {
    skill_id: "skill-001",
    skill_name: "test-skill",
    domain: "testing",
    description: "A test skill",
    is_active: true,
    disk_path: `${E2E_SKILLS_PATH}/test-skill`,
    trigger_text: "When testing...",
    imported_at: new Date().toISOString(),
    is_bundled: false,
  },
  delete_imported_skill: undefined,
get_skill_content: "# Test Skill\n\nThis is a test skill.\n\n## Instructions\n\nFollow these steps...",
  list_skill_files: [],
  // GitHub import
  parse_github_url: { owner: "test-owner", repo: "test-repo", branch: "main", subpath: null },
  list_github_plugins: [
    { path: "plugins/analytics", name: "analytics", description: "Analytics plugin", version: "1.0.0", skill_count: 0, skill_names: [] },
    { path: "plugins/reporting", name: "reporting", description: "Reporting plugin", version: "1.0.0", skill_count: 0, skill_names: [] },
  ],
  list_github_skills: [
    { path: "skills/analytics", name: "analytics", domain: "Data", description: "Analytics skill" },
    { path: "skills/reporting", name: "reporting", domain: "Data", description: "Reporting skill" },
  ],
  import_marketplace_plugin_to_library: [{ success: true, error: null }],
  import_github_skills: [
    {
      skill_id: "imported-001",
      skill_name: "analytics",
      domain: "Data",
      description: "Analytics skill",
      is_active: true,
      disk_path: `${E2E_SKILLS_PATH}/analytics`,
      trigger_text: null,
      imported_at: new Date().toISOString(),
      is_bundled: false,
    },
  ],
  // File import
  parse_skill_file: {
    name: "imported-skill",
    description: "A skill imported from a file",
    version: "1.2.0",
    model: null,
    argument_hint: null,
    user_invocable: false,
    disable_model_invocation: false,
  },
  import_skill_from_file: "imported-skill",
  // Models (available from API key)
  list_models: [],
  // Usage
  get_usage_summary: { total_cost: 0, total_runs: 0, avg_cost_per_run: 0 },
  get_recent_workflow_sessions: [],
  get_agent_runs: [],
  get_session_agent_runs: [],
  get_usage_by_step: [],
  get_usage_by_model: [],
  get_usage_by_day: [],
  get_workflow_skill_names: [],
  reset_usage: undefined,
  // Transition gate (answer evaluator)
  run_answer_evaluator: "gate-agent-001",
  log_gate_decision: undefined,
  // Workflow extras
  write_file: undefined,
  materialize_answer_evaluation_output: undefined,
  materialize_workflow_step_output: undefined,
  get_disabled_steps: [],
  end_workflow_session: undefined,
  navigate_back_to_step: undefined,
  preview_step_reset: [],
  get_step_agent_runs: [],
  verify_step_output: true,
  read_latest_benchmark: null,
  "plugin:log|log": undefined,
  // Evals tab
  list_test_cases: [
    {
      id: 1,
      eval_name: "Customer onboarding flow",
      slug: "customer-onboarding-flow",
      prompt: "Run a typical customer onboarding.",
      files: [],
      expectations: ["Should greet user"],
    },
    {
      id: 2,
      eval_name: "Error handling scenario",
      slug: "error-handling-scenario",
      prompt: "Trigger an error path.",
      files: [],
      expectations: ["Should return error"],
    },
  ],
  list_iterations: [],
  create_next_iteration_dir: [1, `${E2E_ROOT}/workspace/test-skill/evals/iterations/iteration-1`],
  materialize_eval_benchmark: {
    skill_name: "test-skill",
    iteration: 1,
    run_count: 1,
    eval_ids: [1, 2],
    runs: [
      {
        run_index: 0,
        evals: [
          {
            eval_id: 1,
            eval_name: "Customer onboarding flow",
            slug: "customer-onboarding-flow",
            grading_path: "run-0/eval-1-customer-onboarding-flow/grading.json",
            summary: { passed: 1, failed: 0, total: 1, pass_rate: 1.0 },
          },
          {
            eval_id: 2,
            eval_name: "Error handling scenario",
            slug: "error-handling-scenario",
            grading_path: "run-0/eval-2-error-handling-scenario/grading.json",
            summary: { passed: 0, failed: 1, total: 1, pass_rate: 0.0 },
          },
        ],
        run_summary: { passed: 1, failed: 1, total: 2, pass_rate: 0.5 },
      },
    ],
    aggregate_summary: {
      avg_pass_rate: 0.5,
      total_passed: 1,
      total_failed: 1,
      total_assertions: 2,
      has_failures: true,
    },
  },
  read_iteration_result: null,
  save_test_case: {
    id: 3,
    eval_name: "New eval",
    slug: "new-eval",
    prompt: ".",
    files: [],
    expectations: [],
  },
  delete_test_case: undefined,
  read_skill_context_for_eval_gen: {
    skill_content: "# Test Skill\n\nDoes something.",
    existing_evals: [],
  },
  read_pending_eval: null,
  discard_pending_eval: undefined,
  read_grading: null,
};

function normalizeListSkills(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((skill) => {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) return skill;
    const record = skill as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const libraryKey =
      typeof record.library_key === "string" || record.library_key === null
        ? record.library_key
        : (name || null);
    const skillSource =
      typeof record.skill_source === "string" || record.skill_source === null
        ? record.skill_source
        : "skill-builder";
    const pluginSlug =
      typeof record.plugin_slug === "string"
        ? record.plugin_slug
        : "skills";
    const pluginDisplayName =
      typeof record.plugin_display_name === "string"
        ? record.plugin_display_name
        : "Skills";
    const isDefaultPlugin =
      typeof record.is_default_plugin === "boolean"
        ? record.is_default_plugin
        : true;
    return {
      ...record,
      library_key: libraryKey,
      skill_source: skillSource,
      plugin_slug: pluginSlug,
      plugin_display_name: pluginDisplayName,
      is_default_plugin: isDefaultPlugin,
    };
  });
}

/** Normalize path separators to forward slashes for OS-agnostic comparison. */
function normalizeSep(p: string): string {
  return p.replace(/\\/g, "/");
}

function resolveReadFileMock(
  value: unknown,
  args?: Record<string, unknown>,
): unknown {
  // Back-compat: direct string payload.
  if (typeof value === "string") return value;

  // Path-keyed map payload:
  // {
  //   "/abs/path/to/file": "content",
  //   "*": "fallback content"
  // }
  // Both the incoming path arg and map keys are normalized to forward
  // slashes so lookups work regardless of OS path separator conventions.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rawPathArg = typeof args?.filePath === "string"
      ? args.filePath
      : (typeof args?.path === "string" ? args.path : null);
    const map = value as Record<string, unknown>;
    if (rawPathArg) {
      const normalizedArg = normalizeSep(rawPathArg);
      // Try direct match first (fast path), then normalized comparison
      if (normalizedArg in map) return map[normalizedArg];
      for (const key of Object.keys(map)) {
        if (key !== "*" && normalizeSep(key) === normalizedArg) return map[key];
      }
    }
    if ("*" in map) return map["*"];
  }

  return value;
}

function resolveContextFilePathCandidates(
  args?: Record<string, unknown>,
  skillsPathOverride?: string | null,
): string[] {
  const skillName = typeof args?.skillName === "string" ? args.skillName : "";
  const workspacePath = typeof args?.workspacePath === "string" ? args.workspacePath : "";
  const fileName = typeof args?.fileName === "string" ? args.fileName : "";

  const requestedFile = fileName || "clarifications.json";
  const skillsPath = skillsPathOverride ?? defaultSettings.skills_path;

  const candidates: string[] = [];
  if (skillsPath && skillName) {
    candidates.push(`${skillsPath}/${skillName}/context/${requestedFile}`);
  }
  if (workspacePath && skillName) {
    candidates.push(`${workspacePath}/${skillName}/context/${requestedFile}`);
  }
  return candidates;
}

function resolveContextFileCommand(
  cmd: string,
  args: Record<string, unknown> | undefined,
  readFileSource: unknown,
  skillsPathOverride?: string | null,
): unknown {
  const fileName = cmd === "get_clarifications_content"
    ? "clarifications.json"
    : cmd === "get_decisions_content"
      ? "decisions.json"
      : (typeof args?.fileName === "string" ? args.fileName : "");

  const candidates = resolveContextFilePathCandidates({ ...(args ?? {}), fileName }, skillsPathOverride);
  for (const candidate of candidates) {
    const resolved = resolveReadFileMock(readFileSource, { filePath: candidate, path: candidate });
    if (typeof resolved === "string") return resolved;
  }

  // Fall back to wildcard/opaque read_file behavior.
  return resolveReadFileMock(readFileSource, args);
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Optional invoke tracking: tests set __TAURI_TRACK_INVOKES__ to a command list,
  // and calls are recorded in __TAURI_TRACKED_INVOKES__ for later assertions.
  const w = window as unknown as Record<string, unknown>;
  const tracked = w.__TAURI_TRACK_INVOKES__ as string[] | undefined;
  if (tracked?.includes(cmd)) {
    const log = (w.__TAURI_TRACKED_INVOKES__ ?? []) as Array<{ cmd: string; args: unknown }>;
    log.push({ cmd, args: args ? { ...args } : undefined });
    w.__TAURI_TRACKED_INVOKES__ = log;
  }

  // Allow tests to override via window
  const overrides = (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ as
    | Record<string, unknown>
    | undefined;
  if (overrides && cmd in overrides) {
    let val = overrides[cmd];
    if (cmd === "list_skills") {
      val = normalizeListSkills(val);
    }
    if (cmd === "read_file") {
      val = resolveReadFileMock(val, args);
    }
    if (typeof val === "string" && val.startsWith("__throw__:")) {
      throw new Error(val.slice("__throw__:".length));
    }
    if (val instanceof Error) throw val;
    return val as T;
  }

  if (
    cmd === "get_clarifications_content"
    || cmd === "get_decisions_content"
    || cmd === "get_context_file_content"
  ) {
    const skillsPathOverride =
      overrides
      && typeof overrides.get_settings === "object"
      && overrides.get_settings !== null
      && !Array.isArray(overrides.get_settings)
      && typeof (overrides.get_settings as Record<string, unknown>).skills_path === "string"
      ? (overrides.get_settings as Record<string, unknown>).skills_path as string
      : null;
    const readSource = overrides && "read_file" in overrides
      ? overrides.read_file
      : mockResponses.read_file;
    return resolveContextFileCommand(cmd, args, readSource, skillsPathOverride) as T;
  }

  if (cmd in mockResponses) {
    let val = mockResponses[cmd];
    if (cmd === "list_skills") {
      val = normalizeListSkills(val);
    }
    if (cmd === "read_file") {
      val = resolveReadFileMock(val, args);
    }
    return val as T;
  }

  console.warn(`[tauri-e2e-mock] Unhandled invoke: ${cmd}`, args);
  return undefined as T;
}
