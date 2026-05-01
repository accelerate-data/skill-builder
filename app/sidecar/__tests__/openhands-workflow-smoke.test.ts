import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter, PassThrough } from "node:stream";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import * as childProcess from "node:child_process";
import { OpenHandsRuntime } from "../runtime/openhands-runtime.js";
import type { OneShotRunRequest, RuntimeSink } from "../runtime/types.js";

function makeSink() {
  const messages: Record<string, unknown>[] = [];
  const sink: RuntimeSink = {
    emit(message) {
      messages.push(message);
    },
    emitDisplayItem(item) {
      messages.push({ type: "display_item", item });
    },
    emitAgentEvent(event, timestamp = Date.now()) {
      messages.push({ type: "agent_event", event, timestamp });
    },
    emitRefineQuestion(question) {
      messages.push({
        type: "refine_question",
        tool_use_id: question.tool_use_id,
        questions: question.questions,
        timestamp: question.timestamp,
      });
    },
    emitRaw(message) {
      messages.push(message);
    },
  };
  return { messages, sink };
}

function makeMockChild(
  captureRequest: (request: Record<string, unknown>) => Record<string, unknown>,
) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout;
    stderr: typeof stderr;
    stdin: typeof stdin;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;
  child.kill = vi.fn();

  let rawRequest = "";
  stdin.on("data", (chunk) => {
    rawRequest += chunk.toString();
  });
  stdin.on("end", () => {
    const request = JSON.parse(rawRequest) as Record<string, unknown>;
    const structuredOutput = captureRequest(request);
    stdout.write(
      JSON.stringify({
        type: "openhands_event",
        event_kind: "message",
        content: `Running ${request.agentName}`,
        timestamp: Date.now(),
      }) + "\n",
    );
    stdout.write(
      JSON.stringify({
        type: "openhands_result",
        status: "success",
        result_text: JSON.stringify(structuredOutput),
        structured_output: null,
        timestamp: Date.now(),
      }) + "\n",
    );
    stdout.end();
    stderr.end();
    child.emit("close", 0);
  });

  return child;
}

function baseRequest(
  workspaceRootDir: string,
  workspaceSkillDir: string,
  overrides: Partial<OneShotRunRequest>,
): OneShotRunRequest {
  return {
    mode: "one-shot",
    allowUserQuestions: false,
    prompt: "Run workflow step",
    apiKey: "sk-test",
    model: "anthropic/claude-sonnet-4-6",
    workspaceRootDir,
    workspaceSkillDir,
    context: {
      skillName: "test-skill",
      pluginSlug: "skills",
      workspaceSkillDir,
      runSource: "workflow",
    },
    outputFormat: { type: "json_schema", json_schema: { name: "result" } },
    ...overrides,
  };
}

function runResult(messages: Record<string, unknown>[]) {
  return messages.find(
    (message) =>
      message.type === "agent_event" &&
      (message.event as Record<string, unknown>)?.type === "run_result",
  )?.event as Record<string, unknown> | undefined;
}

const mockSpawn = vi.mocked(childProcess.spawn);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpenHands workflow smoke", () => {
  it("runs step 0 and step 3 through named OpenHands agents with parseable structured output", async () => {
    const root = mkdtempSync(join(tmpdir(), "skill-builder-openhands-smoke-"));
    const skillDir = join(root, "skills", "test-skill");
    try {
      mkdirSync(join(root, ".agents", "agents"), { recursive: true });
      mkdirSync(join(root, ".agents", "skills", "research"), {
        recursive: true,
      });
      mkdirSync(join(root, ".agents", "skills", "skill-creator"), {
        recursive: true,
      });
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(root, ".agents", "agents", "research-agent.md"),
        "---\nname: research-agent\nskills: [research]\n---\n",
      );
      writeFileSync(
        join(root, ".agents", "agents", "skill-writer-agent.md"),
        "---\nname: skill-writer-agent\nskills: [skill-creator]\n---\n",
      );
      writeFileSync(
        join(root, ".agents", "skills", "research", "SKILL.md"),
        "---\nname: research\n---\n",
      );
      writeFileSync(
        join(root, ".agents", "skills", "skill-creator", "SKILL.md"),
        "---\nname: skill-creator\n---\n",
      );

      const capturedRequests: Record<string, unknown>[] = [];
      mockSpawn.mockImplementation(
        () =>
          makeMockChild((request) => {
            capturedRequests.push(request);
            if (request.agentName === "research-agent") {
              return {
                status: "ok",
                dimensions_selected: 3,
                question_count: 2,
                research_output: { version: "1", sections: [], notes: [] },
              };
            }
            return {
              skill_md: "# Test Skill\n\nUse when testing.",
              files_written: ["SKILL.md"],
            };
          }) as unknown as ReturnType<typeof childProcess.spawn>,
      );

      const runtime = new OpenHandsRuntime();
      const step0 = makeSink();
      await runtime.runOnce(
        baseRequest(root, skillDir, {
          agentName: "research-agent",
          maxTurns: 12,
          allowedTools: ["Read", "Write"],
          context: {
            skillName: "test-skill",
            stepId: 0,
            pluginSlug: "skills",
            workspaceSkillDir: skillDir,
            runSource: "workflow",
          },
        }),
        step0.sink,
      );

      const step3 = makeSink();
      await runtime.runOnce(
        baseRequest(root, skillDir, {
          agentName: "skill-writer-agent",
          maxTurns: 20,
          allowedTools: ["Read", "Write", "Edit"],
          context: {
            skillName: "test-skill",
            stepId: 3,
            pluginSlug: "skills",
            workspaceSkillDir: skillDir,
            runSource: "workflow",
          },
        }),
        step3.sink,
      );

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests.map((request) => request.agentName)).toEqual([
        "research-agent",
        "skill-writer-agent",
      ]);
      expect(
        capturedRequests.every((request) => request.workspaceRootDir === root),
      ).toBe(true);
      expect(
        capturedRequests.every(
          (request) => request.workspaceSkillDir === skillDir,
        ),
      ).toBe(true);
      expect(JSON.stringify(capturedRequests)).not.toContain("AskUserQuestion");

      expect(runResult(step0.messages)).toMatchObject({
        status: "completed",
        resultText: expect.stringContaining("dimensions_selected"),
      });
      expect(runResult(step3.messages)).toMatchObject({
        status: "completed",
        resultText: expect.stringContaining("skill_md"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
