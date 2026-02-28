import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useNavigate, useSearch, useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";
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
import type { RefineCommand, SkillFile } from "@/stores/refine-store";
import { useAgentStore, flushMessageBuffer } from "@/stores/agent-store";
import {
  listRefinableSkills,
  getSkillContentForRefine,
  startRefineSession,
  sendRefineMessage,
  closeRefineSession,
  cleanupSkillSidecar,
  acquireLock,
  releaseLock,
  getDisabledSteps,
} from "@/lib/tauri";
import { useSkillStore } from "@/stores/skill-store";
import type { SkillSummary } from "@/lib/types";
import { deriveModelLabel } from "@/lib/utils";
import { ResizableSplitPane } from "@/components/refine/resizable-split-pane";
import { SkillPicker } from "@/components/refine/skill-picker";
import { ChatPanel } from "@/components/refine/chat-panel";
import { PreviewPanel } from "@/components/refine/preview-panel";

// Ensure agent-stream listeners are registered
import "@/hooks/use-agent-stream";

/** Fire-and-forget: release skill lock and shut down persistent sidecar. */
function releaseSkillResources(skillName: string, reason: string): void {
  releaseLock(skillName).catch(() => {});
  console.log("[refine] releaseLock: %s (%s)", skillName, reason);
  cleanupSkillSidecar(skillName).catch(() => {});
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
    console.error("[refine] Failed to load skill files:", err);
    return null;
  }
}

