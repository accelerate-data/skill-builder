use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct AgentRunRecord {
    pub agent_id: String,
    pub skill_name: String,
    pub step_id: i32,
    pub model: String,
    pub status: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub cache_read_tokens: i32,
    pub cache_write_tokens: i32,
    pub total_cost: f64,
    pub duration_ms: i64,
    pub num_turns: i32,
    pub stop_reason: Option<String>,
    pub duration_api_ms: Option<i64>,
    pub tool_use_count: i32,
    pub compaction_count: i32,
    pub session_id: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

impl std::fmt::Debug for AgentRunRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentRunRecord")
            .field("agent_id", &self.agent_id)
            .field("skill_name", &self.skill_name)
            .field("step_id", &self.step_id)
            .field("model", &self.model)
            .field("status", &self.status)
            .field("input_tokens", &self.input_tokens)
            .field("output_tokens", &self.output_tokens)
            .field("cache_read_tokens", &self.cache_read_tokens)
            .field("cache_write_tokens", &self.cache_write_tokens)
            .field("total_cost", &self.total_cost)
            .field("duration_ms", &self.duration_ms)
            .field("num_turns", &self.num_turns)
            .field("stop_reason", &self.stop_reason)
            .field("duration_api_ms", &self.duration_api_ms)
            .field("tool_use_count", &self.tool_use_count)
            .field("compaction_count", &self.compaction_count)
            .field("session_id", &"[REDACTED]")
            .field("started_at", &self.started_at)
            .field("completed_at", &self.completed_at)
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct WorkflowSessionRecord {
    pub session_id: String,
    pub skill_name: String,
    pub min_step: i32,
    pub max_step: i32,
    pub steps_csv: String,
    pub agent_count: i32,
    pub total_cost: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read: i64,
    pub total_cache_write: i64,
    pub total_duration_ms: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
}

impl std::fmt::Debug for WorkflowSessionRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkflowSessionRecord")
            .field("session_id", &"[REDACTED]")
            .field("skill_name", &self.skill_name)
            .field("min_step", &self.min_step)
            .field("max_step", &self.max_step)
            .field("steps_csv", &self.steps_csv)
            .field("agent_count", &self.agent_count)
            .field("total_cost", &self.total_cost)
            .field("total_input_tokens", &self.total_input_tokens)
            .field("total_output_tokens", &self.total_output_tokens)
            .field("total_cache_read", &self.total_cache_read)
            .field("total_cache_write", &self.total_cache_write)
            .field("total_duration_ms", &self.total_duration_ms)
            .field("started_at", &self.started_at)
            .field("completed_at", &self.completed_at)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    pub total_cost: f64,
    pub total_runs: i32,
    pub avg_cost_per_run: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByStep {
    pub step_id: i32,
    pub step_name: String,
    pub total_cost: f64,
    pub run_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByModel {
    pub model: String,
    pub total_cost: f64,
    pub run_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByDay {
    pub date: String,
    pub total_cost: f64,
    pub total_tokens: i64,
    pub run_count: i32,
}
