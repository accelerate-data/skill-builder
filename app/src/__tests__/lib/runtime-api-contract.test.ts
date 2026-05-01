import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "../../");

function readSource(relativePath: string) {
  return readFileSync(resolve(SRC_ROOT, relativePath), "utf8");
}

describe("runtime API contract", () => {
  it("exposes explicit one-shot and streaming agent APIs", () => {
    const source = readSource("lib/tauri.ts");

    expect(source).toContain("export const startOneShotAgent");
    expect(source).toContain("export const sendStreamingRefineMessage");
    expect(source).not.toContain("export const startAgent");
    expect(source).not.toContain("export const answerWorkflowStepQuestion");
  });

  it("keeps non-refine UI surfaces on the one-shot agent API", () => {
    const nonRefineSources = [
      "components/feedback-dialog.tsx",
      "components/workspace/workspace-evals.tsx",
    ];

    for (const relativePath of nonRefineSources) {
      const source = readSource(relativePath);

      expect(source, relativePath).toContain("startOneShotAgent");
      expect(source, relativePath).not.toContain("startAgent(");
      expect(source, relativePath).not.toContain("sendStreamingRefineMessage");
    }
  });

  it("keeps refine UI on the streaming refine API", () => {
    const source = readSource("components/workspace/workspace-refine.tsx");

    expect(source).toContain("sendStreamingRefineMessage");
    expect(source).toContain("answerStreamingRefineQuestion");
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
