import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, PackageResult, ReconciliationResult, DeviceFlowResponse, GitHubAuthResult, GitHubUser, AgentRunRecord, WorkflowSessionRecord, UsageSummary, UsageByStep, UsageByModel, UsageByDay, ImportedSkill, WorkspaceSkill, GitHubRepoInfo, AvailableSkill, SkillFileContent, SkillSummary, RefineDiff, RefineFinalizeResult, RefineSessionInfo, MarketplaceImportResult, MarketplaceUpdateResult, SkillMetadataOverride, SkillFileMeta } from "@/lib/types";

// Re-export invoke for flexible Tauri command invocation
export { invoke };

// Re-export shared types so existing imports from "@/lib/tauri" continue to work
export type { AppSettings, SkillSummary, NodeStatus, PackageResult, ReconciliationResult, DeviceFlowResponse, GitHubAuthResult, GitHubUser, AgentRunRecord, WorkflowSessionRecord, UsageSummary, UsageByStep, UsageByModel, UsageByDay, ImportedSkill, WorkspaceSkill, GitHubRepoInfo, AvailableSkill, SkillFileContent, RefineDiff, RefineFinalizeResult, RefineSessionInfo, MarketplaceImportResult, MarketplaceUpdateResult, SkillMetadataOverride, SkillUpdateInfo, SkillFileMeta } from "@/lib/types";

export interface WorkspaceSkillImportRequest {
  path: string;
  purpose: string | null;
  metadata_override: SkillMetadataOverride | null;
  version: string | null;
}

// --- Settings ---

export const getSettings = () => invoke<AppSettings>("get_settings");

export const saveSettings = (settings: AppSettings) =>
  invoke<void>("save_settings", { settings });

export const testApiKey = (apiKey: string) =>
  invoke<boolean>("test_api_key", { apiKey });

export const getDataDir = () => invoke<string>("get_data_dir");

export const getDefaultSkillsPath = () => invoke<string>("get_default_skills_path");

// --- Skills ---

export const deleteSkill = (workspacePath: string, name: string) =>
  invoke("delete_skill", { workspacePath, name });

export const updateSkillTags = (skillName: string, tags: string[]) =>
  invoke("update_skill_tags", { skillName, tags });

export const updateSkillMetadata = (
  skillName: string,
  purpose: string | null,
  tags: string[] | null,
  intakeJson: string | null,
  description?: string | null,
  version?: string | null,
  model?: string | null,
  argumentHint?: string | null,
  userInvocable?: boolean | null,
  disableModelInvocation?: boolean | null,
) => invoke("update_skill_metadata", {
  skillName,
  purpose,
  tags,
  intakeJson,
  description: description ?? null,
  version: version ?? null,
  model: model ?? null,
  argumentHint: argumentHint ?? null,
  userInvocable: userInvocable ?? null,
  disableModelInvocation: disableModelInvocation ?? null,
});

export const renameSkill = (
  oldName: string,
  newName: string,
  workspacePath: string,
) => invoke("rename_skill", { oldName, newName, workspacePath });

export interface FieldSuggestions {
  description: string;
  domain: string;
  audience: string;
  challenges: string;
  scope: string;
  unique_setup: string;
  claude_mistakes: string;
  context_questions: string;
}

export const generateSuggestions = (
  skillName: string,
  purpose: string,
  opts?: {
    industry?: string | null;
    functionRole?: string | null;
    domain?: string;
    scope?: string;
    audience?: string;
    challenges?: string;
    fields?: string[];
  },
) => invoke<FieldSuggestions>("generate_suggestions", {
  skillName,
  purpose,
  industry: opts?.industry ?? null,
  functionRole: opts?.functionRole ?? null,
  domain: opts?.domain ?? null,
  scope: opts?.scope ?? null,
  audience: opts?.audience ?? null,
  challenges: opts?.challenges ?? null,
  fields: opts?.fields ?? null,
});

// --- Agent ---

