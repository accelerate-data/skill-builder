import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Play, Square } from "lucide-react";
import { toast } from "@/lib/toast";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useScopeBlocked } from "@/hooks/use-scope-blocked";
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
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useTestStore } from "@/stores/test-store";
import { useSettingsStore } from "@/stores/settings-store";
import { listRefinableSkills } from "@/lib/tauri";
import type { SkillSummary } from "@/lib/types";
import { cn, deriveModelLabel } from "@/lib/utils";
import { DisplayItemList } from "@/components/agent-items/display-item-list";
import type { DisplayItem } from "@/lib/display-types";
import {
  parseEvalOutput,
  evalDirectionIcon,
  evalIconColor,
  evalRowBg,
  renderInlineBold,
} from "@/lib/eval-parser";
import { useTestOrchestration } from "@/hooks/use-test-orchestration";
import type { Phase } from "@/hooks/use-test-orchestration";

// Ensure agent-stream listeners are registered
import "@/hooks/use-agent-stream";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Stable empty array — avoids Zustand re-render loop when selector returns []
const NO_DISPLAY_ITEMS: DisplayItem[] = [];

export function StreamingContent({
  agentId,
  phase,
  idlePlaceholder,
  scrollRef,
}: {
  agentId: string | null;
  phase: Phase;
  idlePlaceholder: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const displayItems = useAgentStore((s) =>
    agentId ? (s.runs[agentId]?.displayItems ?? NO_DISPLAY_ITEMS) : NO_DISPLAY_ITEMS,
  );

  useEffect(() => {
    scrollToBottom(scrollRef);
  }, [displayItems.length, scrollRef]);

  if (displayItems.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground/40">
        {phase === "idle" ? idlePlaceholder : "Waiting for agent response..."}
      </p>
    );
  }

  return <DisplayItemList items={displayItems} />;
}

interface PlanPanelProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  text: string;
  agentId?: string | null;
  phase: Phase;
  label: string;
  badgeText: string | React.ReactNode;
  badgeClass: string;
  idlePlaceholder: string;
  cost?: number;
}

function PlanPanel({ scrollRef, text, agentId, phase, label, badgeText, badgeClass, idlePlaceholder, cost }: PlanPanelProps) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Badge className={cn("text-xs px-1.5 py-0", badgeClass)}>
          {badgeText}
        </Badge>
        {cost !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">
            ${cost.toFixed(4)}
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-4">
        {agentId !== undefined ? (
          <StreamingContent
            agentId={agentId}
            phase={phase}
            idlePlaceholder={idlePlaceholder}
            scrollRef={scrollRef}
          />
        ) : text ? (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
            {text}
          </pre>
        ) : (
          <p className="text-xs italic text-muted-foreground/40">
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
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  // --- Skills list ---
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(true);

  // --- Test orchestration hook ---
  const {
    state,
    setState,
    handleRunTest,
    cleanup,
    isRunning,
    elapsed,
    withCost,
    withoutCost,
    evalCost,
  } = useTestOrchestration({ workspacePath });

  // --- Scope recommendation guard ---
  const scopeBlocked = useScopeBlocked(state.selectedSkill, "test");

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

  // Stable ref to latest state for callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---------------------------------------------------------------------------
  // Load skills on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!workspacePath) {
      setSkills([]);
      setIsLoadingSkills(false);
      return;
    }
    let cancelled = false;
    listRefinableSkills(workspacePath)
      .then((list) => {
        if (!cancelled) {
          setSkills(list);
          setIsLoadingSkills(false);
        }
      })
      .catch((err) => {
        console.error("[test] Failed to load skills:", err);
        if (!cancelled) setIsLoadingSkills(false);
        toast.error("Failed to load skills", { duration: Infinity });
      });
    return () => { cancelled = true; };
  }, [workspacePath]);

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
  // Auto-scroll panels
  // ---------------------------------------------------------------------------

  useEffect(() => scrollToBottom(withScrollRef), [state.withText]);
  useEffect(() => scrollToBottom(withoutScrollRef), [state.withoutText]);
  useEffect(() => scrollToBottom(evalScrollRef), [state.evalText]);

  // ---------------------------------------------------------------------------
  // Sync phase to global test store so CloseGuard can detect running agents.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    useTestStore.getState().setRunning(isRunning);
  }, [isRunning]);

  // --- Navigation guard ---
  const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
    shouldBlock: () => useTestStore.getState().isRunning,
    onLeave: (proceed) => {
      useTestStore.getState().setRunning(false);
      useAgentStore.getState().clearRuns();
      cleanup(stateRef.current.testId);
      proceed();
    },
  });

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const elapsedStr = `${(elapsed / 1000).toFixed(1)}s`;
  const activeModel = useSettingsStore((s) => s.preferredModel ?? "sonnet");
  const modelLabel = deriveModelLabel(activeModel);

  const { lines: evalLines, recommendations: evalRecommendations } = parseEvalOutput(state.evalText);

  const handleSelectSkill = useCallback((skill: SkillSummary) => {
    setState((prev) => ({ ...prev, selectedSkill: skill }));
  }, []);

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
              agentId={state.withAgentId}
              phase={state.phase}
              label="Agent Plan"
              badgeText={state.selectedSkill ? `Vibedata + ${state.selectedSkill.name} skill` : "Vibedata + skill"}
              badgeClass="bg-[color-mix(in_oklch,var(--color-seafoam),transparent_85%)] text-[var(--color-seafoam)]"
              idlePlaceholder="Run a test to see the with-skill plan"
              cost={withCost}
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
              agentId={state.withoutAgentId}
              phase={state.phase}
              label="Agent Plan"
              badgeText="Vibedata Only"
              badgeClass="bg-[color-mix(in_oklch,var(--color-ocean),transparent_85%)] text-[var(--color-ocean)]"
              idlePlaceholder="Run a test to see the baseline plan"
              cost={withoutCost}
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
                  {evalLines.map((line, i) => {
                    // Render markdown headers as styled section headings, not plain bullets
                    const h1Match = line.direction === null && /^#{1}\s+(.+)/.exec(line.text);
                    const h2Match = line.direction === null && /^#{2}\s+(.+)/.exec(line.text);
                    const isSeparator = line.direction === null && /^-{3,}$/.test(line.text.trim());
                    if (h1Match) {
                      return (
                        <p key={i} className="pb-1 text-xs font-semibold text-foreground">
                          {h1Match[1]}
                        </p>
                      );
                    }
                    if (h2Match) {
                      return (
                        <p key={i} className="pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {h2Match[1]}
                        </p>
                      );
                    }
                    if (isSeparator) return <hr key={i} className="border-border/40" />;
                    return (
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
                        {renderInlineBold(line.text)}
                      </span>
                    </div>
                    );
                  })}
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
        {(withCost !== undefined || withoutCost !== undefined || evalCost !== undefined) && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground/60">
              {`with ${withCost !== undefined ? `$${withCost.toFixed(4)}` : "—"} · without ${withoutCost !== undefined ? `$${withoutCost.toFixed(4)}` : "—"} · eval ${evalCost !== undefined ? `$${evalCost.toFixed(4)}` : "—"}`}
            </span>
          </>
        )}
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
