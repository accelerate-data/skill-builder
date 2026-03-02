import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearch, useBlocker } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkillPicker } from "@/components/refine/skill-picker";
import { useAgentStore, flushMessageBuffer } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useTestStore } from "@/stores/test-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  listRefinableSkills,
  getWorkspacePath,
  getDisabledSteps,
  startAgent,
  cleanupSkillSidecar,
  prepareSkillTest,
  cleanupSkillTest,
  hasRunningAgents,
} from "@/lib/tauri";
import type { SkillSummary } from "@/lib/types";
import { cn, deriveModelLabel } from "@/lib/utils";

// Ensure agent-stream listeners are registered
import "@/hooks/use-agent-stream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "idle" | "running" | "evaluating" | "done" | "error";

interface TestState {
  phase: Phase;
  selectedSkill: SkillSummary | null;
  prompt: string;
  testId: string | null;
  baselineCwd: string | null;
  transcriptLogDir: string | null;
  withAgentId: string | null;
  withoutAgentId: string | null;
  evalAgentId: string | null;
  withText: string;
  withoutText: string;
  evalText: string;
  withDone: boolean;
  withoutDone: boolean;
  startTime: number | null;
  errorMessage: string | null;
}

const INITIAL_STATE: TestState = {
  phase: "idle",
  selectedSkill: null,
  prompt: "",
  testId: null,
  baselineCwd: null,
  transcriptLogDir: null,
  withAgentId: null,
  withoutAgentId: null,
  evalAgentId: null,
  withText: "",
  withoutText: "",
  evalText: "",
  withDone: false,
  withoutDone: false,
  startTime: null,
  errorMessage: null,
};

