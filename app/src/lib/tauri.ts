import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, AgentRunRecord, WorkflowSessionRecord, UsageSummary, UsageByStep, UsageByModel, UsageByDay, ImportedSkill, LibraryPlugin, GitHubRepoInfo, AvailablePlugin, AvailableSkill, SkillFileContent, SkillSummary, SkillCommit, RefineFinalizeResult, RefineSessionInfo, MarketplaceImportResult, MarketplaceUpdateResult, SkillMetadataOverride, SkillFileMeta, ResearchStepOutput, DetailedResearchOutput, DecisionsOutput, GenerateSkillOutput, AnswerEvaluationOutput, PerQuestionEntry, TestCase, Document } from "@/lib/types";
import type { EvalQuery } from "@/lib/description-optimization";
import type { TauriCommandInvocation, TauriCommandResult } from "@/lib/tauri-command-types";

export const invokeCommand = <Invocation extends TauriCommandInvocation>(
  ...[command, args]: Invocation
) => invoke<TauriCommandResult<Invocation[0]>>(command, args);

/** Escape hatch for commands that have not joined `TauriCommandMap` yet. Prefer `invokeCommand`. */
export const invokeUnsafe = invoke;

/** Write a log message to the Rust app.log file from the frontend. */
export const logFrontend = (level: "info" | "warn" | "error" | "debug", message: string) =>
  invokeUnsafe<void>("log_frontend", { level, message }).catch(() => {});

// Re-export shared types so existing imports from "@/lib/tauri" continue to work
export type { AppSettings, SkillSummary, SkillCommit, NodeStatus, ReconciliationResult, DeviceFlowResponse, GitHubAuthResult, GitHubUser, AgentRunRecord, WorkflowSessionRecord, UsageSummary, UsageByStep, UsageByModel, UsageByDay, ImportedSkill, GitHubRepoInfo, AvailablePlugin, AvailableSkill, SkillFileContent, RefineDiff, RefineFinalizeResult, RefineSessionInfo, MarketplaceImportResult, MarketplaceUpdateResult, SkillMetadataOverride, SkillUpdateInfo, SkillFileMeta, ModelInfo, StartupDeps, ResearchStepOutput, DetailedResearchOutput, DecisionsOutput, GenerateSkillOutput, WorkflowStepStructuredOutput, AnswerEvaluationOutput, PerQuestionEntry, Document } from "@/lib/types";

// --- Settings ---

export const getSettings = () => invokeCommand("get_settings", {});

export const saveSettings = (settings: AppSettings) =>
  invokeCommand("save_settings", { settings });

/** Update user-configurable settings. Backend-owned fields are preserved. */
export const updateUserSettings = (settings: AppSettings) =>
  invokeCommand("update_user_settings", { settings });

/** Update GitHub identity fields. Pass null values to clear (logout). */
export const updateGithubIdentity = (
  login: string | null,
  avatar: string | null,
  email: string | null,
  token: string | null,
) => invokeCommand("update_github_identity", { login, avatar, email, token });

export const testApiKey = (apiKey: string) =>
  invokeCommand("test_api_key", { apiKey });

export const getDataDir = () => invokeCommand("get_data_dir", {});

export const getDefaultSkillsPath = () => invokeCommand("get_default_skills_path", {});

// --- Skills ---

export const deleteSkill = (workspacePath: string, name: string) =>
  invokeUnsafe("delete_skill", { workspacePath, name });