export default function RefinePage() {
  const { skill: skillParam } = useSearch({ from: "/refine" });
  const navigate = useNavigate();

  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const preferredModel = useSettingsStore((s) => s.preferredModel);
  const availableModels = useSettingsStore((s) => s.availableModels);
  const lockedSkills = useSkillStore((s) => s.lockedSkills);

  const selectedSkill = useRefineStore((s) => s.selectedSkill);
  const refinableSkills = useRefineStore((s) => s.refinableSkills);
  const isLoadingSkills = useRefineStore((s) => s.isLoadingSkills);
  const skillFiles = useRefineStore((s) => s.skillFiles);
  const isRunning = useRefineStore((s) => s.isRunning);
  const activeAgentId = useRefineStore((s) => s.activeAgentId);

  // Subscribe only to the active run's status — NOT the entire runs object.
  // Subscribing to `s.runs` causes the whole page to re-render on every agent message flush.
  const activeRunStatus = useAgentStore((s) =>
    activeAgentId ? s.runs[activeAgentId]?.status : undefined,
  );

  // Track which skillParam was last auto-selected so navigating back with a
  // different skill (e.g. from the skill library) triggers a fresh selection.
  const autoSelectedRef = useRef<string | null>(null);

  // --- Scope recommendation guard ---
  // When scope recommendation is active (disabledSteps non-empty), block refine commands.
  const [scopeBlocked, setScopeBlocked] = useState(false);

  useEffect(() => {
    if (!selectedSkill) {
      setScopeBlocked(false);
      return;
    }
    getDisabledSteps(selectedSkill.name)
      .then((disabled) => {
        const blocked = disabled.length > 0;
        setScopeBlocked(blocked);
        if (blocked) console.warn("[refine] Scope recommendation active for skill '%s' — refine blocked", selectedSkill.name);
      })
      .catch(() => setScopeBlocked(false));
  }, [selectedSkill]);

  // --- Navigation guard ---
  // Block navigation while an agent is running and show a confirmation dialog.
  const { proceed, reset: resetBlocker, status: blockerStatus } = useBlocker({
    shouldBlockFn: () => useRefineStore.getState().isRunning,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const handleNavStay = useCallback(() => {
    resetBlocker?.();
  }, [resetBlocker]);

  const handleNavLeave = useCallback(() => {
    const store = useRefineStore.getState();

    store.setRunning(false);
    store.setActiveAgentId(null);
    useAgentStore.getState().clearRuns();

    // Fire-and-forget: close refine session
    if (store.sessionId) {
      closeRefineSession(store.sessionId).catch(() => {});
    }

    if (store.selectedSkill) {
      releaseSkillResources(store.selectedSkill.name, "navigation");
    }

    // Clear session state so that returning to this page always creates a
    // fresh session. Without this, the stale sessionId remains in the store
    // and the auto-select guard skips session creation, causing send_refine_message
    // to fail on the dead session.
    store.clearSession();
    autoSelectedRef.current = null;

    proceed?.();
  }, [proceed]);

  // Available filenames for @file autocomplete
  const availableFiles = useMemo(
    () => skillFiles.map((f) => f.filename),
    [skillFiles],
  );

  // --- Load refinable skills on mount ---
  useEffect(() => {
    if (!workspacePath) return;

    const store = useRefineStore.getState();
    store.setLoadingSkills(true);

    listRefinableSkills(workspacePath)
      .then((skills) => {
        store.setRefinableSkills(skills);
        store.setLoadingSkills(false);
      })
      .catch((err) => {
        console.error("[refine] Failed to load skills:", err);
        store.setLoadingSkills(false);
        toast.error("Failed to load skills", { duration: Infinity });
      });
  }, [workspacePath]);

  // --- Select a skill ---
  const handleSelectSkill = useCallback(
    async (skill: SkillSummary) => {
      console.log("[refine] selectSkill: %s", skill.name);
      const store = useRefineStore.getState();

      // Skip re-selection only when the same skill is already active with a live session.
      // After navigation away, clearSession() nulls sessionId, so we fall through
      // and create a fresh session even for the same skill.
      if (store.selectedSkill?.name === skill.name && store.sessionId) return;

      // Release lock on previous skill (if any) before acquiring new lock
      const prevSkill = store.selectedSkill;
      if (prevSkill && prevSkill.name !== skill.name) {
        await releaseLock(prevSkill.name).catch(() => {});
        console.log("[refine] releaseLock: %s (skill switch)", prevSkill.name);
      }

      // Acquire lock on the new skill before proceeding
      try {
        await acquireLock(skill.name);
        console.log("[refine] acquireLock: %s", skill.name);
      } catch (err) {
        console.error("[refine] acquireLock failed: %s", skill.name, err);
        toast.error(`Cannot select skill: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      // Close previous backend session if any
      const prevSessionId = store.sessionId;
      if (prevSessionId) {
        await closeRefineSession(prevSessionId).catch((err) =>
          console.warn("[refine] Failed to close previous session:", err),
        );
      }

      // Reset store state (clears sessionId, messages, etc.)
      store.selectSkill(skill);
      store.setLoadingFiles(true);

      if (workspacePath) {
        // Start backend refine session — pass workspacePath (.vibedata/skill-builder),
        // Rust resolves skills_path from DB for file lookups.
        try {
          const session = await startRefineSession(skill.name, workspacePath);
          useRefineStore.setState({ sessionId: session.session_id });
        } catch (err) {
          console.error("[refine] Failed to start refine session:", err);
          toast.error("Failed to start refine session");
          store.setLoadingFiles(false);
          return;
        }

        const files = await loadSkillFiles(workspacePath, skill.name);
        if (files) {
          store.setSkillFiles(files);
          if (files.length > 0) {
            store.setActiveFileTab(files[0].filename);
          }
        } else {
          store.setLoadingFiles(false);
          toast.error("Could not load skill files");
        }
      } else {
        store.setLoadingFiles(false);
      }
    },
    [workspacePath],
  );

  // --- Auto-select skill from search param ---
  useEffect(() => {
    if (!skillParam || refinableSkills.length === 0) return;
    // Re-run if skillParam changes (e.g. navigating back with a different skill).
    if (autoSelectedRef.current === skillParam) return;

    const match = refinableSkills.find((s) => s.name === skillParam);
    if (match) {
      autoSelectedRef.current = skillParam;
      handleSelectSkill(match);
    }
  }, [skillParam, refinableSkills, handleSelectSkill]);

  // --- Watch agent completion (only re-runs when status changes, not every message) ---
  useEffect(() => {
    if (!activeAgentId || !activeRunStatus) return;

    const isTerminal = ["completed", "error", "shutdown"].includes(activeRunStatus);
    if (!isTerminal) return;

    console.log("[refine] agent %s finished: status=%s", activeAgentId, activeRunStatus);

    if (activeRunStatus === "error" || activeRunStatus === "shutdown") {
      toast.error("Agent failed — check the chat for details", { duration: Infinity });
    }

    // Check for session exhaustion — the SDK ran out of turns
    const agentRun = useAgentStore.getState().runs[activeAgentId];
    if (agentRun) {
      const hasExhausted = agentRun.messages.some(
        (m) => (m.raw as Record<string, unknown>)?.type === "session_exhausted",
      );
      if (hasExhausted) {
        console.warn("[refine] session exhausted for agent %s", activeAgentId);
        useRefineStore.getState().setSessionExhausted(true);
        toast.info("This refine session has reached its limit. Please start a new session to continue.");
      }
    }

    // Re-read skill files to capture any changes the agent made
    const store = useRefineStore.getState();
    if (workspacePath && selectedSkill) {
      loadSkillFiles(workspacePath, selectedSkill.name).then((files) => {
        if (files) store.updateSkillFiles(files);
      });
    }

    store.setRunning(false);
    store.setActiveAgentId(null);
  }, [activeAgentId, activeRunStatus, workspacePath, selectedSkill]);

  // --- Safety-net cleanup on unmount ---
  // Catches cases where the component unmounts without going through the blocker dialog.
  useEffect(() => {
    return () => {
      flushMessageBuffer();

      const store = useRefineStore.getState();
      if (store.isRunning) {
        store.setRunning(false);
        store.setActiveAgentId(null);
        useAgentStore.getState().clearRuns();
      }

      // Fire-and-forget: close refine session
      if (store.sessionId) {
        closeRefineSession(store.sessionId).catch(() => {});
      }

      if (store.selectedSkill) {
        releaseSkillResources(store.selectedSkill.name, "unmount");
      }
    };
  }, []);

  // --- Send a message ---
  const handleSend = useCallback(
    async (text: string, targetFiles?: string[], command?: RefineCommand) => {
      const store = useRefineStore.getState();
      const sessionId = store.sessionId;
      if (!selectedSkill || !workspacePath || !sessionId) return;
      if (isRunning) return; // guard against double-submission race

      console.log("[refine] send: skill=%s command=%s files=%s", selectedSkill.name, command ?? "refine", targetFiles?.join(",") ?? "all");

      const model = preferredModel ?? "sonnet";

      // Snapshot baseline for diff
      store.snapshotBaseline();

      // Add user message
      store.addUserMessage(text, targetFiles, command);

      // Mark running before async call to prevent double-submission
      store.setRunning(true);

      try {
        // sendRefineMessage builds the full prompt server-side with all 3 paths,
        // skill type, command, and user context. SDK maintains conversation state
        // across turns via streaming input mode.
        const agentId = await sendRefineMessage(
          sessionId,
          text,
          workspacePath,
          targetFiles,
          command,
        );

        // Register run in agent store (events may have already started streaming —
        // addMessage auto-creates runs, registerRun merges with the correct model)
        useAgentStore.getState().registerRun(agentId, model, selectedSkill.name);

        // Add agent turn to chat
        store.addAgentTurn(agentId);
        store.setActiveAgentId(agentId);
      } catch (err) {
        console.error("[refine] Failed to send refine message:", err);
        store.setRunning(false);
        store.setActiveAgentId(null);
        toast.error("Failed to start agent");
      }
    },
    [selectedSkill, workspacePath, preferredModel, isRunning],
  );

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
    availableModels.find((m) => m.id === activeModel)?.displayName ??
    deriveModelLabel(activeModel);

  const dotStyle = isRunning
    ? { background: "var(--color-pacific)" }
    : selectedSkill
      ? { background: "var(--color-seafoam)" }
      : undefined;
  const dotClass = isRunning ? "animate-pulse" : selectedSkill ? "" : "bg-zinc-500";
  const statusLabel = isRunning ? "running..." : selectedSkill ? "ready" : "no skill selected";

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col">
      {/* Top bar with skill picker */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <SkillPicker
          skills={refinableSkills}
          selected={selectedSkill}
          isLoading={isLoadingSkills}
          disabled={isRunning}
          lockedSkills={lockedSkills}
          onSelect={handleSelectSkill}
        />
      </div>

      {scopeBlocked && selectedSkill && (
        <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Scope recommendation active — refine is blocked until resolved.</span>
          <button
            className="ml-auto shrink-0 underline underline-offset-2"
            onClick={() => navigate({ to: "/skill/$skillName", params: { skillName: selectedSkill.name } })}
          >
            Go to Workflow →
          </button>
        </div>
      )}

      {/* Main split pane */}
      <div className="min-h-0 flex-1">
        <ResizableSplitPane
          left={
            <ChatPanel
              onSend={handleSend}
              isRunning={isRunning}
              hasSkill={!!selectedSkill}
              availableFiles={availableFiles}
              scopeBlocked={scopeBlocked}
            />
          }
          right={<PreviewPanel />}
        />
      </div>

      {/* Status bar */}
      <div className="flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4">
        <div className="flex items-center gap-1.5">
          <div className={`size-[5px] rounded-full ${dotClass}`} style={dotStyle} />
          <span className="text-xs text-muted-foreground/60">{statusLabel}</span>
        </div>
        {selectedSkill && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground/60">{selectedSkill.name}</span>
          </>
        )}
        <span className="text-muted-foreground/20">&middot;</span>
        <span className="text-xs text-muted-foreground/60">{modelLabel}</span>
        {isRunning && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground/60">{(elapsed / 1000).toFixed(1)}s</span>
          </>
        )}
      </div>

      {/* Navigation guard dialog */}
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
