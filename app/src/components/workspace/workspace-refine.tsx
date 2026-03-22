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
import type { RefineMessage, SkillFile } from "@/stores/refine-store";
import { useAgentStore, formatTokenCount } from "@/stores/agent-store";
import {
  getSkillContentForRefine,
  startRefineSession,
  sendRefineMessage,
  answerRefineQuestion,
  cancelRefineTurn,
  closeRefineSession,
  finalizeRefineRun,
  cleanBenchmarkSnapshot,
  cleanupSkillSidecar,
  acquireLock,
  releaseLock,
} from "@/lib/tauri";
import type { SkillSummary } from "@/lib/types";
import { deriveModelLabel } from "@/lib/utils";
import { extractStructuredResultPayload as extractStructuredResultFromDisplayItems } from "@/lib/agent-results";
import { ChatPanel } from "@/components/refine/chat-panel";
import { PreviewPanel } from "@/components/refine/preview-panel";
import type { RefineQuestionResponse } from "@/stores/refine-store";

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
  const activeRunTurns = useAgentStore((s) =>
    activeAgentId ? s.runs[activeAgentId]?.contextHistory?.length ?? 0 : 0,
  );

  // Cumulative session metrics (accumulated across all agent runs)
  const [sessionTurns, setSessionTurns] = useState(0);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);

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
      // Reset session metrics for the new skill.
      setSessionTurns(0);
      setSessionTokens(0);
      setSessionCost(0);

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

  // --- Send a message ---
  const handleSend = useCallback(
    async (text: string, targetFiles?: string[]) => {
      const store = useRefineStore.getState();
      const sessionId = store.sessionId;
      if (!selectedSkill || !workspacePath || !sessionId) return;
      if (store.isRunning) return;

      console.log(
        "[workspace-refine] send: skill=%s files=%s",
        selectedSkill.name,
        targetFiles?.join(",") ?? "all",
      );

      const model = preferredModel ?? "sonnet";

      runSkillRef.current = selectedSkill;
      store.setPendingRedirect(null);
      store.setGitDiff(null);
      store.addUserMessage(text, targetFiles);
      store.setRunning(true);

      try {
        const agentId = await sendRefineMessage(
          sessionId,
          text,
          workspacePath,
          targetFiles,
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
    [selectedSkill, workspacePath, preferredModel],
  );

  const handleCancel = useCallback(async () => {
    const store = useRefineStore.getState();
    if (!store.sessionId || !store.isRunning) {
      return;
    }

    console.log("[workspace-refine] cancel: session=%s", store.sessionId);

    try {
      await cancelRefineTurn(store.sessionId);
    } catch (err) {
      console.error("[workspace-refine] Failed to cancel refine turn:", err);
      toast.error("Failed to cancel current run", {
        duration: Infinity,
        cause: err,
        context: { operation: "workspace_refine_cancel" },
      });
    }
    // Do NOT optimistically clear running state here. The agent completion
    // useEffect watches activeRunStatus for a terminal event ("completed",
    // "error", "shutdown") and handles cleanup. This ensures the UI only
    // transitions when the stream has actually stopped.
  }, []);


  const handleQuestionSubmit = useCallback(
    async (message: RefineMessage, response: RefineQuestionResponse) => {
      const store = useRefineStore.getState();
      const sessionId = store.sessionId;
      const agentId = store.activeAgentId;
      if (!selectedSkill || !workspacePath || !sessionId || !agentId || !message.toolUseId || !message.questions) {
        throw new Error("Refine question session is no longer available");
      }

      const redirectLabel = response.selectedLabels.find((label) =>
        label.toLowerCase().startsWith("launch "),
      );
      if (redirectLabel?.toLowerCase().includes("validate")) {
        const userMessages = store.messages.filter((entry) => entry.role === "user");
        store.setPendingRedirect({
          command: "validate",
          text: userMessages.length > 0 ? userMessages[userMessages.length - 1]?.userText ?? "" : "",
        });
      } else if (
        redirectLabel?.toLowerCase().includes("benchmark")
        || redirectLabel?.toLowerCase().includes("eval")
      ) {
        const userMessages = store.messages.filter((entry) => entry.role === "user");
        store.setPendingRedirect({
          command: "benchmark",
          text: userMessages.length > 0 ? userMessages[userMessages.length - 1]?.userText ?? "" : "",
        });
      } else {
        store.setPendingRedirect(null);
      }

      await answerRefineQuestion(
        sessionId,
        agentId,
        message.toolUseId,
        message.questions,
        response.answers,
      );
      store.answerQuestionMessage(message.id, response);
    },
    [selectedSkill, workspacePath],
  );

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

    if (activeRunStatus === "error") {
      toast.error("Agent failed — check the chat for details", { duration: Infinity });
    }
    // "shutdown" status is user-initiated (cancel) — no error toast needed.

    // Accumulate session-level metrics from the completed run.
    const agentRun = useAgentStore.getState().runs[activeAgentId];
    if (agentRun) {
      const runTurns = agentRun.contextHistory?.length ?? 0;
      const runTokens = agentRun.tokenUsage
        ? agentRun.tokenUsage.input + agentRun.tokenUsage.output
        : 0;
      const runCost = agentRun.totalCost ?? 0;
      setSessionTurns((prev) => prev + runTurns);
      setSessionTokens((prev) => prev + runTokens);
      setSessionCost((prev) => prev + runCost);
    }

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
          if (finalized.diff) {
            store.attachDiffToLastAgentTurn(finalized.diff);
          }
        } catch {
          try {
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
        await cleanBenchmarkSnapshot(completionSkill.name, workspacePath).catch(() => {});
        const files = await loadSkillFiles(workspacePath, completionSkill.name);
        if (files) {
          store.updateSkillFiles(files);
          store.setGitDiff(null);
        }
      }

      const pendingRedirect = store.pendingRedirect;
      store.setPendingRedirect(null);
      store.setRunning(false);
      store.setActiveAgentId(null);
      runSkillRef.current = null;

      if (pendingRedirect) {
        const redirectText = pendingRedirect.command
          ? `${pendingRedirect.command} this skill${pendingRedirect.text ? `: ${pendingRedirect.text}` : ""}`
          : pendingRedirect.text;
        if (redirectText) {
          setTimeout(() => {
            void handleSend(redirectText);
          }, 0);
        }
      }
    };

    void complete();
  }, [activeAgentId, activeRunStatus, workspacePath, selectedSkill, extractStructuredResultPayload, handleSend]);

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
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <div className="h-full">
      <ChatPanel
        onSend={handleSend}
        onCancel={handleCancel}
        isRunning={isRunning}
        hasSkill={!!selectedSkill}
        availableFiles={availableFiles}
            scopeBlocked={scopeBlocked}
            onQuestionSubmit={handleQuestionSubmit}
          />
          <PreviewPanel key={previewRevision} />
        </div>
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
        {(sessionTurns + activeRunTurns) > 0 && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
              {sessionTurns + activeRunTurns} {sessionTurns + activeRunTurns === 1 ? "turn" : "turns"}
            </span>
          </>
        )}
        {sessionTokens > 0 && !isRunning && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
              {formatTokenCount(sessionTokens)} tokens
            </span>
          </>
        )}
        {sessionCost > 0 && !isRunning && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
              ${sessionCost.toFixed(4)}
            </span>
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