export const updateSkillMetadata = (
  skillName: string,
  pluginSlug: string,
  purpose: string | null,
  tags: string[] | null,
  intakeJson: string | null,
  description?: string | null,
  version?: string | null,
  model?: string | null,
  argumentHint?: string | null,
  userInvocable?: boolean | null,
  disableModelInvocation?: boolean | null,
) => invokeUnsafe("update_skill_metadata", {
  skillName,
  pluginSlug,
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
) => invokeUnsafe("rename_skill", { oldName, newName, workspacePath });

export const exportSkillAsFile = (
  skillName: string,
  pluginSlug: string,
  destPath: string,
) => invokeUnsafe<void>("export_skill_as_file", { skillName, pluginSlug, destPath });

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
) => invokeUnsafe<FieldSuggestions>("generate_suggestions", {
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

export interface ScopeReviewSuggestion {
  name: string
  description: string
}

export interface ScopeReviewResult {
  status: string
  reason: string
  suggested_skills: ScopeReviewSuggestion[]
}

export const reviewSkillScope = (
  skillName: string,
  description: string,
  purpose: string,
  contextQuestions: string | null,
  industry: string | null,
) => invokeUnsafe<ScopeReviewResult>("review_skill_scope", { skillName, description, purpose, contextQuestions, industry })

// --- Agent ---

export const startOneShotAgent = (
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
  systemPrompt?: string,
  pluginSlug?: string,
) => invokeUnsafe<string>("start_agent", {
  agentId, prompt, systemPrompt: systemPrompt ?? null, model, cwd, allowedTools, maxTurns,
  permissionMode: permissionMode ?? null, sessionId,
  skillName: skillName ?? "unknown", stepLabel: stepLabel ?? "unknown",
  agentName: agentName ?? null, transcriptLogDir: transcriptLogDir ?? null,
  stepId: stepId ?? null,
  workflowSessionId: workflowSessionId ?? null,
  usageSessionId: usageSessionId ?? null,
  runSource: runSource ?? null,
  pluginSlug: pluginSlug ?? "skills",
});

// --- Workflow ---

export const runWorkflowStep = (
  skillName: string,
  stepId: number,
  workspacePath: string,
  workflowSessionId?: string,
) => invokeUnsafe<string>("run_workflow_step", { skillName, stepId, workspacePath, workflowSessionId: workflowSessionId ?? null });

export const materializeWorkflowStepOutput = (
  skillName: string,
  stepId: 0 | 1 | 2 | 3,
  structuredOutput: ResearchStepOutput | DetailedResearchOutput | DecisionsOutput | GenerateSkillOutput,
) => invokeUnsafe<void>("materialize_workflow_step_output", {
  skillName,
  stepId,
  structuredOutput,
});

export const resetWorkflowStep = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invokeUnsafe("reset_workflow_step", { workspacePath, skillName, fromStepId });

/** Navigate back to a completed step: preserves target step's output files,
 *  resets only subsequent steps in DB, and sets current_step = targetStepId.
 *  Use this instead of resetWorkflowStep when the target step should stay "completed". */
export const navigateBackToStepDb = (
  workspacePath: string,
  skillName: string,
  targetStepId: number,
): Promise<void> => invokeUnsafe<void>("navigate_back_to_step", { workspacePath, skillName, targetStepId });

export interface StepResetPreview {
  step_id: number;
  step_name: string;
  files: string[];
}

export const previewStepReset = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invokeUnsafe<StepResetPreview[]>("preview_step_reset", { workspacePath, skillName, fromStepId });

export const verifyStepOutput = (
  workspacePath: string,
  skillName: string,
  stepId: number,
) => invokeUnsafe<boolean>("verify_step_output", { workspacePath, skillName, stepId });

export const getDisabledSteps = (skillName: string) =>
  invokeUnsafe<number[]>("get_disabled_steps", { skillName });

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
  invokeUnsafe<WorkflowStateResponse>("get_workflow_state", { skillName });

export const saveWorkflowState = (
  skillName: string,
  currentStep: number,
  status: string,
  stepStatuses: StepStatusUpdate[],
  purpose?: string,
) => invokeUnsafe("save_workflow_state", { skillName, currentStep, status, stepStatuses, purpose: purpose ?? "domain" });

// --- Files ---

export const readFile = (filePath: string) =>
  invokeUnsafe<string>("read_file", { filePath });

export const writeFile = (path: string, content: string) =>
  invokeUnsafe<void>("write_file", { path, content });

export const listSkillFiles = (workspacePath: string, skillName: string) =>
  invokeUnsafe<import("./types").SkillFileEntry[]>("list_skill_files", { workspacePath, skillName });

// --- Lifecycle ---

export const getWorkspacePath = () =>
  invokeUnsafe<string>("get_workspace_path");

/** Shut down the persistent sidecar process for a skill (fire-and-forget). */
export const cleanupSkillSidecar = (skillName: string) =>
  invokeUnsafe<void>("cleanup_skill_sidecar", { skillName });

/** Graceful shutdown: stop all sidecars, release locks, end sessions. */
export const gracefulShutdown = () =>
  invokeUnsafe<void>("graceful_shutdown");

/** Mark the next app/window close as user-confirmed so Tauri lets it exit. */
export const allowAppExit = () =>
  invokeUnsafe<void>("allow_app_exit");

// --- Workflow Sessions ---

export const createWorkflowSession = (sessionId: string, skillName: string) =>
  invokeUnsafe<void>("create_workflow_session", { sessionId, skillName });

export const endWorkflowSession = (sessionId: string) =>
  invokeUnsafe<void>("end_workflow_session", { sessionId });

// --- Reconciliation ---

export const reconcileStartup = (apply = false) =>
  apply
    ? invokeCommand("reconcile_startup", { apply: true })
    : invokeCommand("reconcile_startup", {});

export const recordReconciliationCancel = (
  notificationCount: number,
  discoveredCount: number,
) =>
  invokeCommand("record_reconciliation_cancel", {
    notificationCount,
    discoveredCount,
  });

export const resolveOrphan = (skillName: string, action: "delete" | "keep") =>
  invokeUnsafe("resolve_orphan", { skillName, action });

export const resolveDiscovery = (skillName: string, action: string, pluginSlug?: string | null) =>
  invokeUnsafe<void>("resolve_discovery", { skillName, action, pluginSlug: pluginSlug ?? null });

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
  invokeUnsafe<CreateGithubIssueResponse>("create_github_issue", { request });

// --- GitHub OAuth ---

export const githubStartDeviceFlow = () =>
  invokeCommand("github_start_device_flow", {});

export const githubPollForToken = (deviceCode: string) =>
  invokeCommand("github_poll_for_token", { deviceCode });

export const githubGetUser = () =>
  invokeCommand("github_get_user", {});

export const githubLogout = () =>
  invokeCommand("github_logout", {});

export const acquireLock = (skillName: string) =>
  invokeUnsafe<void>("acquire_lock", { skillName });

export const releaseLock = (skillName: string) =>
  invokeUnsafe<void>("release_lock", { skillName });

export const getExternallyLockedSkills = () =>
  invokeUnsafe<string[]>("get_externally_locked_skills");

// --- Usage Tracking ---

export const getUsageSummary = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeUnsafe<UsageSummary>("get_usage_summary", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getRecentWorkflowSessions = (limit: number = 50, hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeUnsafe<WorkflowSessionRecord[]>("get_recent_workflow_sessions", { limit, hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getStepAgentRuns = (skillName: string, stepId: number) =>
  invokeUnsafe<AgentRunRecord[]>("get_step_agent_runs", { skillName, stepId });

export const getAgentRuns = (
  hideCancelled: boolean = false,
  startDate?: string | null,
  skillName?: string | null,
  modelFilter?: string | null,
  limit: number = 500,
) =>
  invokeUnsafe<AgentRunRecord[]>("get_agent_runs", {
    hideCancelled,
    startDate: startDate ?? null,
    skillName: skillName ?? null,
    modelFilter: modelFilter ?? null,
    limit,
  });

export const getUsageByStep = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeUnsafe<UsageByStep[]>("get_usage_by_step", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getUsageByModel = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeUnsafe<UsageByModel[]>("get_usage_by_model", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getUsageByDay = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeUnsafe<UsageByDay[]>("get_usage_by_day", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getWorkflowSkillNames = () =>
  invokeUnsafe<string[]>("get_workflow_skill_names");

export const resetUsage = () =>
  invokeUnsafe<void>("reset_usage");

// --- Imported Skills ---

export async function getDashboardSkillNames(): Promise<string[]> {
  return invokeUnsafe<string[]>("get_dashboard_skill_names")
}

export async function listSkills(workspacePath: string, sourceUrl?: string | null): Promise<SkillSummary[]> {
  return invokeUnsafe<SkillSummary[]>("list_skills", {
    workspacePath,
    sourceUrl: sourceUrl ?? null,
  })
}

export const listImportedSkills = (sourceUrl?: string | null) =>
  invokeUnsafe<ImportedSkill[]>("list_imported_skills", { sourceUrl: sourceUrl ?? null })

export const deleteImportedSkill = (skillId: string) =>
  invokeUnsafe<void>("delete_imported_skill", { skillId })

export const listPlugins = () =>
  invokeUnsafe<LibraryPlugin[]>("list_plugins")

export const deletePlugin = (pluginSlug: string) =>
  invokeUnsafe<void>("delete_plugin", { pluginSlug })

export const setPluginUpgradeLock = (pluginSlug: string, locked: boolean) =>
  invokeUnsafe<void>("set_plugin_upgrade_lock", { pluginSlug, locked })

export const createPluginFromSkills = (pluginName: string, skillKeys: string[]) =>
  invokeUnsafe<string>("create_plugin_from_skills", { pluginName, skillKeys })

/**
 * Move a skill to a different plugin.
 * @param skillKey - Compound key: "skill-builder:{pluginSlug}:{skillName}" for builder skills,
 *                   "imported:{skillId}" for imported skills
 * @param pluginSlug - Target plugin slug
 */
export const moveSkillToPlugin = (skillKey: string, pluginSlug: string) =>
  invokeUnsafe<void>("move_skill_to_plugin", { skillKey, pluginSlug })

/**
 * Remove a skill from its current plugin, returning it to the default plugin.
 * @param skillKey - Compound key: "skill-builder:{pluginSlug}:{skillName}" for builder skills,
 *                   "imported:{skillId}" for imported skills
 */
export const removeSkillFromPlugin = (skillKey: string) =>
  invokeUnsafe<void>("remove_skill_from_plugin", { skillKey })

// --- GitHub Import ---

export const parseGitHubUrl = (url: string) =>
  invokeUnsafe<GitHubRepoInfo>("parse_github_url", { url });

/** Validates the URL and returns the registry name from marketplace.json. */
export const checkMarketplaceUrl = (url: string) =>
  invokeUnsafe<string>("check_marketplace_url", { url });

export const listGitHubSkills = (owner: string, repo: string, branch: string, subpath?: string) =>
  invokeUnsafe<AvailableSkill[]>("list_github_skills", { owner, repo, branch, subpath: subpath ?? null });

export const listGitHubPlugins = (owner: string, repo: string, branch: string, subpath?: string) =>
  invokeUnsafe<AvailablePlugin[]>("list_github_plugins", { owner, repo, branch, subpath: subpath ?? null });

// --- Marketplace Import ---

export const importMarketplaceToLibrary = (skillPaths: string[], sourceUrl: string, metadataOverrides?: Record<string, SkillMetadataOverride>) =>
  invokeUnsafe<MarketplaceImportResult[]>("import_marketplace_to_library", { sourceUrl, skillPaths, metadataOverrides: metadataOverrides ?? null })

export const importMarketplacePluginToLibrary = (pluginPath: string, pluginName: string, sourceUrl: string) =>
  invokeUnsafe<MarketplaceImportResult[]>("import_marketplace_plugin_to_library", { sourceUrl, pluginPath, pluginName })

export const checkMarketplaceUpdates = (): Promise<MarketplaceUpdateResult> =>
  invokeUnsafe<MarketplaceUpdateResult>("check_marketplace_updates")

export const checkSkillCustomized = (skillName: string): Promise<boolean> =>
  invokeUnsafe<boolean>("check_skill_customized", { skillName })

// --- Refine ---

export const getSkillContentAtPath = (path: string) =>
  invokeUnsafe<SkillFileContent[]>("get_skill_content_at_path", { path })

export const getSkillContentForRefine = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeUnsafe<SkillFileContent[]>("get_skill_content_for_refine", { skillName, workspacePath, pluginSlug })

export const startRefineSession = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeUnsafe<RefineSessionInfo>("start_refine_session", { skillName, pluginSlug, workspacePath })

export const closeRefineSession = (sessionId: string) =>
  invokeUnsafe<void>("close_refine_session", { sessionId })

export const cancelRefineTurn = (sessionId: string) =>
  invokeUnsafe<void>("cancel_refine_turn", { sessionId })

export const cancelAgentRun = (skillName: string, agentId: string) =>
  invokeUnsafe<void>("cancel_agent_run", { skillName, agentId })

export const cancelWorkflowStep = (agentId: string) =>
  invokeUnsafe<void>("cancel_workflow_step", { agentId })

export const answerStreamingRefineQuestion = (
  sessionId: string,
  agentId: string,
  toolUseId: string,
  questions: unknown,
  answers: Record<string, unknown>,
) => invokeUnsafe<void>("answer_refine_question", {
  sessionId,
  agentId,
  toolUseId,
  questions,
  answers,
})

export const sendStreamingRefineMessage = (
  sessionId: string,
  userMessage: string,
  workspacePath: string,
  pluginSlug: string,
  targetFiles?: string[],
) => invokeUnsafe<string>("send_refine_message", { sessionId, userMessage, pluginSlug, workspacePath, targetFiles: targetFiles ?? null, command: null })

export const finalizeRefineRun = (
  skillName: string,
  workspacePath: string,
  pluginSlug: string,
  structuredOutput?: unknown,
) => invokeUnsafe<RefineFinalizeResult>("finalize_refine_run", {
  skillName,
  workspacePath,
  pluginSlug,
  structuredOutput: structuredOutput ?? null,
})

export const cleanBenchmarkSnapshot = (
  skillName: string,
  workspacePath: string,
  pluginSlug: string,
) => invokeUnsafe<void>("clean_benchmark_snapshot", {
  skillName,
  workspacePath,
  pluginSlug,
})

// --- Git History ---

export const getSkillHistory = (
  workspacePath: string,
  skillName: string,
  pluginSlug: string,
  limit?: number,
) => invokeUnsafe<SkillCommit[]>("get_skill_history", {
  workspacePath,
  skillName,
  pluginSlug,
  limit: limit ?? null,
})

export const restoreSkillVersion = (
  workspacePath: string,
  skillName: string,
  pluginSlug: string,
  sha: string,
) => invokeUnsafe<string>("restore_skill_version", {
  workspacePath,
  skillName,
  pluginSlug,
  sha,
})

export const getSkillFilesAtSha = (workspacePath: string, skillName: string, pluginSlug: string, sha: string) =>
  invokeUnsafe<SkillFileContent[]>("get_skill_files_at_sha", { workspacePath, skillName, pluginSlug, sha })

// --- Answer Evaluation (Transition Gate) ---

/** @deprecated Use {@link PerQuestionEntry} from `@/lib/types` instead. */
export type PerQuestionVerdict = PerQuestionEntry;

/** @deprecated Use {@link AnswerEvaluationOutput} from `@/lib/types` instead. */
export type AnswerEvaluation = AnswerEvaluationOutput;

export const runAnswerEvaluator = (
  skillName: string,
  workspacePath: string,
) => invokeUnsafe<string>("run_answer_evaluator", { skillName, workspacePath });

export const materializeAnswerEvaluationOutput = (
  skillName: string,
  workspacePath: string,
  structuredOutput: AnswerEvaluationOutput,
) => invokeUnsafe<void>("materialize_answer_evaluation_output", {
  skillName,
  workspacePath,
  structuredOutput,
});

export const getClarificationsContent = (
  skillName: string,
  workspacePath: string,
) => invokeUnsafe<string>("get_clarifications_content", { skillName, workspacePath });

export const saveClarificationsContent = (
  skillName: string,
  workspacePath: string,
  content: string,
) => invokeUnsafe<void>("save_clarifications_content", { skillName, workspacePath, content });

export const getDecisionsContent = (
  skillName: string,
  workspacePath: string,
) => invokeUnsafe<string>("get_decisions_content", { skillName, workspacePath });

export const saveDecisionsContent = (
  skillName: string,
  workspacePath: string,
  content: string,
) => invokeUnsafe<void>("save_decisions_content", { skillName, workspacePath, content });

export const getContextFileContent = (
  skillName: string,
  workspacePath: string,
  fileName: string,
) => invokeUnsafe<string>("get_context_file_content", { skillName, workspacePath, fileName });

export const logGateDecision = (
  skillName: string,
  verdict: string,
  decision: string,
) => invokeUnsafe<void>("log_gate_decision", { skillName, verdict, decision });

// --- File Import ---

export const parseSkillFile = (filePath: string): Promise<SkillFileMeta> =>
  invokeUnsafe<SkillFileMeta>("parse_skill_file", { filePath })

export const importSkillFromFile = (params: {
  filePath: string
  name: string
  description: string
  version: string
  model?: string | null
  argumentHint?: string | null
  userInvocable?: boolean | null
  disableModelInvocation?: boolean | null
}): Promise<string> =>
  invokeUnsafe<string>("import_skill_from_file", {
    filePath: params.filePath,
    name: params.name,
    description: params.description,
    version: params.version,
    model: params.model ?? null,
    argumentHint: params.argumentHint ?? null,
    userInvocable: params.userInvocable ?? null,
    disableModelInvocation: params.disableModelInvocation ?? null,
  })

// --- Additional typed wrappers ---

export const listModels = (apiKey: string) =>
  invokeCommand("list_models", { apiKey });

export const createSkill = (params: {
  workspacePath: string;
  name: string;
  tags?: string[] | null;
  purpose?: string | null;
  intakeJson?: string | null;
  description?: string | null;
  version?: string | null;
  model?: string | null;
  argumentHint?: string | null;
  userInvocable?: boolean | null;
  disableModelInvocation?: boolean | null;
}) => invokeUnsafe<void>("create_skill", {
  workspacePath: params.workspacePath,
  name: params.name,
  tags: params.tags ?? null,
  purpose: params.purpose ?? null,
  intakeJson: params.intakeJson ?? null,
  description: params.description ?? null,
  version: params.version ?? null,
  model: params.model ?? null,
  argumentHint: params.argumentHint ?? null,
  userInvocable: params.userInvocable ?? null,
  disableModelInvocation: params.disableModelInvocation ?? null,
});

export const setLogLevel = (level: string) =>
  invokeCommand("set_log_level", { level });

export const checkStartupDeps = () =>
  invokeCommand("check_startup_deps", {});

export const getAllTags = () =>
  invokeUnsafe<string[]>("get_all_tags");

// --- Description Optimization ---

export const runOptimizationLoop = (
  skillName: string,
  pluginSlug: string,
  workspacePath: string,
  model: string,
  evalQueries: EvalQuery[],
) => invokeCommand("run_optimization_loop", { skillName, pluginSlug, workspacePath, model, evalQueries });

export const cancelDescriptionOptimization = () =>
  invokeCommand("cancel_description_optimization", {});

export const applyDescription = (
  skillName: string,
  pluginSlug: string,
  workspacePath: string,
  description: string,
) => invokeCommand("apply_description", { skillName, pluginSlug, workspacePath, description });

export const saveEvalQueries = (
  skillName: string,
  pluginSlug: string,
  workspacePath: string,
  evalQueries: EvalQuery[],
) =>
  invokeCommand("save_eval_queries", {
    skillName,
    pluginSlug,
    workspacePath,
    evalQueries: evalQueries.map(({ query, should_trigger }) => ({ query, should_trigger })),
  });

export const loadEvalQueries = (
  skillName: string,
  pluginSlug: string,
  workspacePath: string,
) => invokeCommand("load_eval_queries", { skillName, pluginSlug, workspacePath });

/** Start the generate-skill-description-evals agent.
 * Rust intercepts the run_result (step_id=-12), persists queries to
 * {skills_path}/{plugin_slug}/{skill_name}/description-evals.json, then emits
 * "description:eval-queries-generated" with { skillName, queries }.
 */
export const startGenerateDescEvalQueries = (
  agentId: string,
  skillName: string,
  pluginSlug: string,
  workspaceSkillDir: string,
  model: string,
  numEvalQueries: number,
) => invokeCommand("start_generate_desc_evals", {
  agentId,
  skillName,
  pluginSlug,
  workspaceSkillDir,
  model,
  numEvalQueries,
});

export const writeDescOptLog = (
  skillName: string,
  pluginSlug: string,
  workspacePath: string,
  message: string,
) => invokeCommand("write_desc_opt_log", { skillName, pluginSlug, workspacePath, message });

export const readLatestBenchmark = (skillName: string, workspacePath: string) =>
  invokeCommand("read_latest_benchmark", { skillName, workspacePath });

// --- Test case management (Evals tab) ---

export const listTestCases = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("list_test_cases", { skillName, workspacePath, pluginSlug });

export const saveTestCase = (skillName: string, workspacePath: string, pluginSlug: string, testCase: TestCase) =>
  invokeCommand("save_test_case", { skillName, workspacePath, pluginSlug, testCase });

export const deleteTestCase = (skillName: string, workspacePath: string, pluginSlug: string, id: number) =>
  invokeCommand("delete_test_case", { skillName, workspacePath, pluginSlug, id });

export const listIterations = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("list_iterations", { skillName, workspacePath, pluginSlug });

export const createNextIterationDir = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("create_next_iteration_dir", { skillName, workspacePath, pluginSlug });

export const materializeEvalBenchmark = (
  iterDir: string,
  skillName: string,
  workspacePath: string,
  pluginSlug: string,
  iteration: number,
  evalIds: number[],
  runCount: number,
  comparisonMode?: string,
) =>
  invokeCommand("materialize_eval_benchmark", {
    iterDir,
    skillName,
    workspacePath,
    pluginSlug,
    iteration,
    evalIds,
    runCount,
    comparisonMode: comparisonMode ?? null,
  });

export const readIterationResult = (iterationPath: string, skillName?: string, workspacePath?: string, pluginSlug?: string) =>
  invokeCommand("read_iteration_result", {
    iterationPath,
    skillName: skillName ?? null,
    workspacePath: workspacePath ?? null,
    pluginSlug: pluginSlug ?? null,
  });

export const readGrading = (gradingPath: string) =>
  invokeCommand("read_grading", { gradingPath });

export const readSkillContextForEvalGen = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("read_skill_context_for_eval_gen", { skillName, workspacePath, pluginSlug });

export const readPendingEval = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("read_pending_eval", { skillName, workspacePath, pluginSlug });

export const discardPendingEval = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("discard_pending_eval", { skillName, workspacePath, pluginSlug });

export const buildEvalPrompt = (
  skillName: string,
  pluginSlug: string,
  workspacePath: string,
  skillPath: string,
  evalIds: number[],
  runCount: number,
  iteration: number,
  iterDir: string,
  comparisonMode?: string,
) =>
  invokeCommand("build_eval_prompt", {
    skillName,
    pluginSlug,
    workspacePath,
    skillPath,
    evalIds,
    runCount,
    iteration,
    iterDir,
    comparisonMode: comparisonMode ?? null,
  });

export const buildEvalGenPrompt = (
  skillName: string,
  skillPath: string,
  outputPath: string,
  userIntent: string,
  userContextFile: string,
) =>
  invokeCommand("build_eval_gen_prompt", {
    skillName,
    skillPath,
    outputPath,
    userIntent,
    userContextFile,
  });


// --- Documents ---

export interface SkillIdName {
  id: number
  name: string
  plugin_slug: string
  plugin_display_name: string
  is_default_plugin: boolean
}

export const listDocuments = () =>
  invokeUnsafe<Document[]>("list_documents");

export const listSkillsForDocuments = () =>
  invokeUnsafe<SkillIdName[]>("list_skills_for_documents");

export const addDocumentFile = (
  name: string,
  content: string,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeUnsafe<Document>("add_document_file", { name, content, scope, skillIds });

export const addDocumentUrl = (
  name: string,
  url: string,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeUnsafe<Document>("add_document_url", { name, url, scope, skillIds });

export const addDocumentFolder = (
  name: string,
  folderPath: string,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeUnsafe<Document[]>("add_document_folder", { name, folderPath, scope, skillIds });

export const updateDocument = (
  id: number,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeUnsafe<Document>("update_document", { id, scope, skillIds });

export const deleteDocument = (id: number) =>
  invokeUnsafe<void>("delete_document", { id });
