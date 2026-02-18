import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Brain,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  runWorkflowStep,
  readFile,
} from "@/lib/tauri";
import { countDecisions } from "@/lib/reasoning-parser";
import { AgentStatusHeader } from "@/components/agent-status-header";
import {
  MessageItem,
  TurnMarker,
  computeMessageGroups,
  computeToolCallGroups,
  ToolCallGroup,
  spacingClasses,
} from "@/components/agent-output-panel";

// --- Types ---

export interface ReasoningReviewProps {
  skillName: string;
  domain: string;
  workspacePath: string;
  onStepComplete: () => void;
}

// --- Component ---

export function ReasoningReview({
  skillName,
  domain,
  workspacePath,
  onStepComplete,
}: ReasoningReviewProps) {
  const STEP_ID = 4;

  // Agent state
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const launchedRef = useRef(false);

  // Decisions content (loaded after agent completes)
  const [decisionsContent, setDecisionsContent] = useState<string | null>(null);

  // Stores
  const currentRun = useAgentStore((s) => currentAgentId ? s.runs[currentAgentId] : null);
  const agentRegisterRun = useAgentStore((s) => s.registerRun);
  const { updateStepStatus, setRunning, currentStep } = useWorkflowStore();
  const skillsPath = useSettingsStore((s) => s.skillsPath);

  const isAgentRunning = currentRun?.status === "running";
  const agentCompleted = currentRun?.status === "completed";
  const agentErrored = currentRun?.status === "error";

  const bottomRef = useRef<HTMLDivElement>(null);

  // --- Auto-start agent on mount ---

  const launchAgent = useCallback(async () => {
    try {
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);

      const agentId = await runWorkflowStep(skillName, STEP_ID, domain, workspacePath);
      agentRegisterRun(agentId, "opus");
      setCurrentAgentId(agentId);
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(
        `Failed to start reasoning agent: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      );
    }
  }, [skillName, domain, workspacePath, currentStep, updateStepStatus, setRunning, agentRegisterRun]);

  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    launchAgent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Scroll to bottom on new messages ---

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentRun?.messages.length]);

  // --- Load decisions when agent completes ---

  const loadDecisions = useCallback(async () => {
    // skills_path is required — no workspace fallback
    if (!skillsPath) return;

    try {
      const result = await readFile(`${skillsPath}/${skillName}/context/decisions.md`);
      if (result && result.trim().length > 0) {
        setDecisionsContent(result);
      }
    } catch {
      // not found
    }
  }, [skillName, skillsPath]);

  useEffect(() => {
    if (agentCompleted) {
      setRunning(false);
      loadDecisions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentCompleted]);

  useEffect(() => {
    if (agentErrored) {
      setRunning(false);
      toast.error("Reasoning agent encountered an error", { duration: Infinity });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentErrored]);

  // --- Handlers ---

  const handleCompleteStep = useCallback(async () => {
    // Validate decisions.md exists in skillsPath (required — no workspace fallback)
    let decisionsFound = false;

    if (skillsPath) {
      try {
        const content = await readFile(`${skillsPath}/${skillName}/context/decisions.md`);
        if (content && content.trim().length > 0) decisionsFound = true;
      } catch {
        // not found
      }
    }

    if (!decisionsFound) {
      toast.error(
        "Decisions file was not created. The reasoning agent did not produce decisions.md. " +
        "Navigate back to Review in the sidebar to revise your answers, then re-run this step.",
        { duration: Infinity },
      );
      return;
    }

    updateStepStatus(currentStep, "completed");
    setRunning(false);
    toast.success("Reasoning step completed");
    onStepComplete();
  }, [skillName, skillsPath, currentStep, updateStepStatus, setRunning, onStepComplete]);

  // --- Pre-compute message groups for streaming output ---

  const turnMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!currentRun) return map;
    let turn = 0;
    for (let i = 0; i < currentRun.messages.length; i++) {
      if (currentRun.messages[i].type === "assistant") {
        turn++;
        map.set(i, turn);
      }
    }
    return map;
  }, [currentRun?.messages]);

  const messageGroups = useMemo(
    () => currentRun ? computeMessageGroups(currentRun.messages, turnMap) : [],
    [currentRun?.messages, turnMap],
  );

  const toolCallGroupMap = useMemo(
    () => currentRun ? computeToolCallGroups(currentRun.messages) : { groups: new Map(), memberOf: new Map() },
    [currentRun?.messages],
  );

  // --- Render: Agent running / streaming output ---

  if (!agentCompleted && !agentErrored) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {currentAgentId ? (
          <>
            <AgentStatusHeader agentId={currentAgentId} title="Reasoning Agent" />
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col p-3">
                {currentRun?.messages.map((msg, i) => {
                  const turn = turnMap.get(i) ?? 0;
                  const spacing = spacingClasses[messageGroups[i]];

                  // Skip group members (rendered by group leader)
                  if (toolCallGroupMap.memberOf.has(i) && toolCallGroupMap.memberOf.get(i) !== i) {
                    return null;
                  }

                  const groupIndices = toolCallGroupMap.groups.get(i);
                  const content = groupIndices ? (
                    <ToolCallGroup messages={groupIndices.map((idx: number) => currentRun.messages[idx])} />
                  ) : (
                    <MessageItem message={msg} />
                  );

                  return (
                    <Fragment key={`${msg.timestamp}-${i}`}>
                      {turn > 0 && <TurnMarker turn={turn} />}
                      <div className={`${spacing} animate-message-in`}>
                        {content}
                      </div>
                    </Fragment>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    );
  }

  // --- Render: Agent completed — show decisions ---

  const decisionCount = decisionsContent ? countDecisions(decisionsContent) : 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">Decisions</h3>
          {decisionsContent && (
            <Badge variant="secondary" className="text-xs">
              {decisionCount} {decisionCount === 1 ? "decision" : "decisions"}
            </Badge>
          )}
        </div>
        {agentErrored && (
          <Badge variant="destructive" className="text-xs">
            Agent Error
          </Badge>
        )}
      </div>

      {/* Decisions content */}
      <ScrollArea className="min-h-0 flex-1">
        {decisionsContent ? (
          <div className="markdown-body compact max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {decisionsContent}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
            {agentErrored ? (
              <p className="text-sm">
                The reasoning agent encountered an error and did not produce decisions.
              </p>
            ) : (
              <Loader2 className="size-5 animate-spin" />
            )}
          </div>
        )}
      </ScrollArea>

      {/* Action buttons */}
      <div className="flex items-center justify-end border-t px-4 py-3">
        <Button
          size="sm"
          onClick={handleCompleteStep}
          disabled={isAgentRunning}
        >
          <CheckCircle2 className="size-3.5" />
          Complete Step
        </Button>
      </div>
    </div>
  );
}
