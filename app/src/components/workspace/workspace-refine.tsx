import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useScopeBlocked } from "@/hooks/use-scope-blocked";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings-store";
import { useRefineStore } from "@/stores/refine-store";
import type { RefineCommand, RefineMessage, SkillFile } from "@/stores/refine-store";
import { useAgentStore } from "@/stores/agent-store";
import {
  getSkillContentForRefine,
  startRefineSession,
  sendRefineMessage,
  closeRefineSession,
  finalizeRefineRun,
  cleanBenchmarkSnapshot,
  materializeRefineValidationOutput,
  cleanupSkillSidecar,
  acquireLock,
  releaseLock,
} from "@/lib/tauri";
import type { SkillSummary } from "@/lib/types";
import { deriveModelLabel } from "@/lib/utils";
import { extractStructuredResultPayload as extractStructuredResultFromDisplayItems } from "@/lib/agent-results";
import { ResizableSplitPane } from "@/components/refine/resizable-split-pane";
import { ChatPanel } from "@/components/refine/chat-panel";
import { PreviewPanel } from "@/components/refine/preview-panel";

// Ensure agent-stream listeners are registered
import "@/hooks/use-agent-stream";

interface WorkspaceRefineProps {
  skill: SkillSummary;
}

/** Fire-and-forget: release skill lock and shut down persistent sidecar. */
function releaseSkillResources(skillName: string, reason: string): void {
  releaseLock(skillName).catch((e) =>
    console.warn("[workspace-refine] non-fatal: op=releaseLock err=%s", e),
  );
  console.log("[workspace-refine] releaseLock: %s (%s)", skillName, reason);
  cleanupSkillSidecar(skillName).catch((e) =>
    console.warn("[workspace-refine] non-fatal: op=cleanupSkillSidecar err=%s", e),
  );
}

/** Load skill files from disk, returning null on failure. */
async function loadSkillFiles(basePath: string, skillName: string): Promise<SkillFile[] | null> {
  try {
    const contents = await getSkillContentForRefine(skillName, basePath);
    return contents
      .map((c): SkillFile => ({ filename: c.path, content: c.content }))
      .sort((a, b) => {
        if (a.filename === "SKILL.md") return -1;
        if (b.filename === "SKILL.md") return 1;
        return a.filename.localeCompare(b.filename);
      });
  } catch (err) {
    console.error("[workspace-refine] Failed to load skill files:", err);
    return null;
  }
}

