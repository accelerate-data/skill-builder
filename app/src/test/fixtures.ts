import type { AppSettings, SkillSummary, FileEntry } from "@/lib/tauri";
import type { AgentMessage } from "@/stores/agent-store";

// --- Settings fixtures ---

export function makeAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    anthropic_api_key: null,
    workspace_path: null,
    ...overrides,
  };
}

// --- Skill fixtures ---

export function makeSkillSummary(overrides?: Partial<SkillSummary>): SkillSummary {
  return {
    name: "test-skill",
    domain: "testing",
    current_step: "Step 1: Research Domain Concepts",
    status: "in_progress",
    last_modified: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

// --- File fixtures ---

export function makeFileEntry(overrides?: Partial<FileEntry>): FileEntry {
  return {
    name: "SKILL.md",
    relative_path: "SKILL.md",
    absolute_path: "/ws/test-skill/SKILL.md",
    is_directory: false,
    is_readonly: false,
    size_bytes: 1024,
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