const TERMINAL_STATUSES = new Set(["completed", "error", "shutdown"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract accumulated assistant text content from agent store messages.
 * Includes text blocks and AskUserQuestion inputs so the evaluator can see
 * what clarification questions the agent asked. */
function extractAssistantText(agentId: string): string {
  const run = useAgentStore.getState().runs[agentId];
  if (!run) return "";
  return run.messages
    .filter((m) => m.type === "assistant")
    .map((m) => {
      const textContent = m.content ?? "";
      // Capture AskUserQuestion inputs so the evaluator sees what was asked
      const apiBlocks = (
        (m.raw?.message as Record<string, unknown> | undefined)?.content
      ) as Array<{ type: string; name?: string; input?: Record<string, unknown> }> | undefined;
      const questions = Array.isArray(apiBlocks)
        ? apiBlocks
            .filter((b) => b.type === "tool_use" && b.name === "AskUserQuestion")
            .map((b) => (typeof b.input?.question === "string" ? b.input.question : ""))
            .filter(Boolean)
        : [];
      return [textContent, ...questions].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

/** Build the evaluator prompt from both plans. */
function buildEvalPrompt(
  userPrompt: string,
  skillName: string,
  withPlanText: string,
  withoutPlanText: string,
): string {
  return `Task prompt:
"""
${userPrompt}
"""

Plan A (with skill "${skillName}" loaded):
"""
${withPlanText}
"""

Plan B (no skill loaded):
"""
${withoutPlanText}
"""

Use the Evaluation Rubric from your context to compare the two plans.

First, output bullet points (one per line) using:
- \u2191 if Plan A (with skill) is meaningfully better on this dimension
- \u2193 if Plan B (no skill) is meaningfully better on this dimension
- \u2192 if both plans are similar, weak, or neither is clearly better

Then output a "## Recommendations" section with 2-4 specific, actionable suggestions for how to improve the skill based on the evaluation. Focus on gaps where Plan A underperformed or where the skill could have provided more guidance.`;
}

type EvalDirection = "up" | "down" | "neutral" | null;

interface EvalLine {
  direction: EvalDirection;
  text: string;
}

/** Parse an evaluator line into direction and text.
 * Strips leading markdown bullet prefixes (-, *, •) before detecting direction. */
function parseEvalLine(line: string): EvalLine {
  const trimmed = line.trim();
  if (!trimmed) return { direction: null, text: "" };
  // Strip optional markdown bullet (-, *, •) so "- ↑ text" parses correctly
  const stripped = trimmed.replace(/^[-*•]\s*/, "");
  if (stripped.startsWith("\u2191")) return { direction: "up", text: stripped.slice(1).trim() };
  if (stripped.startsWith("\u2193")) return { direction: "down", text: stripped.slice(1).trim() };
  if (stripped.startsWith("\u2192")) return { direction: "neutral", text: stripped.slice(1).trim() };
  return { direction: null, text: trimmed };
}

/** Split evaluator output into directional bullet lines and a recommendations block. */
function parseEvalOutput(text: string): { lines: EvalLine[]; recommendations: string } {
  const markerMatch = /^##\s*recommendations/im.exec(text);
  if (!markerMatch) {
    return {
      lines: text.split("\n").map(parseEvalLine).filter((l) => l.text.length > 0),
      recommendations: "",
    };
  }
  const bulletSection = text.slice(0, markerMatch.index).trim();
  const recsSection = text.slice(markerMatch.index + markerMatch[0].length).trim();
  return {
    lines: bulletSection.split("\n").map(parseEvalLine).filter((l) => l.text.length > 0),
    recommendations: recsSection,
  };
}

/** Return the arrow character for an eval direction. */
function evalDirectionIcon(direction: EvalDirection): string {
  switch (direction) {
    case "up": return "\u2191";
    case "down": return "\u2193";
    case "neutral": return "\u2192";
    default: return "\u2022";
  }
}

/** Return the color class for an eval direction's icon. */
function evalIconColor(direction: EvalDirection): string {
  switch (direction) {
    case "up": return "text-[var(--color-seafoam)]";
    case "down": return "text-destructive";
    case "neutral": return "text-muted-foreground";
    default: return "text-muted-foreground/50";
  }
}

/** Return the row background class for an eval direction. */
function evalRowBg(direction: EvalDirection): string {
  switch (direction) {
    case "up": return "bg-[var(--color-seafoam)]/5";
    case "down": return "bg-destructive/5";
    default: return "";
  }
}

/** Return the evaluator placeholder message based on phase. */
function evalPlaceholder(phase: Phase, errorMessage: string | null): string {
  switch (phase) {
    case "idle": return "Evaluation will appear after both plans complete";
    case "running": return "Waiting for both plans to finish...";
    case "evaluating": return "Evaluating differences...";
    case "error": return errorMessage ?? "An error occurred";
    default: return "No evaluation results";
  }
}

/** Auto-scroll a container to the bottom. */
function scrollToBottom(ref: React.RefObject<HTMLDivElement | null>): void {
  if (ref.current) {
    ref.current.scrollTop = ref.current.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PlanPanelProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  text: string;
  phase: Phase;
  label: string;
  badgeText: string;
  badgeClass: string;
  idlePlaceholder: string;
}

function PlanPanel({ scrollRef, text, phase, label, badgeText, badgeClass, idlePlaceholder }: PlanPanelProps) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Badge className={cn("text-xs px-1.5 py-0", badgeClass)}>
          {badgeText}
        </Badge>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-4">
        {text ? (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
            {text}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground/40 italic">
            {phase === "idle" ? idlePlaceholder : "Waiting for agent response..."}
          </p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TestPage() {
  const navigate = useNavigate();
  const { skill: skillParam } = useSearch({ from: "/test" });

  // --- Skills list ---
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(true);

  // --- Test state ---
  const [state, setState] = useState<TestState>(INITIAL_STATE);

  // --- Scope recommendation guard ---
  const [scopeBlocked, setScopeBlocked] = useState(false);

  // --- Elapsed timer ---
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Divider positions ---
  const [vSplit, setVSplit] = useState(50); // vertical: left panel %
  const [hSplit, setHSplit] = useState(60); // horizontal: top section %
  const vDragging = useRef(false);
  const hDragging = useRef(false);
  const planContainerRef = useRef<HTMLDivElement>(null);
  const outerContainerRef = useRef<HTMLDivElement>(null);

  // --- Auto-scroll refs ---
  const withScrollRef = useRef<HTMLDivElement>(null);
  const withoutScrollRef = useRef<HTMLDivElement>(null);
  const evalScrollRef = useRef<HTMLDivElement>(null);

  // --- Polling interval for agent text ---
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable ref to latest state for callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---------------------------------------------------------------------------
  // Load skills on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    getWorkspacePath()
      .then((wp) => listRefinableSkills(wp))
      .then((list) => {
        if (!cancelled) {
          setSkills(list);
          setIsLoadingSkills(false);
        }
      })
      .catch((err) => {
        console.error("[test] Failed to load skills:", err);
        if (!cancelled) setIsLoadingSkills(false);
        toast.error("Failed to load skills");
      });
    return () => { cancelled = true; };
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-select skill from search param
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!skillParam || skills.length === 0) return;
    const match = skills.find((s) => s.name === skillParam);
    if (match) {
      console.log("[test] pre-selected skill from search param: %s", skillParam);
      setState((prev) => ({ ...prev, selectedSkill: match }));
    }
  }, [skillParam, skills]);

  // ---------------------------------------------------------------------------
  // Scope recommendation guard
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!state.selectedSkill) {
      setScopeBlocked(false);
      return;
    }
    getDisabledSteps(state.selectedSkill.name)
      .then((disabled) => {
        const blocked = disabled.length > 0;
        setScopeBlocked(blocked);
        if (blocked) console.warn("[test] Scope recommendation active for skill '%s' — testing blocked", state.selectedSkill!.name);
      })
      .catch(() => setScopeBlocked(false));
  }, [state.selectedSkill]);

  // ---------------------------------------------------------------------------
  // Draggable dividers
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (vDragging.current && planContainerRef.current) {
        const rect = planContainerRef.current.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setVSplit(Math.min(78, Math.max(22, pct)));
      }
      if (hDragging.current && outerContainerRef.current) {
        const rect = outerContainerRef.current.getBoundingClientRect();
        const pct = ((e.clientY - rect.top) / rect.height) * 100;
        setHSplit(Math.min(82, Math.max(22, pct)));
      }
    };
    const onUp = () => {
      vDragging.current = false;
      hDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Elapsed timer management
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (state.phase === "running" || state.phase === "evaluating") {
      if (!timerRef.current && state.startTime) {
        timerRef.current = setInterval(() => {
          setElapsed(Date.now() - state.startTime!);
        }, 100);
      }
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state.phase, state.startTime]);

  // ---------------------------------------------------------------------------
  // Poll agent store for streaming text
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (state.phase === "idle" || state.phase === "done" || state.phase === "error") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(() => {
      const s = stateRef.current;

      let updated = false;
      let newWithText = s.withText;
      let newWithoutText = s.withoutText;
      let newEvalText = s.evalText;

      if (s.withAgentId) {
        const text = extractAssistantText(s.withAgentId);
        if (text !== s.withText) {
          newWithText = text;
          updated = true;
        }
      }
      if (s.withoutAgentId) {
        const text = extractAssistantText(s.withoutAgentId);
        if (text !== s.withoutText) {
          newWithoutText = text;
          updated = true;
        }
      }
      if (s.evalAgentId) {
        const text = extractAssistantText(s.evalAgentId);
        if (text !== s.evalText) {
          newEvalText = text;
          updated = true;
        }
      }

      if (updated) {
        setState((prev) => ({
          ...prev,
          withText: newWithText,
          withoutText: newWithoutText,
          evalText: newEvalText,
        }));
      }
    }, 150);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [state.phase]);

  // ---------------------------------------------------------------------------
  // Auto-scroll panels
  // ---------------------------------------------------------------------------

  useEffect(() => scrollToBottom(withScrollRef), [state.withText]);
  useEffect(() => scrollToBottom(withoutScrollRef), [state.withoutText]);
  useEffect(() => scrollToBottom(evalScrollRef), [state.evalText]);

  // ---------------------------------------------------------------------------
  // Watch agent exits to transition phases
  // ---------------------------------------------------------------------------

  const withStatus = useAgentStore((s) =>
    state.withAgentId ? s.runs[state.withAgentId]?.status : undefined,
  );
  const withoutStatus = useAgentStore((s) =>
    state.withoutAgentId ? s.runs[state.withoutAgentId]?.status : undefined,
  );
  const evalStatus = useAgentStore((s) =>
    state.evalAgentId ? s.runs[state.evalAgentId]?.status : undefined,
  );

  // Track when plan agents complete
  useEffect(() => {
    if (state.phase !== "running") return;
    if (!state.withAgentId || !state.withoutAgentId) return;

    const withTerminal = withStatus != null && TERMINAL_STATUSES.has(withStatus);
    const withoutTerminal = withoutStatus != null && TERMINAL_STATUSES.has(withoutStatus);

    if (withTerminal && !state.withDone) {
      setState((prev) => ({ ...prev, withDone: true }));
    }
    if (withoutTerminal && !state.withoutDone) {
      setState((prev) => ({ ...prev, withoutDone: true }));
    }
  }, [state.phase, state.withAgentId, state.withoutAgentId, withStatus, withoutStatus, state.withDone, state.withoutDone]);

  // Both plan agents done -> start evaluator
  useEffect(() => {
    if (state.phase !== "running") return;
    if (!state.withDone || !state.withoutDone) return;
    if (!state.selectedSkill) return;

    // Flush message buffer so final text is available
    flushMessageBuffer();

    const withText = state.withAgentId
      ? extractAssistantText(state.withAgentId)
      : "";
    const withoutText = state.withoutAgentId
      ? extractAssistantText(state.withoutAgentId)
      : "";

    // Check for errors
    const withErr = withStatus === "error" || withStatus === "shutdown";
    const withoutErr = withoutStatus === "error" || withoutStatus === "shutdown";

    if (withErr && withoutErr) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        withText,
        withoutText,
        errorMessage: "Both agents failed",
      }));
      cleanup(state.testId);
      return;
    }

    // Start evaluator
    const ts = Date.now();
    const evalId = `__test_baseline__-test-eval-${ts}`;
    const evalPrompt = buildEvalPrompt(
      state.prompt,
      state.selectedSkill.name,
      withText,
      withoutText,
    );

    setState((prev) => ({
      ...prev,
      phase: "evaluating",
      withText,
      withoutText,
      evalAgentId: evalId,
    }));

    // Reuse the baseline workspace created during handleRunTest
    if (!state.baselineCwd || !state.transcriptLogDir) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: "Missing baseline workspace for evaluator",
      }));
      return;
    }

    const evalModel = useSettingsStore.getState().preferredModel ?? "sonnet";
    useAgentStore.getState().registerRun(evalId, evalModel, "__test_baseline__");
    startAgent(
      evalId,
      evalPrompt,
      evalModel,
      state.baselineCwd,
      [],
      15,
      "plan",
      undefined,
      "__test_baseline__",
      "test-eval",
      "test-evaluator",
      state.transcriptLogDir,
    ).catch((err) => {
      console.error("[test] Failed to start evaluator agent:", err);
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: `Evaluator failed to start: ${String(err)}`,
      }));
    });
  }, [state.phase, state.withDone, state.withoutDone, withStatus, withoutStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Evaluator done -> cleanup
  useEffect(() => {
    if (state.phase !== "evaluating") return;
    if (!state.evalAgentId) return;
    if (!evalStatus || !TERMINAL_STATUSES.has(evalStatus)) return;

    flushMessageBuffer();

    const evalText = extractAssistantText(state.evalAgentId);

    setState((prev) => ({
      ...prev,
      phase: evalStatus === "completed" ? "done" : "error",
      evalText,
      errorMessage:
        evalStatus !== "completed" ? "Evaluator agent failed" : null,
    }));

    cleanup(state.testId);
  }, [state.phase, state.evalAgentId, evalStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Cleanup helper
  // ---------------------------------------------------------------------------

  const cleanup = useCallback((testId: string | null) => {
    if (testId) {
      cleanupSkillTest(testId).catch((err) =>
        console.warn("[test] cleanup_skill_test failed:", err),
      );
    }
    cleanupSkillSidecar("__test_baseline__").catch((err) =>
      console.warn("[test] cleanup sidecar failed:", err),
    );
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      flushMessageBuffer();
      const s = stateRef.current;
      if (s.phase === "running" || s.phase === "evaluating") {
        cleanup(s.testId);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSelectSkill = useCallback((skill: SkillSummary) => {
    setState((prev) => ({ ...prev, selectedSkill: skill }));
  }, []);

  const handleRunTest = useCallback(async () => {
    const s = stateRef.current;
    if (!s.selectedSkill || !s.prompt.trim()) {
      toast.error("Select a skill and enter a prompt");
      return;
    }
    if (s.phase === "running" || s.phase === "evaluating") return;

    console.log("[test] starting test: skill=%s", s.selectedSkill.name);

    // Guard: don't clobber in-progress workflow runs
    const agentsRunning = await hasRunningAgents().catch(() => false);
    if (agentsRunning) {
      toast.error("Cannot start test while other agents are running");
      return;
    }

    // Clear previous test runs from agent store
    useAgentStore.getState().clearRuns();

    const ts = Date.now();
    const skillName = s.selectedSkill.name;
    const withId = `${skillName}-test-with-${ts}`;
    const withoutId = `__test_baseline__-test-without-${ts}`;

    setState((prev) => ({
      ...INITIAL_STATE,
      selectedSkill: prev.selectedSkill,
      prompt: prev.prompt,
      phase: "running",
      withAgentId: withId,
      withoutAgentId: withoutId,
      startTime: ts,
    }));
    setElapsed(0);

    let preparedTestId: string | undefined;
    try {
      const workspacePath = await getWorkspacePath();
      const prepared = await prepareSkillTest(workspacePath, skillName);
      preparedTestId = prepared.test_id;

      setState((prev) => ({
        ...prev,
        testId: prepared.test_id,
        baselineCwd: prepared.baseline_cwd,
        transcriptLogDir: prepared.transcript_log_dir,
      }));

      // Register runs in agent store
      const testModel = useSettingsStore.getState().preferredModel ?? "sonnet";
      useAgentStore.getState().registerRun(withId, testModel, skillName);
      useAgentStore.getState().registerRun(withoutId, testModel, "__test_baseline__");

      // Wrap the prompt so plan agents know the domain context
      const wrappedPrompt = `You are a data engineer and the user is trying to do the following task:\n\n${s.prompt}`;

      // Start both agents in parallel
      await Promise.all([
        startAgent(
          withId,
          wrappedPrompt,
          testModel,
          prepared.with_skill_cwd,
          [],
          15,
          "plan",
          undefined,
          skillName,
          "test-with",
          "test-plan-with",
          prepared.transcript_log_dir,
        ),
        startAgent(
          withoutId,
          wrappedPrompt,
          testModel,
          prepared.baseline_cwd,
          [],
          15,
          "plan",
          undefined,
          "__test_baseline__",
          "test-without",
          "test-plan-without",
          prepared.transcript_log_dir,
        ),
      ]);
    } catch (err) {
      console.error("[test] Failed to start test:", err);
      // Clean up temp dir if it was created before the failure
      if (preparedTestId) cleanup(preparedTestId);
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: `Failed to start test: ${String(err)}`,
      }));
      toast.error("Failed to start test");
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const isRunning = state.phase === "running" || state.phase === "evaluating";

  // Sync phase to global test store so CloseGuard can detect running agents.
  useEffect(() => {
    useTestStore.getState().setRunning(isRunning);
    return () => { useTestStore.getState().setRunning(false); };
  }, [isRunning]);

  // --- Navigation guard ---
  const { proceed, reset: resetBlocker, status: blockerStatus } = useBlocker({
    shouldBlockFn: () => useTestStore.getState().isRunning,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const handleNavStay = useCallback(() => {
    resetBlocker?.();
  }, [resetBlocker]);

  const handleNavLeave = useCallback(() => {
    useTestStore.getState().setRunning(false);
    useAgentStore.getState().clearRuns();
    cleanup(stateRef.current.testId);
    proceed?.();
  }, [proceed, cleanup]);

  const elapsedStr = `${(elapsed / 1000).toFixed(1)}s`;
  const activeModel = useSettingsStore((s) => s.preferredModel ?? "sonnet");
  const modelLabel = deriveModelLabel(activeModel);

  const { lines: evalLines, recommendations: evalRecommendations } = parseEvalOutput(state.evalText);

  const handleRefine = useCallback(() => {
    if (!state.selectedSkill) return;
    const message = evalRecommendations
      ? `The skill evaluation identified these improvement opportunities:\n\n${evalRecommendations}\n\nPlease refine the skill to address these gaps.`
      : `The skill evaluation identified these gaps:\n\n${evalLines.filter((l) => l.direction === "down").map((l) => `• ${l.text}`).join("\n")}\n\nPlease refine the skill to address these gaps.`;
    useRefineStore.getState().setPendingInitialMessage(message);
    navigate({ to: "/refine", search: { skill: state.selectedSkill.name } });
  }, [evalLines, evalRecommendations, state.selectedSkill, navigate]);

  // ---------------------------------------------------------------------------
  // Status bar config
  // ---------------------------------------------------------------------------

  const statusConfig: Record<Phase, { dotClass: string; dotStyle?: React.CSSProperties; label: string }> = {
    idle: { dotClass: "bg-zinc-500", label: "ready" },
    running: { dotClass: "animate-pulse", dotStyle: { background: "var(--color-pacific)" }, label: "running..." },
    evaluating: { dotClass: "", dotStyle: { background: "var(--color-pacific)" }, label: "evaluating..." },
    done: { dotClass: "", dotStyle: { background: "var(--color-seafoam)" }, label: "completed" },
    error: { dotClass: "bg-destructive", label: state.errorMessage ?? "error" },
  };

  const { dotClass, dotStyle, label: statusLabel } = statusConfig[state.phase];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col">
      {/* Top bar: skill picker + prompt + run button */}
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <SkillPicker
            skills={skills}
            selected={state.selectedSkill}
            isLoading={isLoadingSkills}
            disabled={isRunning}
            onSelect={handleSelectSkill}
          />
        </div>
        {scopeBlocked && state.selectedSkill && (
          <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Scope recommendation active — the skill scope is too broad.</span>
            <button
              className="ml-auto shrink-0 underline underline-offset-2"
              onClick={() => navigate({ to: "/skill/$skillName", params: { skillName: state.selectedSkill!.name } })}
            >
              Go to Workflow →
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            rows={3}
            placeholder="Describe a task to test the skill against..."
            value={state.prompt}
            onChange={(e) =>
              setState((prev) => ({ ...prev, prompt: e.target.value }))
            }
            disabled={isRunning || scopeBlocked}
            className="min-h-[unset] resize-none font-sans text-sm"
          />
          <Button
            onClick={handleRunTest}
            disabled={isRunning || scopeBlocked || !state.selectedSkill || !state.prompt.trim()}
            className="h-auto shrink-0 self-start px-4"
          >
            {isRunning ? (
              <>
                <Square className="size-3.5" />
                Running
              </>
            ) : (
              <>
                <Play className="size-3.5" />
                Run Test
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main content area: plan panels + evaluator */}
      <div ref={outerContainerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Plan panels (top zone) */}
        <div
          ref={planContainerRef}
          className="flex overflow-hidden"
          style={{ height: `${hSplit}%` }}
        >
          {/* With-skill panel */}
          <div
            className="flex flex-col overflow-hidden border-r border-border"
            style={{ width: `${vSplit}%` }}
          >
            <PlanPanel
              scrollRef={withScrollRef}
              text={state.withText}
              phase={state.phase}
              label="Agent Plan"
              badgeText="with skill"
              badgeClass="bg-[#2D7A35]/15 text-[#5D9B62]"
              idlePlaceholder="Run a test to see the with-skill plan"
            />
          </div>

          {/* Vertical divider */}
          <div
            className="w-1 shrink-0 cursor-col-resize border-x border-border bg-background transition-colors hover:bg-primary"
            onMouseDown={(e) => {
              e.preventDefault();
              vDragging.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />

          {/* Without-skill panel */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <PlanPanel
              scrollRef={withoutScrollRef}
              text={state.withoutText}
              phase={state.phase}
              label="Agent Plan"
              badgeText="no skill"
              badgeClass="bg-[#A85A33]/15 text-[#D4916E]"
              idlePlaceholder="Run a test to see the no-skill plan"
            />
          </div>
        </div>

        {/* Horizontal divider */}
        <div
          className="h-1 shrink-0 cursor-row-resize border-y border-border bg-background transition-colors hover:bg-primary"
          onMouseDown={(e) => {
            e.preventDefault();
            hDragging.current = true;
            document.body.style.cursor = "row-resize";
            document.body.style.userSelect = "none";
          }}
        />

        {/* Evaluator panel (bottom zone) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Evaluator
            </span>
          </div>
          <div
            ref={evalScrollRef}
            className="flex-1 overflow-auto p-4"
          >
            {evalLines.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  {evalLines.map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-2.5 rounded border-b border-border/40 px-1 py-1.5 last:border-0",
                        "animate-in fade-in-0 slide-in-from-bottom-1",
                        evalRowBg(line.direction),
                      )}
                      style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}
                    >
                      <span className={cn("mt-0.5 shrink-0 text-xs font-bold", evalIconColor(line.direction))}>
                        {evalDirectionIcon(line.direction)}
                      </span>
                      <span className="font-mono text-xs leading-relaxed text-foreground">
                        {line.text}
                      </span>
                    </div>
                  ))}
                </div>

                {evalRecommendations && (
                  <div className="rounded-md border border-[var(--color-pacific)]/20 bg-[var(--color-pacific)]/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-pacific)]">
                        Recommendations
                      </p>
                      {state.phase === "done" && state.selectedSkill && (
                        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleRefine}>
                          Refine skill
                        </Button>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                      {evalRecommendations}
                    </pre>
                  </div>
                )}
              </div>
            ) : state.phase === "idle" && !state.selectedSkill ? (
              <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm font-medium text-muted-foreground">Test your skill</p>
                <p className="text-xs text-muted-foreground/60">Select a skill and describe a task to see how it performs with and without the skill loaded.</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40 italic">
                {evalPlaceholder(state.phase, state.errorMessage)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation guard dialog */}
      {blockerStatus === "blocked" && (
        <Dialog open onOpenChange={(open) => { if (!open) handleNavStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Test Still Running</DialogTitle>
              <DialogDescription>
                Agents are still running. Leaving will stop them and discard results.
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

      {/* Status bar */}
      <div className="flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4">
        <div className="flex items-center gap-1.5">
          <div className={cn("size-[5px] rounded-full", dotClass)} style={dotStyle} />
          <span className="text-xs text-muted-foreground/60">
            {statusLabel}
          </span>
        </div>
        {state.selectedSkill && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground/60">
              {state.selectedSkill.name}
            </span>
          </>
        )}
        <span className="text-muted-foreground/20">&middot;</span>
        <span className="text-xs text-muted-foreground/60">plan mode</span>
        <span className="text-muted-foreground/20">&middot;</span>
        <span className="text-xs text-muted-foreground/60">{modelLabel}</span>
        {state.startTime && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground/60">
              {elapsedStr}
            </span>
          </>
        )}
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground/20">
          no context &middot; fresh run
        </span>
      </div>
    </div>
  );
}