export function WorkspaceRefine({ skill }: WorkspaceRefineProps) {
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const preferredModel = useSettingsStore((s) => s.preferredModel);
  const availableModels = useSettingsStore((s) => s.availableModels);

  const selectedSkill = useRefineStore((s) => s.selectedSkill);
  const skillFiles = useRefineStore((s) => s.skillFiles);
  const previewRevision = useRefineStore((s) => s.previewRevision);
  const isRunning = useRefineStore((s) => s.isRunning);
  const activeAgentId = useRefineStore((s) => s.activeAgentId);

  const activeRunStatus = useAgentStore((s) =>
    activeAgentId ? s.runs[activeAgentId]?.status : undefined,
  );
  const activeRunCost = useAgentStore((s) =>
    activeAgentId ? s.runs[activeAgentId]?.totalCost : undefined,
  );
  const [lastTurnCost, setLastTurnCost] = useState<number | undefined>(undefined);

  // Capture the skill that was active when the agent started, so the
  // completion effect attributes output to the correct skill even if the
  // user switches skills while an agent is running.
  const runSkillRef = useRef<SkillSummary | null>(null);

  const scopeBlocked = useScopeBlocked(selectedSkill, "refine");

  const extractStructuredResultPayload = useCallback((agentId: string) => {
    const run = useAgentStore.getState().runs[agentId];
    return extractStructuredResultFromDisplayItems(run?.displayItems);
  }, []);

  // Release skill lock on unmount
  useEffect(() => {
    return () => {
      const store = useRefineStore.getState();
      if (store.selectedSkill) {
        if (store.sessionId) {
          closeRefineSession(store.sessionId).catch((e) =>
            console.warn("[workspace-refine] non-fatal: op=closeRefineSession err=%s", e),
          );
        }
        releaseSkillResources(store.selectedSkill.name, "unmount");
        store.clearSession();
      }
    };
  }, []);

  // Navigation guard
  const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
    shouldBlock: () => useRefineStore.getState().isRunning,
    onLeave: (proceed) => {
      const store = useRefineStore.getState();
      store.setRunning(false);
      store.setActiveAgentId(null);
      useAgentStore.getState().clearRuns();

      if (store.sessionId) {
        closeRefineSession(store.sessionId).catch((e) =>
          console.warn("[workspace-refine] non-fatal: op=closeRefineSession err=%s", e),
        );
      }

      if (store.selectedSkill) {
        releaseSkillResources(store.selectedSkill.name, "navigation");
      }

      store.clearSession();
      proceed();
    },
  });

  const availableFiles = useMemo(() => skillFiles.map((f) => f.filename), [skillFiles]);

  // --- Select skill on mount ---
  const handleSelectSkill = useCallback(
    async (s: SkillSummary) => {
      console.log("[workspace-refine] selectSkill: %s", s.name);
      const store = useRefineStore.getState();

      if (store.selectedSkill?.name === s.name && store.sessionId) return;

      const prevSkill = store.selectedSkill;
      if (prevSkill && prevSkill.name !== s.name) {
        await releaseLock(prevSkill.name).catch((e) =>
          console.warn("[workspace-refine] non-fatal: op=releaseLock err=%s", e),
        );
      }

      try {
        await acquireLock(s.name);
        console.log("[workspace-refine] acquireLock: %s", s.name);
      } catch (err) {
        console.error("[workspace-refine] acquireLock failed: %s", s.name, err);
        toast.error(`Cannot open Refine: ${err instanceof Error ? err.message : String(err)}`, {
          duration: Infinity,
          cause: err,
          context: { operation: "workspace_refine_acquire_lock", skillName: s.name },
        });
        return;
      }

      const prevSessionId = store.sessionId;
      if (prevSessionId) {
        await closeRefineSession(prevSessionId).catch((err) =>
          console.warn("[workspace-refine] Failed to close previous session:", err),
        );
      }

      store.selectSkill(s);
      store.setLoadingFiles(true);

      if (workspacePath) {
        try {
          const session = await startRefineSession(s.name, workspacePath);
          useRefineStore.getState().setSessionId(session.session_id);
        } catch (err) {
          console.error("[workspace-refine] Failed to start refine session:", err);
          toast.error("Failed to start refine session", { duration: Infinity });
          store.setLoadingFiles(false);
          return;
        }

        const files = await loadSkillFiles(workspacePath, s.name);
        if (files) {
          store.setSkillFiles(files);
          store.setGitDiff(null);
          if (files.length > 0) {
            store.setActiveFileTab(files[0].filename);
          }
        } else {
          store.setLoadingFiles(false);
          toast.error("Could not load skill files", { duration: Infinity });
        }
      } else {
        store.setLoadingFiles(false);
      }
    },
    [workspacePath],
  );

  useEffect(() => {
    handleSelectSkill(skill);
    // Run once per skill identity — re-run only if skill.name changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill.name]);

  // --- Watch agent completion ---
  useEffect(() => {
    if (!activeAgentId || !activeRunStatus) return;

    const isTerminal = ["completed", "error", "shutdown"].includes(activeRunStatus);
    if (!isTerminal) return;

    console.log(
      "[workspace-refine] agent %s finished: status=%s",
      activeAgentId,
      activeRunStatus,
    );

    if (activeRunStatus === "error" || activeRunStatus === "shutdown") {
      toast.error("Agent failed — check the chat for details", { duration: Infinity });
    }

    const agentRun = useAgentStore.getState().runs[activeAgentId];
    setLastTurnCost(agentRun?.totalCost);

    // Use the skill that was active when the agent started, not the
    // current reactive selectedSkill, to avoid attributing output to
    // the wrong skill if the user switches skills mid-flight.
    const completionSkill = runSkillRef.current ?? selectedSkill;

    const complete = async () => {
      const store = useRefineStore.getState();

      if (activeRunStatus === "completed" && workspacePath && completionSkill) {
        const structuredOutput = extractStructuredResultPayload(activeAgentId);
        const hasStructuredObject =
          !!structuredOutput &&
          typeof structuredOutput === "object" &&
          !Array.isArray(structuredOutput);

        try {
          const finalized = await finalizeRefineRun(
            completionSkill.name,
            workspacePath,
            hasStructuredObject ? structuredOutput : undefined,
          );
          store.updateSkillFiles(
            finalized.files.map((file): SkillFile => ({
              filename: file.path,
              content: file.content,
            })),
          );
          store.setGitDiff(finalized.diff);
          // Offer benchmark only after an explicit /rewrite that changed files.
          const userMessages = store.messages.filter((m: RefineMessage) => m.role === "user");
          const lastMsg = userMessages.length > 0 ? userMessages[userMessages.length - 1] : undefined;
          if (lastMsg?.command === "rewrite" && finalized.diff.files.length > 0) {
            store.addBenchmarkPrompt();
          }
        } catch {
          try {
            if (
              hasStructuredObject &&
              (structuredOutput as Record<string, unknown>).status === "validation_complete"
            ) {
              await materializeRefineValidationOutput(
                completionSkill.name,
                workspacePath,
                structuredOutput,
              );
            }

            const files = await loadSkillFiles(workspacePath, completionSkill.name);
            if (files) {
              store.updateSkillFiles(files);
              store.setGitDiff(null);
            }
          } catch (err) {
            toast.error(
              `Refine finalization failed: ${err instanceof Error ? err.message : String(err)}`,
              { duration: Infinity },
            );
          }
        }
      } else if (workspacePath && completionSkill) {
        // Agent failed or was cancelled — clean up any stale benchmark snapshot
        await cleanBenchmarkSnapshot(completionSkill.name, workspacePath).catch(() => {});
        const files = await loadSkillFiles(workspacePath, completionSkill.name);
        if (files) {
          store.updateSkillFiles(files);
          store.setGitDiff(null);
        }
      }

      store.setRunning(false);
      store.setActiveAgentId(null);
      runSkillRef.current = null;
    };

    void complete();
  }, [activeAgentId, activeRunStatus, workspacePath, selectedSkill, extractStructuredResultPayload]);

  // --- Send a message ---
  const handleSend = useCallback(
    async (text: string, targetFiles?: string[], command?: RefineCommand) => {
      const store = useRefineStore.getState();
      const sessionId = store.sessionId;
      if (!selectedSkill || !workspacePath || !sessionId) return;
      if (isRunning) return;

      console.log(
        "[workspace-refine] send: skill=%s command=%s files=%s",
        selectedSkill.name,
        command ?? "refine",
        targetFiles?.join(",") ?? "all",
      );

      const model = preferredModel ?? "sonnet";

      runSkillRef.current = selectedSkill;
      store.setGitDiff(null);
      store.addUserMessage(text, targetFiles, command);
      store.setRunning(true);

      try {
        const agentId = await sendRefineMessage(
          sessionId,
          text,
          workspacePath,
          targetFiles,
          command,
        );

        useAgentStore.getState().registerRun(
          agentId,
          model,
          selectedSkill.name,
          "refine",
          `synthetic:refine:${selectedSkill.name}:${sessionId}`,
        );

        store.addAgentTurn(agentId);
        store.setActiveAgentId(agentId);
      } catch (err) {
        console.error("[workspace-refine] Failed to send refine message:", err);
        store.setRunning(false);
        store.setActiveAgentId(null);
        toast.error("Failed to start agent", { duration: Infinity });
      }
    },
    [selectedSkill, workspacePath, preferredModel, isRunning],
  );

  // --- Benchmark prompt callbacks ---
  const handleBenchmarkConfirm = useCallback(() => {
    console.log("[workspace-refine] benchmark confirmed");
    void handleSend("", undefined, "benchmark");
  }, [handleSend]);

  const handleBenchmarkSkip = useCallback(() => {
    console.log("[workspace-refine] benchmark skipped");
  }, []);

  // --- Status bar ---
  const [elapsed, setElapsed] = useState(0);
  const runStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRunning) {
      runStartRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - runStartRef.current!);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  const activeModel = preferredModel ?? "claude-sonnet-4-6";
  const modelLabel =
    availableModels.find((m) => m.id === activeModel)?.displayName ?? deriveModelLabel(activeModel);

  const dotStyle = isRunning
    ? { background: "var(--color-pacific)" }
    : selectedSkill
      ? { background: "var(--color-seafoam)" }
      : undefined;
  const dotClass = isRunning ? "animate-pulse" : selectedSkill ? "" : "bg-zinc-500";
  const statusLabel = isRunning ? "running..." : selectedSkill ? "ready" : "loading...";
  const statusCost = activeRunCost ?? (!isRunning ? lastTurnCost : undefined);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <ResizableSplitPane
          left={
            <ChatPanel
              onSend={handleSend}
              isRunning={isRunning}
              hasSkill={!!selectedSkill}
              availableFiles={availableFiles}
              scopeBlocked={scopeBlocked}
              onBenchmarkConfirm={handleBenchmarkConfirm}
              onBenchmarkSkip={handleBenchmarkSkip}
            />
          }
          right={<PreviewPanel key={previewRevision} />}
        />
      </div>

      {/* Status bar */}
      <div className="flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4">
        <div className="flex items-center gap-1.5">
          <div className={`size-[5px] rounded-full ${dotClass}`} style={dotStyle} />
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        </div>
        {selectedSkill && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground">{selectedSkill.name}</span>
          </>
        )}
        <span className="text-muted-foreground/20">&middot;</span>
        <span className="text-xs text-muted-foreground">{modelLabel}</span>
        {isRunning && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground">{(elapsed / 1000).toFixed(1)}s</span>
          </>
        )}
        {statusCost !== undefined && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground">${statusCost.toFixed(4)}</span>
          </>
        )}
      </div>

      {blockerStatus === "blocked" && (
        <Dialog open onOpenChange={(open) => { if (!open) handleNavStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Agent Running</DialogTitle>
              <DialogDescription>
                An agent is still running. Leaving will abandon it and end the session.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleNavStay}>
                Stay
              </Button>
              <Button variant="destructive" onClick={handleNavLeave}>
                Leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
