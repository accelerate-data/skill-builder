import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, SkillSummary, MarketplaceUpdateResult, SkillMetadataOverride, SkillFileMeta, AnswerEvaluationOutput, ModelSettings } from "@/lib/types";
import type { TauriCommandInvocation, TauriCommandResult, ModelCatalogEntry, ModelFilter, ProviderCatalogRow } from "@/lib/tauri-command-types";

export const invokeCommand = <Invocation extends TauriCommandInvocation>(
  ...[command, args]: Invocation
) => invoke<TauriCommandResult<Invocation[0]>>(command, args);

/** Escape hatch for commands that have not joined `TauriCommandMap` yet. Prefer `invokeCommand`. */
export const invokeUnsafe = invoke;

/** Write a log message to the Rust app.log file from the frontend. */
export const logFrontend = (level: "info" | "warn" | "error" | "debug", message: string) =>
  invokeCommand("log_frontend", { level, message }).catch(() => {});

// Re-export shared types so existing imports from "@/lib/tauri" continue to work
export type { AppSettings, SkillSummary, SkillCommit, ReconciliationResult, DeviceFlowResponse, GitHubAuthResult, GitHubUser, AgentRunRecord, WorkflowSessionRecord, UsageSummary, UsageByStep, UsageByModel, UsageByDay, ImportedSkill, GitHubRepoInfo, AvailablePlugin, AvailableSkill, SkillFileContent, RefineDiff, RefineFinalizeResult, SkillSessionInfo, RefineDispatchResult, MarketplaceImportResult, MarketplaceUpdateResult, SkillMetadataOverride, SkillUpdateInfo, SkillFileMeta, ModelInfo, StartupDeps, ResearchStepOutput, DetailedResearchOutput, DecisionsOutput, GenerateSkillOutput, WorkflowStepResultPayload, AnswerEvaluationOutput, PerQuestionEntry, Document, ConversationMessage, RestoredConversationEvent } from "@/lib/types";
export type { ScopeReviewResult, ScopeReviewSuggestion } from "@/lib/tauri-command-types";

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

export const testModelConnection = (settings: ModelSettings) =>
  invokeCommand("test_model_connection", { settings });

export const getDataDir = () => invokeCommand("get_data_dir", {});

export const getDefaultSkillsPath = () => invokeCommand("get_default_skills_path", {});

export const ensureOpenHandsRuntimeReady = () =>
  invokeCommand("ensure_openhands_runtime_ready", {});

// --- Skills ---

export const deleteSkill = (workspacePath: string, name: string) =>
  invokeCommand("delete_skill", { workspacePath, name });

export const updateSkillMetadata = (
  skillName: string,
  pluginSlug: string,
  purpose: string | null,
  tags: string[] | null,
  intakeJson: string | null,
  description?: string | null,
  version?: string | null,
  userInvocable?: boolean | null,
  disableModelInvocation?: boolean | null,
) => invokeCommand("update_skill_metadata", {
  skillName,
  pluginSlug,
  purpose,
  tags,
  intakeJson,
  description: description ?? null,
  version: version ?? null,
  userInvocable: userInvocable ?? null,
  disableModelInvocation: disableModelInvocation ?? null,
});

export const renameSkill = (
  oldName: string,
  newName: string,
  workspacePath: string,
) => invokeCommand("rename_skill", { oldName, newName, workspacePath });

export const exportSkillAsFile = (
  skillName: string,
  pluginSlug: string,
  destPath: string,
) => invokeCommand("export_skill_as_file", { skillName, pluginSlug, destPath });

export const reviewSkillScope = (
  skillName: string,
  description: string,
  purpose: string,
  contextQuestions: string | null,
  industry: string | null,
) => invokeCommand("review_skill_scope", { skillName, description, purpose, contextQuestions, industry })

// --- Workflow ---

export const runWorkflowStep = (
  skillId: number,
  skillName: string,
  stepId: number,
) => invokeCommand("run_workflow_step", { skillId, skillName, stepId });

export const resetWorkflowStep = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invokeCommand("reset_workflow_step", { workspacePath, skillName, fromStepId });

/** Navigate back to a completed step: preserves target step's output files,
 *  resets only subsequent steps in DB, and sets current_step = targetStepId.
 *  Use this instead of resetWorkflowStep when the target step should stay "completed". */
export const navigateBackToStepDb = (
  workspacePath: string,
  skillName: string,
  targetStepId: number,
): Promise<void> => invokeCommand("navigate_back_to_step", { workspacePath, skillName, targetStepId });

