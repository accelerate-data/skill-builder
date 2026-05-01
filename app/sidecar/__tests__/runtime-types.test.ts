import { describe, expect, it } from "vitest";
import {
  assertOneShotHasNoUserQuestions,
  isUserQuestionToolName,
  type OneShotRunRequest,
  type StreamingSessionRequest,
} from "../runtime/types.js";
import { toClaudeSidecarConfig, toOneShotRunRequest } from "../runtime/claude-runtime.js";

const baseContext = {
  skillName: "demo-skill",
  pluginSlug: "demo-plugin",
  stepId: 0,
  runSource: "workflow" as const,
};

describe("runtime request types", () => {
  it("recognizes Claude and runtime-neutral user question tool names", () => {
    expect(isUserQuestionToolName("AskUserQuestion")).toBe(true);
    expect(isUserQuestionToolName("ask_user_question")).toBe(true);
    expect(isUserQuestionToolName("Read")).toBe(false);
  });

  it("allows one-shot requests without user-question tools", () => {
    const request: OneShotRunRequest = {
      mode: "one-shot",
      allowUserQuestions: false,
      prompt: "Generate the skill.",
      apiKey: "sk-test",
      modelBaseUrl: "https://models.example.com/v1",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      allowedTools: ["Read", "Write", "Edit"],
      context: baseContext,
    };

    expect(() => assertOneShotHasNoUserQuestions(request)).not.toThrow();
    expect(request.modelBaseUrl).toBe("https://models.example.com/v1");
  });

  it("rejects one-shot requests that include AskUserQuestion", () => {
    const request: OneShotRunRequest = {
      mode: "one-shot",
      allowUserQuestions: false,
      prompt: "Ask before continuing.",
      apiKey: "sk-test",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      allowedTools: ["Read", "AskUserQuestion"],
      context: baseContext,
    };

    expect(() => assertOneShotHasNoUserQuestions(request)).toThrow(
      "one-shot runtime requests cannot include user-question tools: AskUserQuestion",
    );
  });

  it("keeps user questions valid for streaming requests", () => {
    const request: StreamingSessionRequest = {
      mode: "streaming",
      allowUserQuestions: true,
      prompt: "Refine this skill.",
      apiKey: "sk-test",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      allowedTools: ["Read", "AskUserQuestion"],
      context: baseContext,
    };

    expect(request.allowUserQuestions).toBe(true);
    expect(request.mode).toBe("streaming");
  });

  it("carries modelBaseUrl from sidecar config into one-shot runtime requests", () => {
    const request = toOneShotRunRequest({
      prompt: "Generate the skill.",
      apiKey: "sk-test",
      model: "anthropic/claude-sonnet-4-6",
      modelBaseUrl: "https://models.example.com/v1",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      pluginSlug: "demo-plugin",
    });

    expect(request.modelBaseUrl).toBe("https://models.example.com/v1");
  });

  it("carries modelBaseUrl from runtime requests back into sidecar config", () => {
    const config = toClaudeSidecarConfig({
      mode: "one-shot",
      allowUserQuestions: false,
      prompt: "Generate the skill.",
      apiKey: "sk-test",
      modelBaseUrl: "https://models.example.com/v1",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      context: baseContext,
    });

    expect(config.modelBaseUrl).toBe("https://models.example.com/v1");
  });
});
