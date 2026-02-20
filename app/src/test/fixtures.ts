import type { AppSettings, SkillSummary } from "@/lib/tauri";
import type { AgentMessage } from "@/stores/agent-store";

// --- Settings fixtures ---

export function makeAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    anthropic_api_key: null,
    workspace_path: null,
    skills_path: null,
    preferred_model: null,
    log_level: "info",
    extended_context: false,
    extended_thinking: false,
    splash_shown: false,
    github_oauth_token: null,
    github_user_login: null,
    github_user_avatar: null,
    github_user_email: null,
    remote_repo_owner: null,
    remote_repo_name: null,
    max_dimensions: 8,
    industry: null,
    function_role: null,
    dashboard_view_mode: null,
    ...overrides,
  };
}

// --- Skill fixtures ---

export function makeSkillSummary(overrides?: Partial<SkillSummary>): SkillSummary {
  return {
    name: "test-skill",
    domain: "testing",
    current_step: "Step 1: Research",
    status: "in_progress",
    last_modified: "2026-01-15T10:00:00Z",
    tags: [],
    skill_type: null,
    author_login: null,
    author_avatar: null,
    intake_json: null,
    ...overrides,
  };
}

// --- Agent fixtures ---

export function makeAgentMessage(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    type: "assistant",
    content: "Analyzing domain...",
    raw: {},
    timestamp: Date.now(),
    ...overrides,
  };
}