export const startAgent = (
  agentId: string,
  prompt: string,
  model: string,
  cwd: string,
  allowedTools?: string[],
  maxTurns?: number,
  permissionMode?: string,
  sessionId?: string,
  skillName?: string,
  stepLabel?: string,
  agentName?: string,
  transcriptLogDir?: string,
  stepId?: number,
  workflowSessionId?: string,
  usageSessionId?: string,
  runSource?: string,
) => invoke<string>("start_agent", {
  agentId, prompt, model, cwd, allowedTools, maxTurns,
  permissionMode: permissionMode ?? null, sessionId,
  skillName: skillName ?? "unknown", stepLabel: stepLabel ?? "unknown",
  agentName: agentName ?? null, transcriptLogDir: transcriptLogDir ?? null,
  stepId: stepId ?? null,
  workflowSessionId: workflowSessionId ?? null,
  usageSessionId: usageSessionId ?? null,
  runSource: runSource ?? null,
});

// --- Workflow ---

export const runWorkflowStep = (
  skillName: string,
  stepId: number,
  workspacePath: string,
  workflowSessionId?: string,
) => invoke<string>("run_workflow_step", { skillName, stepId, workspacePath, workflowSessionId: workflowSessionId ?? null });

export const materializeWorkflowStepOutput = (
  skillName: string,
  stepId: number,
  structuredOutput: unknown,
) => invoke<void>("materialize_workflow_step_output", {
  skillName,
  stepId,
  structuredOutput,
});

export const packageSkill = (
  skillName: string,
  workspacePath: string,
) => invoke<PackageResult>("package_skill", { skillName, workspacePath });

export const resetWorkflowStep = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invoke("reset_workflow_step", { workspacePath, skillName, fromStepId });

/** Navigate back to a completed step: preserves target step's output files,
 *  resets only subsequent steps in DB, and sets current_step = targetStepId.
 *  Use this instead of resetWorkflowStep when the target step should stay "completed". */
export const navigateBackToStepDb = (
  workspacePath: string,
  skillName: string,
  targetStepId: number,
): Promise<void> => invoke<void>("navigate_back_to_step", { workspacePath, skillName, targetStepId });

export interface StepResetPreview {
  step_id: number;
  step_name: string;
  files: string[];
}

export const previewStepReset = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invoke<StepResetPreview[]>("preview_step_reset", { workspacePath, skillName, fromStepId });

export const verifyStepOutput = (
  workspacePath: string,
  skillName: string,
  stepId: number,
) => invoke<boolean>("verify_step_output", { workspacePath, skillName, stepId });

export const getDisabledSteps = (skillName: string) =>
  invoke<number[]>("get_disabled_steps", { skillName });

// --- Workflow State (SQLite) ---

interface WorkflowRunRow {
  skill_name: string;
  current_step: number;
  status: string;
  purpose: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowStepRow {
  skill_name: string;
  step_id: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

interface WorkflowStateResponse {
  run: WorkflowRunRow | null;
  steps: WorkflowStepRow[];
}

interface StepStatusUpdate {
  step_id: number;
  status: string;
}

export const getWorkflowState = (skillName: string) =>
  invoke<WorkflowStateResponse>("get_workflow_state", { skillName });

export const saveWorkflowState = (
  skillName: string,
  currentStep: number,
  status: string,
  stepStatuses: StepStatusUpdate[],
  purpose?: string,
) => invoke("save_workflow_state", { skillName, currentStep, status, stepStatuses, purpose: purpose ?? "domain" });

// --- Files ---

export const readFile = (filePath: string) =>
  invoke<string>("read_file", { filePath });

export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });

export const listSkillFiles = (workspacePath: string, skillName: string) =>
  invoke<import("./types").SkillFileEntry[]>("list_skill_files", { workspacePath, skillName });

// --- Lifecycle ---

export const getWorkspacePath = () =>
  invoke<string>("get_workspace_path");

