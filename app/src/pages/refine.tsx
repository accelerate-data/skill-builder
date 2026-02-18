import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "@tanstack/react-router";
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
import type { RefineCommand, RefineMessage, SkillFile } from "@/stores/refine-store";
import { useAgentStore } from "@/stores/agent-store";
import {
  listRefinableSkills,
  getSkillContentForRefine,
  startRefineSession,
  sendRefineMessage,
  closeRefineSession,
} from "@/lib/tauri";
import type { SkillSummary } from "@/lib/types";
import { ResizableSplitPane } from "@/components/refine/resizable-split-pane";
import { SkillPicker } from "@/components/refine/skill-picker";
import { ChatPanel } from "@/components/refine/chat-panel";
import { PreviewPanel } from "@/components/refine/preview-panel";

// Ensure agent-stream listeners are registered
import "@/hooks/use-agent-stream";

/**
 * Build structured conversation history for the sidecar's conversationHistory parameter.
 * Includes all previous messages (user + agent) so the sidecar has full context.
 */
function buildConversationHistory(
  messages: RefineMessage[],
  runs: Record<string, { messages: { type: string; content?: string }[] }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const msg of messages) {
    if (msg.role === "user" && msg.userText) {
      history.push({ role: "user", content: msg.userText });
    } else if (msg.role === "agent" && msg.agentId) {
      const agentRun = runs[msg.agentId];
      if (agentRun) {
        const lastText = agentRun.messages
          .filter((m) => m.type === "assistant" && m.content)
          .map((m) => m.content)
          .pop();
        if (lastText) {
          history.push({ role: "assistant", content: lastText });
        }
      }
    }
  }
  return history;
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

  const [pendingSwitchSkill, setPendingSwitchSkill] = useState<SkillSummary | null>(null);
  const autoSelectedRef = useRef(false);

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
      if (isRunning) {
        setPendingSwitchSkill(skill);
        return;
      }

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
    [isRunning, workspacePath],
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

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      const store = useRefineStore.getState();
      if (store.sessionId) {
        closeRefineSession(store.sessionId).catch(() => {});
      }
      if (store.isRunning && store.activeAgentId) {
        store.setRunning(false);
        store.setActiveAgentId(null);
      }
    };
  }, []);

  // --- Confirm switch skill while running ---
  const handleConfirmSwitch = useCallback(() => {
    if (!pendingSwitchSkill) return;
    const store = useRefineStore.getState();
    if (store.sessionId) {
      closeRefineSession(store.sessionId).catch(() => {});
    }
    store.setRunning(false);
    store.setActiveAgentId(null);
    setPendingSwitchSkill(null);
    handleSelectSkill(pendingSwitchSkill);
  }, [pendingSwitchSkill, handleSelectSkill]);

  // --- Send a message ---
  const handleSend = useCallback(
    async (text: string, targetFiles?: string[], command?: RefineCommand) => {
      const store = useRefineStore.getState();
      const sessionId = store.sessionId;
      if (!selectedSkill || !workspacePath || !sessionId) return;
      if (isRunning) return; // guard against double-submission race

      console.log("[refine] send: skill=%s command=%s files=%s", selectedSkill.name, command ?? "refine", targetFiles?.join(",") ?? "all");

      const model = preferredModel ?? "sonnet";

      // Build structured conversation history BEFORE adding the new message
      const conversationHistory = buildConversationHistory(
        store.messages,
        useAgentStore.getState().runs,
      );

      // Snapshot baseline for diff
      store.snapshotBaseline();

      // Add user message
      store.addUserMessage(text, targetFiles, command);

      // Mark running before async call to prevent double-submission
      store.setRunning(true);

      try {
        // sendRefineMessage builds the full prompt server-side with all 3 paths,
        // skill type, command, and user context. We pass raw user input.
        const agentId = await sendRefineMessage(
          sessionId,
          text,
          conversationHistory,
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

      {/* Confirm switch skill dialog */}
      <Dialog
        open={!!pendingSwitchSkill}
        onOpenChange={(open) => !open && setPendingSwitchSkill(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch skill?</DialogTitle>
            <DialogDescription>
              An agent is currently running. Switching skills will stop it and
              clear the chat history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingSwitchSkill(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmSwitch}>Switch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
