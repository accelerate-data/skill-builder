import { ScrollArea } from "@/components/ui/scroll-area";
import { BenchmarkSummaryCard, type BenchmarkData } from "@/components/benchmark-summary-card";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps } from "./step-complete-types";

type Props = StepCompleteBaseProps & {
  benchmarkData: BenchmarkData | null;
  benchmarkStatus: "skipped" | "partial" | "missing" | false;
};

export function BenchmarkStepComplete(props: Props) {
  const {
    agentRuns, reviewMode, duration, displayCost,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onRefine, onResetStep,
    benchmarkData, benchmarkStatus,
  } = props;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {reviewMode && agentRuns.length > 0 && (
        <div className="shrink-0"><AgentStatsBar runs={agentRuns} /></div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="pr-4">
          <BenchmarkSummaryCard benchmarkData={benchmarkData} status={benchmarkStatus} duration={!reviewMode ? duration : undefined} cost={displayCost} onResetStep={onResetStep} />
        </div>
      </ScrollArea>
      <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onRefine={onRefine} onClose={onClose} onNextStep={onNextStep} />
    </div>
  );
}
