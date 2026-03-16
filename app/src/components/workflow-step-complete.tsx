import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-link";
import { CheckCircle2, FileText, Clock, DollarSign, ArrowRight, Loader2, MessageSquare, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  readFile,
  listSkillFiles,
  getStepAgentRuns,
  getContextFileContent,
  saveDecisionsContent,
  getDisabledSteps,
} from "@/lib/tauri";
import { useWorkflowStore } from "@/stores/workflow-store";
import { joinPath } from "@/lib/path-utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import { ResearchSummaryCard } from "@/components/research-summary-card";
import { DecisionsSummaryCard } from "@/components/decisions-summary-card";
import { type ClarificationsFile, parseClarifications } from "@/lib/clarifications-types";
import type { AgentRunRecord } from "@/lib/types";
import { formatElapsed } from "@/lib/utils";

interface WorkflowStepCompleteProps {
  stepName: string;
  stepId?: number;
  outputFiles: string[];
  duration?: number;
  cost?: number;
  onNextStep?: () => void;
  onClose?: () => void;
  onRefine?: () => void;
  isLastStep?: boolean;
  reviewMode?: boolean;
  skillName?: string;
  workspacePath?: string;
  skillsPath?: string | null;
  /** When true, show editable ClarificationsEditor on the completion screen */
  clarificationsEditable?: boolean;
  /** Controlled clarifications data from parent — used when editable so edits feed back */
  clarificationsData?: ClarificationsFile | null;
  onClarificationsChange?: (data: ClarificationsFile) => void;
  onClarificationsContinue?: () => void;
  onReset?: () => void;
  /** Called when the user clicks "Reset Step" from the missing-files error state. */
  onResetStep?: () => void;
  saveStatus?: "idle" | "dirty" | "saving" | "saved";
  evaluating?: boolean;
  nextStepBlocked?: boolean;
  nextStepLabel?: string;
}

