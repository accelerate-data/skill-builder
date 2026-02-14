import type { AppSettings, SkillSummary } from "@/lib/tauri";
import type { AgentMessage } from "@/stores/agent-store";

// --- Settings fixtures ---

export function makeAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    anthropic_api_key: null,
    workspace_path: null,
    skills_path: null,
    preferred_model: null,
    debug_mode: false,
    log_level: "info",
    extended_context: false,
    extended_thinking: false,
    splash_shown: false,
    github_pat: null,
    ...overrides,
  };
}

// --- Skill fixtures ---

export function makeSkillSummary(overrides?: Partial<SkillSummary>): SkillSummary {
  return {
    name: "test-skill",
    domain: "testing",
    current_step: "Step 1: Research Concepts",
    status: "in_progress",
    last_modified: "2026-01-15T10:00:00Z",
    tags: [],
    skill_type: null,
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