/** Shut down the persistent sidecar process for a skill (fire-and-forget). */
export const cleanupSkillSidecar = (skillName: string) =>
  invoke<void>("cleanup_skill_sidecar", { skillName });

/** Graceful shutdown: stop all sidecars, release locks, end sessions. */
export const gracefulShutdown = () =>
  invoke<void>("graceful_shutdown");

// --- Workflow Sessions ---

export const createWorkflowSession = (sessionId: string, skillName: string) =>
  invoke<void>("create_workflow_session", { sessionId, skillName });

export const endWorkflowSession = (sessionId: string) =>
  invoke<void>("end_workflow_session", { sessionId });

// --- Reconciliation ---

export const reconcileStartup = (apply = false) =>
  apply
    ? invoke<ReconciliationResult>("reconcile_startup", { apply: true })
    : invoke<ReconciliationResult>("reconcile_startup");

export const recordReconciliationCancel = (
  notificationCount: number,
  discoveredCount: number,
) =>
  invoke<void>("record_reconciliation_cancel", {
    notificationCount,
    discoveredCount,
  });

export const resolveOrphan = (skillName: string, action: "delete" | "keep") =>
  invoke("resolve_orphan", { skillName, action });

export const resolveDiscovery = (skillName: string, action: string) =>
  invoke<void>("resolve_discovery", { skillName, action });

// --- Feedback ---

interface CreateGithubIssueRequest {
  title: string;
  body: string;
  labels: string[];
}

interface CreateGithubIssueResponse {
  url: string;
  number: number;
}

export const createGithubIssue = (request: CreateGithubIssueRequest) =>
  invoke<CreateGithubIssueResponse>("create_github_issue", { request });

// --- GitHub OAuth ---

export const githubStartDeviceFlow = () =>
  invoke<DeviceFlowResponse>("github_start_device_flow");

export const githubPollForToken = (deviceCode: string) =>
  invoke<GitHubAuthResult>("github_poll_for_token", { deviceCode });

export const githubGetUser = () =>
  invoke<GitHubUser | null>("github_get_user");

export const githubLogout = () =>
  invoke<void>("github_logout");

// --- Skill Locks ---

interface SkillLock {
  skill_name: string;
  instance_id: string;
  pid: number;
  acquired_at: string;
}

export const acquireLock = (skillName: string) =>
  invoke<void>("acquire_lock", { skillName });

export const releaseLock = (skillName: string) =>
  invoke<void>("release_lock", { skillName });

export const getLockedSkills = () =>
  invoke<SkillLock[]>("get_locked_skills");

// --- Usage Tracking ---

