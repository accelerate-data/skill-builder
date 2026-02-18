import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearch, useBlocker } from "@tanstack/react-router";
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
} from "@/lib/tauri";
import type { SkillSummary } from "@/lib/types";
import { ResizableSplitPane } from "@/components/refine/resizable-split-pane";
import { SkillPicker } from "@/components/refine/skill-picker";
import { ChatPanel } from "@/components/refine/chat-panel";
import { PreviewPanel } from "@/components/refine/preview-panel";

// Ensure agent-stream listeners are registered
import "@/hooks/use-agent-stream";

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

  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const preferredModel = useSettingsStore((s) => s.preferredModel);

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

  const autoSelectedRef = useRef(false);

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

    // Fire-and-forget: shut down persistent sidecar for this skill
    if (store.selectedSkill) {
      cleanupSkillSidecar(store.selectedSkill.name).catch(() => {});
    }

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
        // Start backend refine session — pass workspacePath (.vibedata),
        // Rust resolves skills_path from DB for file lookups.
        try {
          const session = await startRefineSession(skill.name, workspacePath);
          useRefineStore.setState({ sessionId: session.session_id });
        } catch (err) {
          console.error("[refine] Failed to start refine session:", err);
          toast.error("Failed to start refine session");
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
    if (!skillParam || autoSelectedRef.current || refinableSkills.length === 0) return;

    const match = refinableSkills.find((s) => s.name === skillParam);
    if (match) {
      autoSelectedRef.current = true;
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

      // Fire-and-forget: shut down persistent sidecar
      if (store.selectedSkill) {
        cleanupSkillSidecar(store.selectedSkill.name).catch(() => {});
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

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col">
      {/* Top bar with skill picker */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <SkillPicker
          skills={refinableSkills}
          selected={selectedSkill}
          isLoading={isLoadingSkills}
          disabled={isRunning}
          onSelect={handleSelectSkill}
        />
      </div>

      {/* Main split pane */}
      <div className="min-h-0 flex-1">
        <ResizableSplitPane
          left={
            <ChatPanel
              onSend={handleSend}
              isRunning={isRunning}
              hasSkill={!!selectedSkill}
              availableFiles={availableFiles}
            />
          }
          right={<PreviewPanel />}
        />
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
