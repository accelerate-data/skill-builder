/**
 * E2E mock for Tauri APIs. This file is loaded via vite plugin
 * when TAURI_E2E=true, replacing @tauri-apps/api/core.
 *
 * It provides mock responses for all invoke commands so the frontend
 * can render without the Rust backend.
 */

const defaultSettings = {
  anthropic_api_key: null,
  workspace_path: null,
  preferred_model: null,
  log_level: "info",
};

const mockResponses: Record<string, unknown> = {
  get_settings: defaultSettings,
  save_settings: undefined,
  test_api_key: true,
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
  get_agent_prompt: "# Sample Agent Prompt\n\nThis is a test prompt for the agent.\n\n## Instructions\n\nFollow these steps...",
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
  reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0 },
  // Skill locks
  acquire_lock: undefined,
  release_lock: undefined,
  get_locked_skills: [],
  check_lock: false,
  list_team_repo_skills: [],
  import_team_repo_skill: "imported-skill",
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