export const getUsageSummary = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invoke<UsageSummary>("get_usage_summary", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getRecentWorkflowSessions = (limit: number = 50, hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invoke<WorkflowSessionRecord[]>("get_recent_workflow_sessions", { limit, hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getSessionAgentRuns = (sessionId: string) =>
  invoke<AgentRunRecord[]>("get_session_agent_runs", { sessionId });

export const getStepAgentRuns = (skillName: string, stepId: number) =>
  invoke<AgentRunRecord[]>("get_step_agent_runs", { skillName, stepId });

export const getAgentRuns = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null, modelFamily?: string | null, limit: number = 500) =>
  invoke<AgentRunRecord[]>("get_agent_runs", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null, modelFamily: modelFamily ?? null, limit });

export const getUsageByStep = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invoke<UsageByStep[]>("get_usage_by_step", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getUsageByModel = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invoke<UsageByModel[]>("get_usage_by_model", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getUsageByDay = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invoke<UsageByDay[]>("get_usage_by_day", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getWorkflowSkillNames = () =>
  invoke<string[]>("get_workflow_skill_names");

export const resetUsage = () =>
  invoke<void>("reset_usage");

// --- Imported Skills ---

export const exportSkill = (skillName: string) =>
  invoke<string>("export_skill", { skillName });

export async function getInstalledSkillNames(): Promise<string[]> {
  return invoke<string[]>("get_installed_skill_names")
}

export async function getDashboardSkillNames(): Promise<string[]> {
  return invoke<string[]>("get_dashboard_skill_names")
}

export async function listSkills(workspacePath: string, sourceUrl?: string | null): Promise<SkillSummary[]> {
  return invoke<SkillSummary[]>("list_skills", {
    workspacePath,
    sourceUrl: sourceUrl ?? null,
  })
}

export const listWorkspaceSkills = (sourceUrl?: string | null) =>
  invoke<WorkspaceSkill[]>("list_workspace_skills", { sourceUrl: sourceUrl ?? null })

// --- GitHub Import ---

export const parseGitHubUrl = (url: string) =>
  invoke<GitHubRepoInfo>("parse_github_url", { url });

/** Validates the URL and returns the registry name from marketplace.json. */
export const checkMarketplaceUrl = (url: string) =>
  invoke<string>("check_marketplace_url", { url });

export const listGitHubSkills = (owner: string, repo: string, branch: string, subpath?: string) =>
  invoke<AvailableSkill[]>("list_github_skills", { owner, repo, branch, subpath: subpath ?? null });

export const importGitHubSkills = (owner: string, repo: string, branch: string, skillRequests: WorkspaceSkillImportRequest[], sourceUrl?: string | null) =>
  invoke<ImportedSkill[]>("import_github_skills", { owner, repo, branch, skillRequests, sourceUrl: sourceUrl ?? null });

export const setWorkspaceSkillPurpose = (skillId: string, purpose: string | null) =>
  invoke<void>("set_workspace_skill_purpose", { skillId, purpose });

// --- Marketplace Import ---

export const importMarketplaceToLibrary = (skillPaths: string[], sourceUrl: string, metadataOverrides?: Record<string, SkillMetadataOverride>) =>
  invoke<MarketplaceImportResult[]>("import_marketplace_to_library", { sourceUrl, skillPaths, metadataOverrides: metadataOverrides ?? null })

export const checkMarketplaceUpdates = (): Promise<MarketplaceUpdateResult> =>
  invoke<MarketplaceUpdateResult>("check_marketplace_updates")

export const checkSkillCustomized = (skillName: string): Promise<boolean> =>
  invoke<boolean>("check_skill_customized", { skillName })

// --- Refine ---

export const listRefinableSkills = (workspacePath: string) =>
  invoke<SkillSummary[]>("list_refinable_skills", { workspacePath })

export const getSkillContentForRefine = (skillName: string, workspacePath: string) =>
  invoke<SkillFileContent[]>("get_skill_content_for_refine", { skillName, workspacePath })

export const getRefineDiff = (skillName: string, workspacePath: string) =>
  invoke<RefineDiff>("get_refine_diff", { skillName, workspacePath })

export const startRefineSession = (skillName: string, workspacePath: string) =>
  invoke<RefineSessionInfo>("start_refine_session", { skillName, workspacePath })

export const closeRefineSession = (sessionId: string) =>
  invoke<void>("close_refine_session", { sessionId })

export const sendRefineMessage = (
  sessionId: string,
  userMessage: string,
  workspacePath: string,
  targetFiles?: string[],
  command?: string,
) => invoke<string>("send_refine_message", { sessionId, userMessage, workspacePath, targetFiles: targetFiles ?? null, command: command ?? null })

export const materializeRefineValidationOutput = (
  skillName: string,
  workspacePath: string,
  structuredOutput: unknown,
) => invoke<void>("materialize_refine_validation_output", {
  skillName,
  workspacePath,
  structuredOutput,
})

export const finalizeRefineRun = (
  skillName: string,
  workspacePath: string,
  structuredOutput?: unknown,
) => invoke<RefineFinalizeResult>("finalize_refine_run", {
  skillName,
  workspacePath,
  structuredOutput: structuredOutput ?? null,
})

// --- Answer Evaluation (Transition Gate) ---

export type PerQuestionVerdict =
  | {
    question_id: string;
    verdict: "clear" | "needs_refinement" | "not_answered";
  }
  | {
    question_id: string;
    verdict: "vague";
    reason: string;
  }
  | {
    question_id: string;
    verdict: "contradictory";
    reason: string;
    contradicts: string;
  };

export interface AnswerEvaluation {
  verdict: "sufficient" | "mixed" | "insufficient";
  answered_count: number;
  empty_count: number;
  vague_count: number;
  contradictory_count?: number;
  total_count: number;
  reasoning: string;
  per_question?: PerQuestionVerdict[];
}

export const runAnswerEvaluator = (
  skillName: string,
  workspacePath: string,
) => invoke<string>("run_answer_evaluator", { skillName, workspacePath });

export const materializeAnswerEvaluationOutput = (
  skillName: string,
  workspacePath: string,
  structuredOutput: unknown,
) => invoke<void>("materialize_answer_evaluation_output", {
  skillName,
  workspacePath,
  structuredOutput,
});

export const getClarificationsContent = (
  skillName: string,
  workspacePath: string,
) => invoke<string>("get_clarifications_content", { skillName, workspacePath });

export const saveClarificationsContent = (
  skillName: string,
  workspacePath: string,
  content: string,
) => invoke<void>("save_clarifications_content", { skillName, workspacePath, content });

export const getDecisionsContent = (
  skillName: string,
  workspacePath: string,
) => invoke<string>("get_decisions_content", { skillName, workspacePath });

export const saveDecisionsContent = (
  skillName: string,
  workspacePath: string,
  content: string,
) => invoke<void>("save_decisions_content", { skillName, workspacePath, content });

export const getContextFileContent = (
  skillName: string,
  workspacePath: string,
  fileName: string,
) => invoke<string>("get_context_file_content", { skillName, workspacePath, fileName });

export const autofillClarifications = (
  skillName: string,
) => invoke<number>("autofill_clarifications", { skillName });

export const autofillRefinements = (
  skillName: string,
) => invoke<number>("autofill_refinements", { skillName });

export const logGateDecision = (
  skillName: string,
  verdict: string,
  decision: string,
) => invoke<void>("log_gate_decision", { skillName, verdict, decision });

// --- Skill Test ---

export interface PrepareTestResult {
  test_id: string;
  baseline_cwd: string;
  with_skill_cwd: string;
  transcript_log_dir: string;
}

export const prepareSkillTest = (workspacePath: string, skillName: string) =>
  invoke<PrepareTestResult>("prepare_skill_test", { workspacePath, skillName })

export const cleanupSkillTest = (testId: string) =>
  invoke<void>("cleanup_skill_test", { testId })

export const buildTestPlanPrompt = (userPrompt: string) =>
  invoke<string>("build_test_plan_prompt", { userPrompt })

export const buildTestEvaluatorPrompt = (
  userPrompt: string,
  skillName: string,
  withPlanText: string,
  withoutPlanText: string,
) => invoke<string>("build_test_evaluator_prompt", {
  userPrompt,
  skillName,
  withPlanText,
  withoutPlanText,
})

// --- File Import ---

export const parseSkillFile = (filePath: string): Promise<SkillFileMeta> =>
  invoke<SkillFileMeta>("parse_skill_file", { filePath })

export const importSkillFromFile = (params: {
  filePath: string
  name: string
  description: string
  version: string
  model?: string | null
  argumentHint?: string | null
  userInvocable?: boolean | null
  disableModelInvocation?: boolean | null
  forceOverwrite: boolean
}): Promise<string> =>
  invoke<string>("import_skill_from_file", {
    filePath: params.filePath,
    name: params.name,
    description: params.description,
    version: params.version,
    model: params.model ?? null,
    argumentHint: params.argumentHint ?? null,
    userInvocable: params.userInvocable ?? null,
    disableModelInvocation: params.disableModelInvocation ?? null,
    forceOverwrite: params.forceOverwrite,
  })
