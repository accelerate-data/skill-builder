/**
 * E2E mock for Tauri APIs. This file is loaded via vite plugin
 * when TAURI_E2E=true, replacing @tauri-apps/api/core.
 *
 * It provides mock responses for all invoke commands so the frontend
 * can render without the Rust backend.
 */

const defaultSettings = {
  anthropic_api_key: "sk-ant-test-e2e",
  workspace_path: null,
  skills_path: "/tmp/e2e-skills",
  preferred_model: null,
  log_level: "info",
};

const mockResponses: Record<string, unknown> = {
  get_settings: defaultSettings,
  save_settings: undefined,
  test_api_key: true,
  get_default_skills_path: "/tmp/e2e-skills",
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
      { name: "Node.js", ok: true, detail: "v20.11.0 (system)" },
      { name: "Agent sidecar", ok: true, detail: "sidecar/dist/agent-runner.js" },
      { name: "Claude SDK", ok: true, detail: "sidecar/dist/sdk/cli.js" },
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
  read_file: "",
  check_workspace_path: true,
  has_running_agents: false,
  start_agent: "agent-001",
  run_workflow_step: "agent-001",
  run_parallel_agents: { agent_id_a: "agent-001", agent_id_b: "agent-002" },
  package_skill: { file_path: "/tmp/test/my-skill.skill", size_bytes: 12345 },
  // Workflow state
  get_workflow_state: { run: null, steps: [] },
  save_workflow_state: undefined,
  capture_step_artifacts: [],
  get_artifact_content: null,
  save_artifact_content: undefined,
  reset_workflow_step: undefined,
  // Sidecar lifecycle
  cleanup_skill_sidecar: undefined,
  // Reconciliation
  reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0, discovered_skills: [] },
  // Skill locks
  acquire_lock: undefined,
  release_lock: undefined,
  get_locked_skills: [],
  check_lock: false,
  // Refine page
  start_refine_session: {
    session_id: "e2e-refine-session-001",
    skill_name: "test-skill",
    created_at: new Date().toISOString(),
  },
  send_refine_message: "refine-test-skill-e2e-001",
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
  ],
  // Auth
  github_get_user: null,
  github_logout: undefined,
  // Repos
  list_user_repos: [],
  validate_remote_repo: undefined,
  // Imported skills (Skills Library page)
  list_workspace_skills: [],
  upload_skill: {
    skill_id: "skill-001",
    skill_name: "test-skill",
    domain: "testing",
    description: "A test skill",
    is_active: true,
    disk_path: "/tmp/skills/test-skill",
    trigger_text: "When testing...",
    imported_at: new Date().toISOString(),
    is_bundled: false,
  },
  toggle_skill_active: undefined,
  delete_imported_skill: undefined,
  export_skill: "/tmp/test-skill.zip",
  get_skill_content: "# Test Skill\n\nThis is a test skill.\n\n## Instructions\n\nFollow these steps...",
  // GitHub import
  parse_github_url: { owner: "test-owner", repo: "test-repo", branch: "main", subpath: null },
  list_github_skills: [
    { path: "skills/analytics", name: "analytics", domain: "Data", description: "Analytics skill" },
    { path: "skills/reporting", name: "reporting", domain: "Data", description: "Reporting skill" },
  ],
  import_github_skills: [
    {
      skill_id: "imported-001",
      skill_name: "analytics",
      domain: "Data",
      description: "Analytics skill",
      is_active: true,
      disk_path: "/tmp/skills/analytics",
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
  get_session_agent_runs: [],
  get_usage_by_step: [],
  get_usage_by_model: [],
  reset_usage: undefined,
  // Transition gate (answer evaluator)
  run_answer_evaluator: "gate-agent-001",
  autofill_clarifications: 0,
  log_gate_decision: undefined,
  // Workflow extras
  write_file: undefined,
  get_disabled_steps: [],
  end_workflow_session: undefined,
  preview_step_reset: [],
  get_step_agent_runs: [],
  verify_step_output: true,
};

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Allow tests to override via window
  const overrides = (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ as
    | Record<string, unknown>
    | undefined;
  if (overrides && cmd in overrides) {
    const val = overrides[cmd];
    if (val instanceof Error) throw val;
    return val as T;
  }

  if (cmd in mockResponses) {
    return mockResponses[cmd] as T;
  }

  console.warn(`[tauri-e2e-mock] Unhandled invoke: ${cmd}`, args);
  return undefined as T;
}
