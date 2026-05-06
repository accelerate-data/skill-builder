import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "../../");

function readSource(relativePath: string) {
  return readFileSync(resolve(SRC_ROOT, relativePath), "utf8");
}

describe("runtime API contract", () => {
  it("exposes streaming refine API and does not expose removed one-shot agent command", () => {
    const source = readSource("lib/tauri.ts");

    expect(source).toContain("export const sendRefineMessage");
    // start_agent Tauri command has been removed — neither the old raw binding
    // nor the removed one-shot wrapper should appear.
    expect(source).not.toContain("export const startAgent");
    expect(source).not.toContain("export const startOneShotAgent");
    expect(source).not.toContain("answerWorkflowStepQuestion");
    expect(source).not.toContain("answerStreamingRefineQuestion");
  });

  it("keeps evals on the workbench API and feedback on direct submission", () => {
    const feedbackSource = readSource("components/feedback-dialog.tsx");
    const runHistorySource = readSource(
      "components/workspace/eval-workbench/use-run-history.ts",
    );
    // AI enrichment via start_agent has been removed; feedback dialog uses direct submission.
    expect(feedbackSource).not.toContain("startOneShotAgent");
    expect(feedbackSource).not.toContain("runEvalWorkbench");

    const evalsSource = readSource("components/workspace/workspace-evals.tsx");
    const descriptionSource = readSource("components/workspace/workspace-description.tsx");
    expect(evalsSource).toContain("runEvalWorkbench");
    expect(evalsSource).toContain("useRunHistory");
    expect(evalsSource).toContain('from "@/lib/eval-workbench"');
    expect(evalsSource).not.toContain("startOneShotAgent");
    expect(evalsSource).not.toContain("sendRefineMessage");
    expect(descriptionSource).toContain('from "@/lib/eval-workbench"');
    expect(descriptionSource).not.toContain('from "@/lib/tauri"');
    expect(runHistorySource).toContain("cancelEvalWorkbenchRun");
    expect(runHistorySource).toContain("listEvalRuns");
    expect(runHistorySource).toContain("readEvalRun");
  });

  it("keeps refine UI on the streaming refine API", () => {
    const source = readSource("components/workspace/workspace-refine.tsx");

    expect(source).toContain("sendRefineMessage");
    expect(source).not.toContain("answerStreamingRefineQuestion");
    expect(source).not.toContain("startOneShotAgent");
  });

  it("does not expose workflow AskUserQuestion UI for one-shot runs", () => {
    const source = readSource("components/agent-output-panel.tsx");

    expect(source).not.toContain("answerWorkflowStepQuestion");
    expect(source).not.toContain("RefineQuestionInline");
  });

  it("keeps the workflow page subscribed to active run data instead of the full runs map", () => {
    const source = readSource("pages/workflow.tsx");

    expect(source).not.toContain("const runs = useAgentStore((s) => s.runs)");
    expect(source).toContain("activeRunDisplayItemCount");
  });
});
