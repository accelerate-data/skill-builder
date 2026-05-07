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
  cancelRefineTurn,
  closeRefineSession,
  finalizeRefineRun,
  cleanBenchmarkSnapshot,
  acquireLock,
  releaseLock,
} from "@/lib/tauri";
import type { EditableSkill } from "@/lib/types";
import { deriveModelLabel } from "@/lib/utils";
import { extractStructuredResultPayload as extractStructuredResultFromDisplayItems } from "@/lib/agent-results";
import { ChatPanel } from "@/components/refine/chat-panel";
import { initAgentStream } from "@/hooks/use-agent-stream";

interface WorkspaceRefineProps {
  skill: EditableSkill;
}

/** Fire-and-forget: release skill lock and shut down persistent sidecar. */
function releaseSkillResources(skillName: string, reason: string): void {
  releaseLock(skillName).catch((e) =>
    console.warn("[workspace-refine] non-fatal: op=releaseLock err=%s", e),
  );
  console.log("[workspace-refine] releaseLock: %s (%s)", skillName, reason);
}

/** Load skill files from disk, returning null on failure. */
async function loadSkillFiles(
  basePath: string,
  skillName: string,
  pluginSlug: string,
): Promise<SkillFile[] | null> {
  try {
    const contents = await getSkillContentForRefine(
      skillName,
      basePath,
      pluginSlug,
    );
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

function mapRestoredMessages(
  restoredMessages: Array<{ role: string; content: string }> | null | undefined,
): RefineMessage[] {
  return (restoredMessages ?? [])
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      id: crypto.randomUUID(),
      role: message.role === "user" ? "user" : "agent",
      userText: message.role === "user" ? message.content : undefined,
      agentText: message.role === "user" ? undefined : message.content,
      timestamp: Date.now(),
    }));
}

