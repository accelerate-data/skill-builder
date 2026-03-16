import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  startAgent,
  cleanupSkillSidecar,
  prepareSkillTest,
  cleanupSkillTest,
} from "@/lib/tauri";
import type { SkillSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Phase = "idle" | "running" | "evaluating" | "done" | "error";

export interface TestState {
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

export const INITIAL_STATE: TestState = {
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
const TEST_RUN_STEP_ID = -11;

// ---------------------------------------------------------------------------
// Helpers (non-hook, pure functions)
// ---------------------------------------------------------------------------

/** Extract accumulated output text from agent display items.
 * Collects text from output and tool_call display items. */
export function extractAssistantText(agentId: string): string {
  const run = useAgentStore.getState().runs[agentId];
  if (!run) return "";
  return run.displayItems
    .filter((di) => di.type === "output" || di.type === "tool_call")
    .map((di) => di.outputText ?? di.toolSummary ?? "")
    .filter(Boolean)
    .join("\n");
}

/** Build the evaluator prompt from both plans. */
export function buildEvalPrompt(
  userPrompt: string,
  skillName: string,
  withPlanText: string,
  withoutPlanText: string,
): string {
  return `Task prompt:
"""
${userPrompt}
"""

Plan A (Vibedata + ${skillName} skill):
"""
${withPlanText}
"""

Plan B (Vibedata Only, no skill):
"""
${withoutPlanText}
"""

Use the Evaluation Rubric from your context to compare the two plans.

First, output bullet points (one per line) in this exact format:
- \u2191 **dimension name** \u2014 explanation why Plan A is meaningfully better
- \u2193 **dimension name** \u2014 explanation why Plan B is meaningfully better
- \u2192 **dimension name** \u2014 explanation why both are similar or neither is clearly better

One bullet per evaluation dimension. Start each line with the direction symbol, then the **bolded dimension name**, then " \u2014 " and the explanation.

Then output a "## Recommendations" section with 2-4 specific, actionable suggestions for how to improve the skill based on the evaluation. Focus on gaps where Plan A underperformed or where the skill could have provided more guidance.`;
}

export function buildSyntheticTestSessionId(skillName: string, testId: string): string {
  return `synthetic:test:${skillName}:${testId}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseTestOrchestrationOptions {
  workspacePath: string | null;
}

export interface UseTestOrchestrationReturn {
  state: TestState;
  setState: React.Dispatch<React.SetStateAction<TestState>>;
  handleRunTest: () => Promise<void>;
  cleanup: (testId: string | null) => void;
  isRunning: boolean;
  elapsed: number;
  withStatus: string | undefined;
  withCost: number | undefined;
  withoutStatus: string | undefined;
  withoutCost: number | undefined;
  evalStatus: string | undefined;
  evalCost: number | undefined;
}

export function useTestOrchestration({
  workspacePath,
}: UseTestOrchestrationOptions): UseTestOrchestrationReturn {
  // --- Test state ---
  const [state, setState] = useState<TestState>(INITIAL_STATE);

  // --- Elapsed timer ---
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Polling interval for agent text ---
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable ref to latest state for callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

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
  // Watch agent exits to transition phases
  // ---------------------------------------------------------------------------

  const withStatus = useAgentStore((s) =>
    state.withAgentId ? s.runs[state.withAgentId]?.status : undefined,
  );
  const withCost = useAgentStore((s) =>
    state.withAgentId ? s.runs[state.withAgentId]?.totalCost : undefined,
  );
  const withoutStatus = useAgentStore((s) =>
    state.withoutAgentId ? s.runs[state.withoutAgentId]?.status : undefined,
  );
  const withoutCost = useAgentStore((s) =>
    state.withoutAgentId ? s.runs[state.withoutAgentId]?.totalCost : undefined,
  );
  const evalStatus = useAgentStore((s) =>
    state.evalAgentId ? s.runs[state.evalAgentId]?.status : undefined,
  );
  const evalCost = useAgentStore((s) =>
    state.evalAgentId ? s.runs[state.evalAgentId]?.totalCost : undefined,
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
    const evalId = `${state.selectedSkill.name}-test-eval-${ts}`;
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
    const syntheticTestSessionId = buildSyntheticTestSessionId(
      state.selectedSkill.name,
      state.testId ?? "unknown",
    );
    useAgentStore.getState().registerRun(
      evalId,
      evalModel,
      state.selectedSkill.name,
      "test",
      syntheticTestSessionId,
    );
    startAgent(
      evalId,
      evalPrompt,
      evalModel,
      state.baselineCwd,
      [],
      15,
      "plan",
      syntheticTestSessionId,
      state.selectedSkill.name,
      "test-evaluator",
      undefined,                  // agentName — evaluator uses skill-test context, not a plugin agent
      state.transcriptLogDir ?? undefined,  // transcriptLogDir
      TEST_RUN_STEP_ID,
      undefined,
      syntheticTestSessionId,
      "test",
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
      const s = stateRef.current;
      if (s.phase === "running" || s.phase === "evaluating") {
        cleanup(s.testId);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // handleRunTest
  // ---------------------------------------------------------------------------

  const handleRunTest = useCallback(async () => {
    const s = stateRef.current;
    if (!s.selectedSkill || !s.prompt.trim()) {
      toast.error("Select a skill and enter a prompt", { duration: Infinity });
      return;
    }
    if (s.phase === "running" || s.phase === "evaluating") return;

    console.log("[test] starting test: skill=%s", s.selectedSkill.name);

    // Guard: don't clobber in-progress workflow or refine runs
    const wf = useWorkflowStore.getState();
    const agentsRunning =
      wf.isRunning || wf.gateLoading || useRefineStore.getState().isRunning;
    if (agentsRunning) {
      toast.error("Cannot start test while other agents are running", { duration: Infinity });
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
      if (!workspacePath) {
        throw new Error("Workspace path not configured");
      }
      const prepared = await prepareSkillTest(workspacePath, skillName);
      preparedTestId = prepared.test_id;

      setState((prev) => ({
        ...prev,
        testId: prepared.test_id,
        baselineCwd: prepared.baseline_cwd,
        transcriptLogDir: prepared.transcript_log_dir,
      }));

      const syntheticTestSessionId = buildSyntheticTestSessionId(
        skillName,
        prepared.test_id,
      );

      // Register runs in agent store
      const testModel = useSettingsStore.getState().preferredModel ?? "sonnet";
      useAgentStore
        .getState()
        .registerRun(withId, testModel, skillName, "test", syntheticTestSessionId);
      useAgentStore
        .getState()
        .registerRun(withoutId, testModel, skillName, "test", syntheticTestSessionId);

      // Prepend empty-workspace context so agents don't waste turns searching for
      // existing code. The test workspace is always freshly created by prepareSkillTest.
      const wrappedPrompt =
        `Note: This is a brand new, empty project workspace. ` +
        `No files, code, or directory structure exist yet.\n\n${s.prompt}`;

      // Start both agents in parallel using the vd-agent data-product-builder.
      // With-skill: CLAUDE.md includes @-import of the skill under test.
      // Baseline: vd-agent only, no skill context.
      await Promise.all([
        startAgent(
          withId,
          wrappedPrompt,
          testModel,
          prepared.with_skill_cwd,
          [],
          15,
          "plan",
          syntheticTestSessionId,
          skillName,
          "test-plan-with",
          "data-product-builder",       // agentName -> --agent data-product-builder
          prepared.transcript_log_dir,  // transcriptLogDir
          TEST_RUN_STEP_ID,
          undefined,
          syntheticTestSessionId,
          "test",
        ),
        startAgent(
          withoutId,
          wrappedPrompt,
          testModel,
          prepared.baseline_cwd,
          [],
          15,
          "plan",
          syntheticTestSessionId,
          "__test_baseline__",          // separate sidecar key -- prevents abort race with with-skill agent
          "test-plan-without",
          "data-product-builder",       // agentName -> --agent data-product-builder
          prepared.transcript_log_dir,  // transcriptLogDir
          TEST_RUN_STEP_ID,
          undefined,
          syntheticTestSessionId,
          "test",
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
      toast.error("Failed to start test", { duration: Infinity });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const isRunning = state.phase === "running" || state.phase === "evaluating";

  return {
    state,
    setState,
    handleRunTest,
    cleanup,
    isRunning,
    elapsed,
    withStatus,
    withCost,
    withoutStatus,
    withoutCost,
    evalStatus,
    evalCost,
  };
}
