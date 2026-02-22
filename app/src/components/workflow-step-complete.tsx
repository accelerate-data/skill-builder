import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-link";
import { CheckCircle2, FileText, Clock, DollarSign, ArrowRight, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { readFile, getStepAgentRuns } from "@/lib/tauri";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import type { AgentRunRecord } from "@/lib/types";

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
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** Shared action bar: Refine/Done on last step, Next Step otherwise. Hidden in review mode. */
function StepActionBar({
  isLastStep,
  reviewMode,
  onRefine,
  onClose,
  onNextStep,
}: {
  isLastStep: boolean;
  reviewMode?: boolean;
  onRefine?: () => void;
  onClose?: () => void;
  onNextStep?: () => void;
}) {
  if (reviewMode) return null;

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
}: WorkflowStepCompleteProps) {
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
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
      return;
    }

    let cancelled = false;
    setLoadingFiles(true);
    const results = new Map<string, string>();

    const loadPromises = outputFiles
      .filter((f) => !f.endsWith("/"))
      .map(async (relativePath) => {
        // Try skills path first (strip "skill/" prefix since skill output dir
        // already nests under skillName), then workspace path (uses path as-is)
        let content: string | null = null;
        const skillsRelative = relativePath.startsWith("skill/")
          ? relativePath.slice("skill/".length)
          : relativePath;

        // skills_path is required — no workspace fallback
        if (skillsPath) {
          try {
            content = await readFile(`${skillsPath}/${skillName}/${skillsRelative}`);
          } catch {
            // not found in skills path
          }
        }

        if (content) {
          results.set(relativePath, content);
        } else {
          results.set(relativePath, "__NOT_FOUND__");
        }
      });

    Promise.all(loadPromises).then(() => {
      if (!cancelled) {
        setFileContents(new Map(results));
        setLoadingFiles(false);
      }
    });

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

  // Show file contents when available (both review and non-review mode)
  if (hasFileContents && outputFiles.length > 0) {
    if (loadingFiles) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
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
        {!reviewMode && (
          <div className="flex items-center gap-2 pb-4">
            <CheckCircle2 className="size-4 text-green-500" />
            <h3 className="text-sm font-semibold">{stepName} Complete</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground ml-2">
              {duration !== undefined && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatDuration(duration)}
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
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 pr-4">
            {outputFiles
              .filter((f) => !f.endsWith("/"))
              .map((file) => {
                const content = fileContents.get(file);
                const notFound = content === "__NOT_FOUND__";

                return (
                  <div key={file} className="flex flex-col gap-2">
                    <p className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                      <FileText className="size-3.5 shrink-0" />
                      {file}
                    </p>
                    {notFound && (
                      <p className="text-sm text-muted-foreground italic">
                        File not found
                      </p>
                    )}
                    {!notFound && content && (
                      <div className="rounded-md border">
                        <div className="markdown-body compact max-w-none p-4">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </ScrollArea>
        <StepActionBar
          isLastStep={isLastStep}
          reviewMode={reviewMode}
          onRefine={onRefine}
          onClose={onClose}
          onNextStep={onNextStep}
        />
      </div>
    );
  }

  // Fallback: no file contents loaded yet (loading state or no files)
  if (loadingFiles) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="size-12 text-green-500" />
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
                {formatDuration(duration)}
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
        reviewMode={reviewMode}
        onRefine={onRefine}
        onClose={onClose}
        onNextStep={onNextStep}
      />
    </div>
  );
}
