export interface AppSettings {
  anthropic_api_key: string | null
  workspace_path: string | null
}

export interface SkillSummary {
  name: string
  domain: string | null
  current_step: string | null
  status: string | null
  last_modified: string | null
}

export interface NodeStatus {
  available: boolean
  version: string | null
  meets_minimum: boolean
  error: string | null
}

export interface WorkflowStep {
  id: number
  name: string
  description: string
  status: "pending" | "in_progress" | "waiting_for_user" | "completed" | "error"
  agentModel?: string
}

export interface ParallelAgentResult {
  agent_id_a: string
  agent_id_b: string
}

export interface PackageResult {
  file_path: string
  size_bytes: number
}

// --- File Editor Types ---

export interface FileEntry {
  name: string
  relative_path: string
  absolute_path: string
  is_directory: boolean
  is_readonly: boolean
  size_bytes: number
}
