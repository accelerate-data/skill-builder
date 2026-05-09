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
import type { SkillFile } from "@/stores/refine-store";
import { useAgentStore, formatTokenCount } from "@/stores/agent-store";
import {
  getSkillContentForRefine,
  sendRefineMessage,
  finalizeRefineRun,
  cleanBenchmarkSnapshot,
} from "@/lib/tauri";
import { leaveCurrentSkill } from "@/lib/active-skill-transition";
import type { EditableSkill } from "@/lib/types";
import { deriveModelLabel } from "@/lib/utils";
import { extractStructuredResultPayload as extractStructuredResultFromDisplayItems } from "@/lib/agent-results";
import { ChatPanel } from "@/components/refine/chat-panel";
import { initAgentStream } from "@/hooks/use-agent-stream";
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";

interface WorkspaceRefineProps {
  skill: EditableSkill;
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

export function WorkspaceRefine({ skill }: WorkspaceRefineProps) {
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const selectedModel = useSettingsStore((s) => s.modelSettings.model);
  const availableModels = useSettingsStore((s) => s.availableModels);

  const selectedSkill = useRefineStore((s) => s.selectedSkill);
  const skillFiles = useRefineStore((s) => s.skillFiles);
  const isRunning = useRefineStore((s) => s.isRunning);
  const activeAgentId = useRefineStore((s) => s.activeAgentId);
  const activeSkill = selectedSkill ?? skill;

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

  const scopeBlocked = useScopeBlocked(activeSkill, "refine");

  const extractStructuredResultPayload = useCallback((agentId: string) => {
    const run = useAgentStore.getState().runs[agentId];
    return extractStructuredResultFromDisplayItems(run?.displayItems);
  }, []);

  useEffect(() => {
    void initAgentStream();
  }, []);

  // Navigation guard
  const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
    shouldBlock: () => useRefineStore.getState().isRunning,
    onLeave: (proceed) => {
      void leaveCurrentSkill({ expectedSkillName: activeSkill.name })
        .then(() => proceed())
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : String(err), {
            duration: Infinity,
          });
        });
    },
  });

  const availableFiles = useMemo(
    () => skillFiles.map((f) => f.filename),
    [skillFiles],
  );
  const availableAgents = useRefineStore((s) => s.availableAgents);

  useEffect(() => {
    const store = useRefineStore.getState();
    if (!workspacePath) return;
    if (
      store.selectedSkill?.name === skill.name &&
      store.selectedSkill.plugin_slug === skill.plugin_slug &&
      store.skillFiles.length > 0
    ) {
      return;
    }

    let cancelled = false;
    store.setLoadingFiles(true);
    setSessionTurns(0);
    setSessionTokens(0);
    setSessionCost(0);
    void loadSkillFiles(workspacePath, skill.name, skill.plugin_slug)
      .then((files) => {
        if (cancelled) return;
        if (!files) {
          store.setLoadingFiles(false);
          toast.error("Could not load skill files", { duration: Infinity });
          return;
        }
        store.setSkillFiles(files);
        store.setGitDiff(null);
        if (files.length > 0) {
          store.setActiveFileTab(files[0].filename);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        store.setLoadingFiles(false);
        toast.error(error instanceof Error ? error.message : String(error), {
          duration: Infinity,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [skill.name, skill.plugin_slug, workspacePath]);

  // --- Send a message ---
  const handleSend = useCallback(
    async (text: string, targetFiles?: string[]) => {
      const store = useRefineStore.getState();
      const conversationId = store.conversationId;
      if (!activeSkill) return;
      if (store.isRunning) return;
      if (!conversationId) {
        const message = `Refine session for '${activeSkill.name}' has no active conversation`;
        console.error("[workspace-refine] %s", message);
        toast.error(message, { duration: Infinity });
        return;
      }

      console.log(
        "[workspace-refine] send: skill=%s files=%s",
        activeSkill.name,
        targetFiles?.join(",") ?? "all",
      );

      runSkillRef.current = activeSkill;
      store.setPendingFollowupMessage(null);
      store.setGitDiff(null);
      store.setRunning(true);
      store.addUserMessage(text, targetFiles);

      try {
        const dispatch = await sendRefineMessage(
          activeSkill.name,
          activeSkill.plugin_slug,
          conversationId,
          text,
          targetFiles,
        );
        const { agent_id: agentId } = dispatch;

        useAgentStore
          .getState()
          .registerRun(
            agentId,
            selectedModel ?? "openhands",
            activeSkill.name,
            "refine",
            `synthetic:refine:${activeSkill.name}:${conversationId}`,
          );

        store.addAgentTurn(agentId);
        store.setActiveAgentId(agentId);
      } catch (err) {
        console.error("[workspace-refine] Failed to send refine message:", err);
        const nextMessages = [...useRefineStore.getState().messages];
        const lastMessage = nextMessages[nextMessages.length - 1];
        if (lastMessage?.role === "user" && lastMessage.userText === text) {
          nextMessages.pop();
          useRefineStore.getState().setMessages(nextMessages);
        }
        store.setRunning(false);
        store.setActiveAgentId(null);
        toast.error(err instanceof Error ? err.message : String(err), {
          duration: Infinity,
        });
      }
    },
    [activeSkill, selectedModel],
  );

  // --- Watch agent completion ---
  useEffect(() => {
    if (!activeAgentId || !activeRunStatus) return;

    const isTerminal = ["completed", "error", "shutdown", "cancelled"].includes(
      activeRunStatus,
    );
    if (!isTerminal) return;

    // Clear stopping state when terminal event arrives
    useRefineStore.getState().setStopping(false);

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
    // "shutdown" / "cancelled" statuses are user-initiated pause/cancel
    // outcomes — no error toast needed.

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

    const completionSkill = runSkillRef.current ?? activeSkill;

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
    activeSkill,
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
    : null;

  const isStopping = useRefineStore((s) => s.isStopping);

  const footerStatus: FooterDisplayStatus = isStopping
    ? "stopping"
    : isRunning
      ? "running"
      : "idle";

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <ChatPanel
          onSend={handleSend}
          hasSkill={!!activeSkill}
          availableFiles={availableFiles}
          availableAgents={availableAgents}
          scopeBlocked={scopeBlocked}
        />
      </div>

      <RunStatusFooter
        status={footerStatus}
        label={activeSkill?.name ?? null}
        model={modelLabel}
        elapsedMs={isRunning ? elapsed : null}
        turns={sessionTurns + activeRunTurns > 0 ? sessionTurns + activeRunTurns : null}
        tokenCount={sessionTokens > 0 && !isRunning ? formatTokenCount(sessionTokens) : null}
        cost={sessionCost > 0 && !isRunning ? `$${sessionCost.toFixed(4)}` : null}
        testId="refine-status-footer"
      />

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