export function WorkspaceRefine({ skill }: WorkspaceRefineProps) {
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const selectedModel = useSettingsStore((s) => s.modelSettings.model);
  const availableModels = useSettingsStore((s) => s.availableModels);

  const selectedSkill = useRefineStore((s) => s.selectedSkill);
  const skillFiles = useRefineStore((s) => s.skillFiles);
  const isRunning = useRefineStore((s) => s.isRunning);
  const activeAgentId = useRefineStore((s) => s.activeAgentId);

  const activeRunStatus = useAgentStore((s) =>
    activeAgentId ? s.runs[activeAgentId]?.status : undefined,
  );
  const activeRunTurns = useAgentStore((s) =>
    activeAgentId ? (s.runs[activeAgentId]?.contextHistory?.length ?? 0) : 0,
  );

  // Cumulative session metrics (accumulated across all agent runs)
  const [sessionTurns, setSessionTurns] = useState(0);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);

  // Capture the skill that was active when the agent started, so the
  // completion effect attributes output to the correct skill even if the
  // user switches skills while an agent is running.
  const runSkillRef = useRef<EditableSkill | null>(null);

  const scopeBlocked = useScopeBlocked(selectedSkill, "refine");

  const extractStructuredResultPayload = useCallback((agentId: string) => {
    const run = useAgentStore.getState().runs[agentId];
    return extractStructuredResultFromDisplayItems(run?.displayItems);
  }, []);

  // Release skill lock on unmount
  useEffect(() => {
    void initAgentStream();
    return () => {
      const store = useRefineStore.getState();
      if (store.selectedSkill) {
        if (store.sessionId) {
          closeRefineSession(store.sessionId).catch((e) =>
            console.warn(
              "[workspace-refine] non-fatal: op=closeRefineSession err=%s",
              e,
            ),
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
          console.warn(
            "[workspace-refine] non-fatal: op=closeRefineSession err=%s",
            e,
          ),
        );
      }

      if (store.selectedSkill) {
        releaseSkillResources(store.selectedSkill.name, "navigation");
      }

      store.clearSession();
      proceed();
    },
  });

  const availableFiles = useMemo(
    () => skillFiles.map((f) => f.filename),
    [skillFiles],
  );
  const availableAgents = useRefineStore((s) => s.availableAgents);

  // --- Select skill on mount ---
  const handleSelectSkill = useCallback(
    async (s: EditableSkill) => {
      console.log("[workspace-refine] selectSkill: %s", s.name);
      const store = useRefineStore.getState();

      if (store.selectedSkill?.name === s.name && store.sessionId) return;

      const prevSkill = store.selectedSkill;
      if (prevSkill && prevSkill.name !== s.name) {
        await releaseLock(prevSkill.name).catch((e) =>
          console.warn(
            "[workspace-refine] non-fatal: op=releaseLock err=%s",
            e,
          ),
        );
      }

      try {
        await acquireLock(s.name);
        console.log("[workspace-refine] acquireLock: %s", s.name);
      } catch (err) {
        console.error("[workspace-refine] acquireLock failed: %s", s.name, err);
        toast.error(
          `Cannot open Refine: ${err instanceof Error ? err.message : String(err)}`,
          {
            duration: Infinity,
            cause: err,
            context: {
              operation: "workspace_refine_acquire_lock",
              skillName: s.name,
            },
          },
        );
        return;
      }

      const prevSessionId = store.sessionId;
      if (prevSessionId) {
        await closeRefineSession(prevSessionId).catch((err) =>
          console.warn(
            "[workspace-refine] Failed to close previous session:",
            err,
          ),
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
          const session = await startRefineSession(
            s.name,
            workspacePath,
            s.plugin_slug,
          );
          const nextStore = useRefineStore.getState();
          nextStore.setSessionId(session.session_id);
          nextStore.setAvailableAgents(session.available_agents ?? []);
          nextStore.setMessages(mapRestoredMessages(session.restored_messages));
        } catch (err) {
          console.error(
            "[workspace-refine] Failed to start refine session:",
            err,
          );
          toast.error("Failed to start refine session", { duration: Infinity });
          store.setLoadingFiles(false);
          return;
        }

        const files = await loadSkillFiles(
          workspacePath,
          s.name,
          s.plugin_slug,
        );
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

      runSkillRef.current = selectedSkill;
      store.setPendingFollowupMessage(null);
      store.setGitDiff(null);
      store.addUserMessage(text, targetFiles);
      store.setRunning(true);

      try {
        const agentId = await sendRefineMessage(
          sessionId,
          text,
          workspacePath,
          selectedSkill.plugin_slug,
          targetFiles,
        );

        useAgentStore
          .getState()
          .registerRun(
            agentId,
            selectedModel ?? "openhands",
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
        toast.error(err instanceof Error ? err.message : String(err), {
          duration: Infinity,
        });
      }
    },
    [selectedSkill, workspacePath, selectedModel],
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

  // Escape key → interrupt active run
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useRefineStore.getState().isRunning) {
        e.preventDefault();
        handleCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleCancel]);

  // --- Watch agent completion ---
  useEffect(() => {
    if (!activeAgentId || !activeRunStatus) return;

    const isTerminal = ["completed", "error", "shutdown"].includes(
      activeRunStatus,
    );
    if (!isTerminal) return;

    console.log(
      "[workspace-refine] agent %s finished: status=%s",
      activeAgentId,
      activeRunStatus,
    );

    if (activeRunStatus === "error") {
      toast.error("Agent failed — check the chat for details", {
        duration: Infinity,
      });
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
            completionSkill.plugin_slug,
            hasStructuredObject ? structuredOutput : undefined,
          );
          store.updateSkillFiles(
            finalized.files.map(
              (file): SkillFile => ({
                filename: file.path,
                content: file.content,
              }),
            ),
          );
          store.setGitDiff(finalized.diff);
          if (finalized.diff) {
            store.attachDiffToLastAgentTurn(finalized.diff);
          }
        } catch {
          try {
            const files = await loadSkillFiles(
              workspacePath,
              completionSkill.name,
              completionSkill.plugin_slug,
            );
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
        await cleanBenchmarkSnapshot(
          completionSkill.name,
          workspacePath,
          completionSkill.plugin_slug,
        ).catch(() => {});
        const files = await loadSkillFiles(
          workspacePath,
          completionSkill.name,
          completionSkill.plugin_slug,
        );
        if (files) {
          store.updateSkillFiles(files);
          store.setGitDiff(null);
        }
      }

      const pendingFollowupMessage = store.pendingFollowupMessage;
      store.setPendingFollowupMessage(null);
      store.setRunning(false);
      store.setActiveAgentId(null);
      runSkillRef.current = null;

      if (pendingFollowupMessage) {
        setTimeout(() => {
          void handleSend(pendingFollowupMessage);
        }, 0);
      }
    };

    void complete();
  }, [
    activeAgentId,
    activeRunStatus,
    workspacePath,
    selectedSkill,
    extractStructuredResultPayload,
    handleSend,
  ]);

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

  const activeModel = selectedModel;
  const modelLabel = activeModel
    ? (availableModels.find((m) => m.id === activeModel)?.displayName ??
      deriveModelLabel(activeModel))
    : "No model selected";

  const dotStyle = isRunning
    ? { background: "var(--color-pacific)" }
    : selectedSkill
      ? { background: "var(--color-seafoam)" }
      : undefined;
  const dotClass = isRunning
    ? "animate-pulse"
    : selectedSkill
      ? ""
      : "bg-zinc-500";
  const statusLabel = isRunning
    ? "running..."
    : selectedSkill
      ? "ready"
      : "loading...";
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <ChatPanel
          onSend={handleSend}
          onCancel={handleCancel}
          isRunning={isRunning}
          hasSkill={!!selectedSkill}
          availableFiles={availableFiles}
          availableAgents={availableAgents}
          scopeBlocked={scopeBlocked}
        />
      </div>

      {/* Status bar */}
      <div className="flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4">
        <div className="flex items-center gap-1.5">
          <div
            className={`size-[5px] rounded-full ${dotClass}`}
            style={dotStyle}
          />
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        </div>
        {selectedSkill && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground">
              {selectedSkill.name}
            </span>
          </>
        )}
        <span className="text-muted-foreground/20">&middot;</span>
        <span className="text-xs text-muted-foreground">{modelLabel}</span>
        {isRunning && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground">
              {(elapsed / 1000).toFixed(1)}s
            </span>
          </>
        )}
        {sessionTurns + activeRunTurns > 0 && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
              {sessionTurns + activeRunTurns}{" "}
              {sessionTurns + activeRunTurns === 1 ? "turn" : "turns"}
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) handleNavStay();
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Agent Running</DialogTitle>
              <DialogDescription>
                An agent is still running. Leaving will abandon it and end the
                session.
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
