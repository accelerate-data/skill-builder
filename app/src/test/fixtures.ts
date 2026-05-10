import type { AppSettings, SkillSummary } from "@/lib/tauri";
import type { DisplayItem } from "@/lib/display-types";

// --- Settings fixtures ---

export function makeAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    workspace_path: null,
    skills_path: null,
    log_level: "info",
    extended_context: false,
    splash_shown: false,
    github_oauth_token: null,
    github_user_login: null,
    github_user_avatar: null,
    github_user_email: null,
    marketplace_registries: [],
    marketplace_initialized: false,
    max_dimensions: 8,
    industry: null,
    function_role: null,
    dashboard_view_mode: null,
    auto_update: false,
    ...overrides,
  };
}

// --- Skill fixtures ---

export function makeSkillSummary(overrides?: Partial<SkillSummary>): SkillSummary {
  return {
    id: 1,
    name: "test-skill",
    current_step: "Step 1: Research",
    status: "in_progress",
    last_modified: "2026-01-15T10:00:00Z",
    tags: [],
    purpose: null,
    author_login: null,
    author_avatar: null,
    intake_json: null,
    source: null,
    plugin_slug: "skills",
    plugin_display_name: "Skills",
    is_default_plugin: true,
    ...overrides,
  };
}

// --- Display item fixtures ---

export function makeDisplayItem(overrides?: Partial<DisplayItem>): DisplayItem {
  return {
    id: `di-${Date.now()}`,
    type: "output",
    timestamp: Date.now(),
    outputText: "Analyzing domain...",
    ...overrides,
  };
}