export interface StepResetPreview {
  step_id: number;
  step_name: string;
  files: string[];
}

export const previewStepReset = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invokeCommand("preview_step_reset", { workspacePath, skillName, fromStepId });

export const verifyStepOutput = (
  workspacePath: string,
  skillId: number,
  stepId: number,
) => invokeCommand("verify_step_output", { workspacePath, skillId, stepId });

export const getDisabledSteps = (skillId: number) =>
  invokeCommand("get_disabled_steps", { skillId });

// --- Workflow State (SQLite) ---

export interface WorkflowRunRow {
  skill_name: string;
  current_step: number;
  status: string;
  purpose: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStepRow {
  skill_name: string;
  step_id: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface WorkflowStateResponse {
  run: WorkflowRunRow | null;
  steps: WorkflowStepRow[];
}

export interface StepStatusUpdate {
  step_id: number;
  status: string;
}

export const getWorkflowState = (skillId: number) =>
  invokeCommand("get_workflow_state", { skillId });

export const saveWorkflowState = (
  skillId: number,
  currentStep: number,
  status: string,
  stepStatuses: StepStatusUpdate[],
  purpose?: string,
) => invokeCommand("save_workflow_state", { skillId, currentStep, status, stepStatuses, purpose: purpose ?? "domain" });

// --- Files ---

export const readFile = (filePath: string) =>
  invokeCommand("read_file", { filePath });

export const writeFile = (path: string, content: string) =>
  invokeCommand("write_file", { path, content });

export const listSkillFiles = (
  workspacePath: string,
  skillName: string,
  pluginSlug?: string | null,
) =>
  invokeCommand("list_skill_files", {
    workspacePath,
    skillName,
    pluginSlug: pluginSlug ?? null,
  });

// --- Lifecycle ---

export const getWorkspacePath = () =>
  invokeCommand("get_workspace_path", {});

/** Graceful shutdown: release locks, end sessions. */
export const gracefulShutdown = () =>
  invokeCommand("graceful_shutdown", {});

/** Mark the next app/window close as user-confirmed so Tauri lets it exit. */
export const allowAppExit = () =>
  invokeCommand("allow_app_exit", {});

// --- Workflow Sessions ---

export const createWorkflowSession = (sessionId: string, skillId: number) =>
  invokeCommand("create_workflow_session", { sessionId, skillId });

export const endWorkflowSession = (sessionId: string) =>
  invokeCommand("end_workflow_session", { sessionId });

// --- Reconciliation ---

export const reconcileStartup = (apply = false) =>
  apply
    ? invokeCommand("reconcile_startup", { apply: true })
    : invokeCommand("reconcile_startup", {});

export const recordReconciliationCancel = (
  notificationCount: number,
) =>
  invokeCommand("record_reconciliation_cancel", {
    notificationCount,
  });

// --- Feedback ---

interface CreateGithubIssueRequest {
  title: string;
  body: string;
  labels: string[];
}

export interface CreateGithubIssueResponse {
  url: string;
  number: number;
}

export const createGithubIssue = (request: CreateGithubIssueRequest) =>
  invokeCommand("create_github_issue", { request });

// --- GitHub OAuth ---

export const githubStartDeviceFlow = () =>
  invokeCommand("github_start_device_flow", {});

export const githubPollForToken = (deviceCode: string) =>
  invokeCommand("github_poll_for_token", { deviceCode });

export const githubGetUser = () =>
  invokeCommand("github_get_user", {});

export const githubLogout = () =>
  invokeCommand("github_logout", {});

export const getExternallyLockedSkills = () =>
  invokeCommand("get_externally_locked_skills", {});

// --- Usage Tracking ---

export const getUsageSummary = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeCommand("get_usage_summary", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getRecentWorkflowSessions = (limit: number = 50, hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeCommand("get_recent_workflow_sessions", { limit, hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getStepAgentRuns = (skillId: number, stepId: number) =>
  invokeCommand("get_step_agent_runs", { skillId, stepId });

export const getAgentRuns = (
  hideCancelled: boolean = false,
  startDate?: string | null,
  skillName?: string | null,
  modelFilter?: string | null,
  limit: number = 500,
) =>
  invokeCommand("get_agent_runs", {
    hideCancelled,
    startDate: startDate ?? null,
    skillName: skillName ?? null,
    modelFilter: modelFilter ?? null,
    limit,
  });

export const getUsageByStep = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeCommand("get_usage_by_step", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getUsageByModel = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeCommand("get_usage_by_model", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getUsageByDay = (hideCancelled: boolean = false, startDate?: string | null, skillName?: string | null) =>
  invokeCommand("get_usage_by_day", { hideCancelled, startDate: startDate ?? null, skillName: skillName ?? null });

export const getWorkflowSkillNames = () =>
  invokeCommand("get_workflow_skill_names", {});

export const resetUsage = () =>
  invokeCommand("reset_usage", {});

// --- Imported Skills ---

export async function getDashboardSkillNames(): Promise<string[]> {
  return invokeCommand("get_dashboard_skill_names", {})
}

export async function listSkills(sourceUrl?: string | null): Promise<SkillSummary[]> {
  return invokeCommand("list_skills", {
    sourceUrl: sourceUrl ?? null,
  })
}

export const listImportedSkills = (sourceUrl?: string | null) =>
  invokeCommand("list_imported_skills", { sourceUrl: sourceUrl ?? null })

export const deleteImportedSkill = (skillId: number) =>
  invokeCommand("delete_imported_skill", { skillId })

export const listPlugins = () =>
  invokeCommand("list_plugins", {})

export const deletePlugin = (pluginSlug: string) =>
  invokeCommand("delete_plugin", { pluginSlug })

export const setPluginUpgradeLock = (pluginSlug: string, locked: boolean) =>
  invokeCommand("set_plugin_upgrade_lock", { pluginSlug, locked })

export const createPluginFromSkills = (pluginName: string, skillKeys: string[]) =>
  invokeCommand("create_plugin_from_skills", { pluginName, skillKeys })

/**
 * Move a skill to a different plugin.
 * @param skillKey - Compound key: "skill-builder:{pluginSlug}:{skillName}" for builder skills,
 *                   "imported:{skillId}" for imported skills
 * @param pluginSlug - Target plugin slug
 */
export const moveSkillToPlugin = (skillKey: string, pluginSlug: string) =>
  invokeCommand("move_skill_to_plugin", { skillKey, pluginSlug })

/**
 * Remove a skill from its current plugin, returning it to the default plugin.
 * @param skillKey - Compound key: "skill-builder:{pluginSlug}:{skillName}" for builder skills,
 *                   "imported:{skillId}" for imported skills
 */
export const removeSkillFromPlugin = (skillKey: string) =>
  invokeCommand("remove_skill_from_plugin", { skillKey })

// --- GitHub Import ---

export const parseGitHubUrl = (url: string) =>
  invokeCommand("parse_github_url", { url });

/** Validates the URL and returns the registry name from marketplace.json. */
export const checkMarketplaceUrl = (url: string) =>
  invokeCommand("check_marketplace_url", { url });

export const listGitHubPlugins = (owner: string, repo: string, branch: string, subpath?: string) =>
  invokeCommand("list_github_plugins", { owner, repo, branch, subpath: subpath ?? null });

// --- Marketplace Import ---

export const importMarketplaceToLibrary = (skillPaths: string[], sourceUrl: string, metadataOverrides?: Record<string, SkillMetadataOverride>) =>
  invokeCommand("import_marketplace_to_library", { sourceUrl, skillPaths, metadataOverrides: metadataOverrides ?? null })

export const importMarketplacePluginToLibrary = (pluginPath: string, pluginName: string, sourceUrl: string) =>
  invokeCommand("import_marketplace_plugin_to_library", { sourceUrl, pluginPath, pluginName })

export const checkMarketplaceUpdates = (): Promise<MarketplaceUpdateResult> =>
  invokeCommand("check_marketplace_updates", {})

export const checkSkillCustomized = (skillName: string): Promise<boolean> =>
  invokeCommand("check_skill_customized", { skillName })

// --- Selected Skill Session ---

export const getSkillContentAtPath = (path: string) =>
  invokeCommand("get_skill_content_at_path", { path })

export const getSkillContentForRefine = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("get_skill_content_for_refine", { skillName, workspacePath, pluginSlug })

export const selectSkillOpenHandsSession = (skillId: number) =>
  invokeCommand("select_skill_openhands_session", { skillId })

export const pauseOpenHandsSession = (
  skillName: string,
  pluginSlug: string,
  conversationId: string,
  agentId?: string | null,
  skillId?: number | null,
) =>
  invokeCommand("pause_openhands_session", {
    input: {
      skillName,
      pluginSlug,
      conversationId,
      agentId: agentId ?? null,
      skillId: skillId ?? null,
    },
  })

// --- Git History ---

export const getSkillHistory = (
  workspacePath: string,
  skillName: string,
  pluginSlug: string,
  limit?: number,
) => invokeCommand("get_skill_history", {
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
) => invokeCommand("restore_skill_version", {
  workspacePath,
  skillName,
  pluginSlug,
  sha,
})

export const getSkillFilesAtSha = (workspacePath: string, skillName: string, pluginSlug: string, sha: string) =>
  invokeCommand("get_skill_files_at_sha", { workspacePath, skillName, pluginSlug, sha })

// --- Answer Evaluation (Transition Gate) ---

export const runAnswerEvaluator = (
  skillId: number,
  skillName: string,
  workspacePath: string,
) => invokeCommand("run_answer_evaluator", { skillId, skillName, workspacePath });

export const materializeAnswerEvaluationOutput = (
  skillName: string,
  workspacePath: string,
  evaluationPayload: AnswerEvaluationOutput,
) => invokeCommand("materialize_answer_evaluation_output", {
  skillName,
  workspacePath,
  evaluationPayload,
});


export const logGateDecision = (
  skillName: string,
  verdict: string,
  decision: string,
) => invokeCommand("log_gate_decision", { skillName, verdict, decision });

// --- File Import ---

export const parseSkillFile = (filePath: string): Promise<SkillFileMeta> =>
  invokeCommand("parse_skill_file", { filePath })

export const importSkillFromFile = (params: {
  filePath: string
  name: string
  description: string
  version: string
  userInvocable?: boolean | null
  disableModelInvocation?: boolean | null
}): Promise<string> =>
  invokeCommand("import_skill_from_file", {
    filePath: params.filePath,
    name: params.name,
    description: params.description,
    version: params.version,
    userInvocable: params.userInvocable ?? null,
    disableModelInvocation: params.disableModelInvocation ?? null,
  })

// --- Additional typed wrappers ---

export const createSkill = (params: {
  name: string;
  tags?: string[] | null;
  purpose?: string | null;
  intakeJson?: string | null;
  description?: string | null;
  version?: string | null;
  userInvocable?: boolean | null;
  disableModelInvocation?: boolean | null;
}) => invokeCommand("create_skill", {
  name: params.name,
  tags: params.tags ?? null,
  purpose: params.purpose ?? null,
  intakeJson: params.intakeJson ?? null,
  description: params.description ?? null,
  version: params.version ?? null,
  userInvocable: params.userInvocable ?? null,
  disableModelInvocation: params.disableModelInvocation ?? null,
});

export const setLogLevel = (level: string) =>
  invokeCommand("set_log_level", { level });

export const checkStartupDeps = () =>
  invokeCommand("check_startup_deps", {});

// --- Benchmark ---

export interface LatestBenchmarkResult {
  iteration: number;
  data: import("@/lib/types").BenchmarkData;
}

export const readLatestBenchmark = (skillName: string, workspacePath: string) =>
  invokeCommand(
    "read_latest_benchmark",
    { skillName, workspacePath },
  );

// --- Documents ---

export interface SkillIdName {
  id: number
  name: string
  plugin_slug: string
  plugin_display_name: string
  is_default_plugin: boolean
}

export const listDocuments = () =>
  invokeCommand("list_documents", {});

export const listSkillsForDocuments = () =>
  invokeCommand("list_skills_for_documents", {});

export const addDocumentFile = (
  name: string,
  content: string,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeCommand("add_document_file", { name, content, scope, skillIds });

export const addDocumentUrl = (
  name: string,
  url: string,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeCommand("add_document_url", { name, url, scope, skillIds });

export const addDocumentFolder = (
  name: string,
  folderPath: string,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeCommand("add_document_folder", { name, folderPath, scope, skillIds });

export const updateDocument = (
  id: number,
  scope: "all" | "skill",
  skillIds: number[],
) => invokeCommand("update_document", { id, scope, skillIds });

export const deleteDocument = (id: number) =>
  invokeCommand("delete_document", { id });

// --- Model Catalog ---

export const refreshModelCatalog = (): Promise<ModelCatalogEntry[]> =>
  invokeCommand("refresh_model_catalog", {});

export const getCachedModelCatalog = (): Promise<ModelCatalogEntry[]> =>
  invokeCommand("get_cached_model_catalog", {});

export const getCachedModelProviders = (): Promise<ProviderCatalogRow[]> =>
  invokeCommand("get_cached_model_providers", {});

export const filterModels = (
  models: ModelCatalogEntry[],
  filters: ModelFilter[],
): Promise<ModelCatalogEntry[]> =>
  invokeCommand("filter_models", { models, filters });