/** Shared action bar: Refine/Done on last step, Next Step otherwise. Hidden in review mode. */
function StepActionBar({
  isLastStep,
  nextStepBlocked,
  nextStepLabel,
  reviewMode,
  onRefine,
  onClose,
  onNextStep,
}: {
  isLastStep: boolean;
  nextStepBlocked?: boolean;
  nextStepLabel?: string;
  reviewMode?: boolean;
  onRefine?: () => void;
  onClose?: () => void;
  onNextStep?: () => void;
}) {
  if (reviewMode) return null;

  if (nextStepBlocked) {
    return (
      <div className="flex items-center justify-end border-t pt-4">
        <Button size="sm" disabled>
          <ArrowRight className="size-3.5" />
          {nextStepLabel ?? "Next Step"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 border-t pt-4">
      {isLastStep ? (
        <>
          {onRefine && (
            <Button size="sm" variant="outline" onClick={onRefine}>
              <MessageSquare className="size-3.5" />
              Refine
            </Button>
          )}
          {onClose && (
            <Button size="sm" onClick={onClose}>
              <CheckCircle2 className="size-3.5" />
              Done
            </Button>
          )}
        </>
      ) : (
        onNextStep && (
          <Button size="sm" onClick={onNextStep}>
            <ArrowRight className="size-3.5" />
            Next Step
          </Button>
        )
      )}
    </div>
  );
}

export function WorkflowStepComplete({
  stepName,
  stepId,
  outputFiles,
  duration,
  cost,
  onNextStep,
  onClose,
  onRefine,
  isLastStep = false,
  reviewMode,
  skillName,
  workspacePath,
  skillsPath,
  clarificationsEditable,
  clarificationsData: controlledClarData,
  onClarificationsChange,
  onClarificationsContinue,
  onReset,
  onResetStep,
  saveStatus,
  evaluating,
  nextStepBlocked = false,
  nextStepLabel,
}: WorkflowStepCompleteProps) {
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[]>([]);

  useEffect(() => {
    if (!skillName || stepId == null) {
      setAgentRuns([]);
      return;
    }

    getStepAgentRuns(skillName, stepId)
      .then((runs) => setAgentRuns(runs))
      .catch((err) => console.error("Failed to load agent stats:", err));
  }, [skillName, stepId]);

  // Always load file contents when skillName is available (both review and non-review mode)
  useEffect(() => {
    if (!skillName || outputFiles.length === 0) {
      setFileContents(new Map());
      setResolvedFiles([]);
      setSelectedFile(null);
      return;
    }

    let cancelled = false;
    setLoadingFiles(true);

    (async () => {
      // Expand directory paths (ending with "/") into individual files
      const expandedFiles: string[] = [];
      const dirPaths = outputFiles.filter((f) => f.endsWith("/"));
      const filePaths = outputFiles.filter((f) => !f.endsWith("/"));
      expandedFiles.push(...filePaths);

      if (dirPaths.length > 0 && skillsPath) {
        try {
          const allEntries = await listSkillFiles(skillsPath, skillName);
          console.log(`[step-complete] listSkillFiles returned ${allEntries.length} entries for ${skillName}`);
          for (const dir of dirPaths) {
            // dir is like "skill/references/" — strip "skill/" prefix to match on-disk paths
            const diskPrefix = dir.startsWith("skill/") ? dir.slice("skill/".length) : dir;
            for (const entry of allEntries) {
              if (!entry.is_directory && entry.relative_path.startsWith(diskPrefix)) {
                expandedFiles.push(`skill/${entry.relative_path}`);
              }
            }
          }
        } catch (err) {
          console.error("[step-complete] Failed to expand directory paths:", err);
        }
      } else if (dirPaths.length > 0) {
        console.warn("[step-complete] Cannot expand directories: skillsPath is not set");
      }

      const results = new Map<string, string>();

      await Promise.all(
        expandedFiles.map(async (relativePath) => {
          let content: string | null = null;
          const skillsRelative = relativePath.startsWith("skill/")
            ? relativePath.slice("skill/".length)
            : relativePath;

          if (relativePath.startsWith("context/") && workspacePath) {
            try {
              content = await getContextFileContent(
                skillName,
                workspacePath,
                relativePath.slice("context/".length),
              );
            } catch {
              // not found in workspace context
            }
          } else if (skillsPath) {
            try {
              content = await readFile(joinPath(skillsPath, skillName, skillsRelative));
            } catch {
              // not found in skills path
            }
          }

          results.set(relativePath, content ?? "__NOT_FOUND__");
        })
      );

      if (!cancelled) {
        console.log(`[step-complete] Resolved ${expandedFiles.length} files:`, expandedFiles);
        setFileContents(new Map(results));
        setResolvedFiles(expandedFiles);
        setSelectedFile(expandedFiles[0] ?? null);
        setLoadingFiles(false);
      }
    })();

    return () => { cancelled = true; };
  }, [skillName, workspacePath, skillsPath, outputFiles]);

  const hasFileContents = fileContents.size > 0;

  // In review mode (history): derive cost from DB-loaded agentRuns — DB is source of truth.
  // In live mode (just completed): use the cost prop from Zustand — the DB write is still
  // in-flight and may return stale data (e.g. a previous session's run with total_cost=0).
  const dbCost = agentRuns.length > 0
    ? agentRuns.reduce((sum, r) => sum + r.total_cost, 0)
    : undefined;
  const displayCost = reviewMode ? dbCost : cost;

  // Autosave state for decisions editing — hoisted above all early returns to satisfy Rules of Hooks
  const [decisionsEditContent, setDecisionsEditContent] = useState<string | null>(null);
  // Version counter instead of a boolean dirty flag: incrementing on each edit avoids a race where
  // setDecisionsEditorDirty(false) inside the async save callback re-triggers the effect and
  // cancels the pending timer for a newer edit that arrived during the await.
  const [decisionsEditVersion, setDecisionsEditVersion] = useState(0);
  const [decisionsSaveStatus, setDecisionsSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (!decisionsEditContent || !workspacePath || !skillName || reviewMode || decisionsEditVersion === 0) return;
    const savedVersion = decisionsEditVersion;
    setDecisionsSaveStatus("saving");
    const timer = setTimeout(async () => {
      try {
        await saveDecisionsContent(skillName, workspacePath, decisionsEditContent);
        // Only mark saved if no newer edit arrived during the await.
        setDecisionsEditVersion((current) => {
          if (current === savedVersion) setDecisionsSaveStatus("saved");
          return current;
        });
        // Refresh guard state — user edits may clear contradictions
        // (e.g. contradictory_inputs changed from true to "revised").
        const disabled = await getDisabledSteps(skillName);
        useWorkflowStore.getState().setDisabledSteps(disabled);
      } catch (err) {
        console.error("Failed to save decisions.json:", err);
      }
    }, 300); // Short debounce — trigger is now blur, not keystroke
    return () => clearTimeout(timer);
  }, [decisionsEditContent, decisionsEditVersion, workspacePath, skillName, reviewMode]);

  // Loading spinner — shown while files are being fetched (initial or re-fetch)
  if (loadingFiles) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Step 0 (Research) now uses a single canonical artifact: clarifications.json
  const researchPlanContent = fileContents.get("context/research-plan.md");
  const clarificationsContent = fileContents.get("context/clarifications.json");
  const isResearchStep = stepId === 0
    && outputFiles.includes("context/clarifications.json");

  if (isResearchStep) {
    // Missing files = error
    const missingFiles: string[] = [];
    if (!clarificationsContent || clarificationsContent === "__NOT_FOUND__") missingFiles.push("context/clarifications.json");

    if (missingFiles.length > 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
          <AlertTriangle className="size-8 text-destructive/50" />
          <div className="text-center">
            <p className="font-medium text-destructive">Research step completed but output files are missing</p>
            <div className="mt-2 text-sm">
              {missingFiles.map((f) => (
                <p key={f}>Expected <code className="text-xs">{f}</code> but it was not found.</p>
              ))}
            </div>
          </div>
          {onResetStep && (
            <Button size="sm" variant="outline" onClick={onResetStep}>
              <RotateCcw className="size-3.5" />
              Reset Step
            </Button>
          )}
        </div>
      );
    }

    const clarData = parseClarifications(clarificationsContent!);
    if (!clarData) {
      return (
        <div className="flex h-full flex-col gap-4 overflow-hidden">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
            <AlertTriangle className="size-8 text-destructive/50" />
            <div className="text-center">
              <p className="font-medium text-destructive">Invalid clarifications.json</p>
              <p className="mt-1 text-sm">The agent wrote a file that is not valid JSON. Reset and re-run the step.</p>
            </div>
          </div>
          <StepActionBar
            isLastStep={isLastStep}
            nextStepBlocked={nextStepBlocked}
            nextStepLabel={nextStepLabel}
            reviewMode={reviewMode}
            onRefine={onRefine}
            onClose={onClose}
            onNextStep={onNextStep}
          />
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col gap-4 overflow-hidden">
        {reviewMode && agentRuns.length > 0 && (
          <div className="shrink-0">
            <AgentStatsBar runs={agentRuns} />
          </div>
        )}
        {clarificationsEditable ? (
          /* Editable mode: ResearchSummaryCard with collapsible plan + editable clarifications.
             The ClarificationsEditor's Continue button handles advancement — no StepActionBar. */
          <div className="min-h-0 flex-1 overflow-hidden">
            <ResearchSummaryCard
                researchPlan={researchPlanContent}
                clarificationsData={controlledClarData ?? clarData}
                duration={!reviewMode ? duration : undefined}
                cost={displayCost}
                editable
                onClarificationsChange={onClarificationsChange}
                onClarificationsContinue={onClarificationsContinue}
                onReset={onReset}
                saveStatus={saveStatus}
                evaluating={evaluating}
              />
          </div>
        ) : (
          /* Read-only mode (review): show research plan expanded, clarifications read-only */
          <>
            <ScrollArea className="min-h-0 flex-1">
              <div className="pr-4">
                <ResearchSummaryCard
                  researchPlan={researchPlanContent}
                  clarificationsData={clarData}
                  duration={!reviewMode ? duration : undefined}
                  cost={displayCost}
                />
              </div>
            </ScrollArea>
            <StepActionBar
              isLastStep={isLastStep}
              nextStepBlocked={nextStepBlocked}
              nextStepLabel={nextStepLabel}
              reviewMode={reviewMode}
              onRefine={onRefine}
              onClose={onClose}
              onNextStep={onNextStep}
            />
          </>
        )}
      </div>
    );
  }

  // Detailed research step (step 1): clarifications.json only.
  const isClarificationsOnlyStep = !isResearchStep
    && stepId === 1
    && outputFiles.includes("context/clarifications.json")
    && clarificationsContent && clarificationsContent !== "__NOT_FOUND__";

  if (isClarificationsOnlyStep) {
    const clarOnlyData = parseClarifications(clarificationsContent!);

    if (clarOnlyData) {
      return (
        <div className="flex h-full flex-col gap-4 overflow-hidden">
          {reviewMode && agentRuns.length > 0 && (
            <div className="shrink-0">
              <AgentStatsBar runs={agentRuns} />
            </div>
          )}
          {clarificationsEditable ? (
            /* Editable mode: ClarificationsEditor fills remaining space. */
            <div className="flex-1 min-h-0 overflow-hidden">
              <ClarificationsEditor
                data={controlledClarData ?? clarOnlyData}
                onChange={onClarificationsChange ?? (() => {})}
                onContinue={onClarificationsContinue}
                onReset={onReset}
                saveStatus={saveStatus}
                evaluating={evaluating}
              />
            </div>
          ) : (
            /* Read-only mode (review) */
            <>
              <div className="rounded-lg border shadow-sm min-h-0 flex-1" style={{ height: "min(600px, 60vh)" }}>
                <ClarificationsEditor data={clarOnlyData} onChange={() => {}} readOnly />
              </div>
              <StepActionBar
                isLastStep={isLastStep}
                nextStepBlocked={nextStepBlocked}
                nextStepLabel={nextStepLabel}
                reviewMode={reviewMode}
                onRefine={onRefine}
                onClose={onClose}
                onNextStep={onNextStep}
              />
            </>
          )}
        </div>
      );
    }
  }

  // Decisions step: show summary card when decisions.json is the output
  const decisionsContent = fileContents.get("context/decisions.json");
  const isDecisionsStep = outputFiles.includes("context/decisions.json")
    && decisionsContent && decisionsContent !== "__NOT_FOUND__";

  // Decisions step: missing output file — show re-run affordance instead of broken completion screen
  if (outputFiles.includes("context/decisions.json") && (!decisionsContent || decisionsContent === "__NOT_FOUND__")) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <AlertTriangle className="size-8 text-destructive/50" />
        <div className="text-center">
          <p className="font-medium text-destructive">{stepName} step completed but output files are missing</p>
          <p className="mt-1 text-sm">Expected <code className="text-xs">context/decisions.json</code> but it was not found.</p>
        </div>
        {onResetStep && (
          <Button size="sm" variant="outline" onClick={onResetStep}>
            <RotateCcw className="size-3.5" />
            Re-run Step
          </Button>
        )}
      </div>
    );
  }

  if (isDecisionsStep) {
    // In review mode, derive duration from DB agent runs
    const dbDuration = agentRuns.length > 0
      ? agentRuns.reduce((sum, r) => sum + r.duration_ms, 0)
      : undefined;

    return (
      <div className="flex h-full flex-col gap-4 overflow-hidden">
        {reviewMode && agentRuns.length > 0 && (
          <div className="shrink-0">
            <AgentStatsBar runs={agentRuns} />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-4">
          <DecisionsSummaryCard
            decisionsContent={decisionsContent}
            duration={reviewMode ? dbDuration : duration}
            cost={displayCost}
            allowEdit={!reviewMode}
            onDecisionsChange={(serialized) => {
              setDecisionsEditContent(serialized);
              setDecisionsEditVersion((v) => v + 1);
              setDecisionsSaveStatus("saving");
            }}
          />
        </div>
        {!reviewMode && decisionsSaveStatus !== "idle" && (
          <div className="flex justify-start">
            <span className="text-xs text-muted-foreground">
              {decisionsSaveStatus === "saving" ? (
                "Saving…"
              ) : (
                <span style={{ color: "var(--color-seafoam)" }}>Saved</span>
              )}
            </span>
          </div>
        )}
        <StepActionBar
          isLastStep={isLastStep}
          nextStepBlocked={nextStepBlocked}
          nextStepLabel={nextStepLabel}
          reviewMode={reviewMode}
          onRefine={onRefine}
          onClose={onClose}
          onNextStep={onNextStep}
        />
      </div>
    );
  }

  // Default: show file contents with a dropdown selector when multiple files exist
  const visibleFiles = resolvedFiles.filter((f) => !f.endsWith("/"));
  if (hasFileContents && visibleFiles.length > 0) {
    const activeFile = selectedFile && visibleFiles.includes(selectedFile) ? selectedFile : visibleFiles[0];
    const activeContent = fileContents.get(activeFile);
    const activeNotFound = activeContent === "__NOT_FOUND__";

    /** Display label for a file path: SKILL.md or references/foo.md */
    const fileLabel = (f: string): string =>
      f.startsWith("skill/") ? f.slice("skill/".length) : f;

    return (
      <div className="flex h-full flex-col gap-4 overflow-hidden">
        {reviewMode && agentRuns.length > 0 && (
          <div className="shrink-0">
            <AgentStatsBar runs={agentRuns} />
          </div>
        )}
        {/* Header row: step complete badge + stats */}
        {!reviewMode && (
          <div className="flex items-center gap-3 shrink-0">
            <CheckCircle2 className="size-4 shrink-0" style={{ color: "var(--color-seafoam)" }} />
            <span className="text-sm font-semibold tracking-tight">{stepName} Complete</span>
            <div className="flex-1" />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {duration !== undefined && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatElapsed(duration)}
                </span>
              )}
              {displayCost !== undefined && (
                <span className="flex items-center gap-1">
                  <DollarSign className="size-3" />
                  ${displayCost.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        )}
        {/* File selector — below header, above content */}
        <div className="shrink-0">
          {visibleFiles.length > 1 && (
            <Select value={activeFile} onValueChange={setSelectedFile}>
              <SelectTrigger size="sm" className="font-mono text-xs">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visibleFiles.map((f) => (
                  <SelectItem key={f} value={f} className="font-mono text-xs">
                    {fileLabel(f)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {visibleFiles.length === 1 && (
            <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <FileText className="size-3.5 shrink-0" />
              {fileLabel(activeFile)}
            </span>
          )}
        </div>
        {/* File content */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="pr-4">
            {activeNotFound && (
              <div className="flex flex-col items-center gap-3 py-6">
                <p className="text-sm text-muted-foreground italic">File not found</p>
                {onResetStep && (
                  <Button size="sm" variant="outline" onClick={onResetStep}>
                    <RotateCcw className="size-3.5" />
                    Re-run Step
                  </Button>
                )}
              </div>
            )}
            {!activeNotFound && activeContent && (
              <FileContentRenderer file={activeFile} content={activeContent} />
            )}
          </div>
        </ScrollArea>
        <StepActionBar
          isLastStep={isLastStep}
          nextStepBlocked={nextStepBlocked}
          nextStepLabel={nextStepLabel}
          reviewMode={reviewMode}
          onRefine={onRefine}
          onClose={onClose}
          onNextStep={onNextStep}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="size-12" style={{ color: "var(--color-seafoam)" }} />
          <h3 className="text-lg font-semibold">{stepName} Complete</h3>

          {outputFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Created Files
              </p>
              {outputFiles.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <FileText className="size-3.5" />
                  <span>{file}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {duration !== undefined && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatElapsed(duration)}
              </span>
            )}
            {displayCost !== undefined && (
              <span className="flex items-center gap-1">
                <DollarSign className="size-3" />
                ${displayCost.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      </div>
      <StepActionBar
        isLastStep={isLastStep}
        nextStepBlocked={nextStepBlocked}
        nextStepLabel={nextStepLabel}
        reviewMode={reviewMode}
        onRefine={onRefine}
        onClose={onClose}
        onNextStep={onNextStep}
      />
    </div>
  );
}

// ─── File Content Renderer ────────────────────────────────────────────────────

function FileContentRenderer({ file, content }: { file: string; content: string }) {
  // Detect clarifications.json — render with the structured editor in read-only mode
  if (file.endsWith("clarifications.json")) {
    const data = parseClarifications(content);
    if (data?.version && data.sections) {
      return (
        <div className="rounded-md border" style={{ height: "min(600px, 60vh)" }}>
          <ClarificationsEditor data={data} onChange={() => {}} readOnly />
        </div>
      );
    }
  }

  // Default: render as markdown
  return (
    <div className="rounded-md border">
      <div className="markdown-body compact max-w-none p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
