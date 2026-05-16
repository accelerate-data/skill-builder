import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "../../");

function readSource(relativePath: string) {
  return readFileSync(resolve(SRC_ROOT, relativePath), "utf8");
}

describe("runtime API contract", () => {
  it("exposes selected-skill session APIs and does not expose removed legacy agent command", () => {
    const source = readSource("lib/tauri.ts");

    expect(source).toContain("export const selectSkillOpenHandsSession");
    expect(source).toContain("export const pauseOpenHandsSession");
    expect(source).not.toContain("export const cancelAgentRun");
    expect(source).not.toContain("export const pauseRefineSession");
    // start_agent Tauri command has been removed — neither the old raw binding
    // nor the removed legacy wrapper should appear.
    expect(source).not.toContain("export const startAgent");
    expect(source).not.toContain("export const startOneShotAgent");
    expect(source).not.toContain("answerWorkflowStepQuestion");
    expect(source).not.toContain("answerStreamingRefineQuestion");
    expect(source).not.toContain("cancelRefineTurn");
  });

  it("keeps evals on the workbench API and feedback on direct submission", () => {
    const feedbackSource = readSource("components/feedback-dialog.tsx");
    // AI enrichment via start_agent has been removed; feedback dialog uses direct submission.
    expect(feedbackSource).not.toContain("startOneShotAgent");
    expect(feedbackSource).not.toContain("runEvalWorkbench");

    const evalsSource = readSource("components/workspace/workspace-evals.tsx");
    expect(evalsSource).toContain('from "@/lib/eval-workbench"');
    expect(evalsSource).not.toContain("startOneShotAgent");
    expect(evalsSource).not.toContain("sendRefineMessage");
    expect(evalsSource).toContain("onDefineEvalScenario");
  });

  it("removes the refine workspace surface", () => {
    const source = readSource("components/workspace/workspace-shell.tsx");

    expect(source).not.toContain('TabsTrigger value="refine"');
    expect(source).not.toContain("WorkspaceRefine");
  });

  it("does not expose workflow AskUserQuestion UI for workflow runs", () => {
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
