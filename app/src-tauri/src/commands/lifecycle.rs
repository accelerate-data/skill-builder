// Lifecycle commands — window close guard and shutdown orchestration.
// has_running_agents was removed in VU-470: the close guard now uses
// in-memory state (workflow isRunning/gateLoading, refine/test isRunning)
// instead of querying the agent_runs table, so no Tauri command is needed.
