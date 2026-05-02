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
        type: "conversation_state",
        runtime: "openhands",
        status: "starting",
        timestamp: Date.now(),
      }) + "\n",
    );
    stdout.write(
      JSON.stringify({
        type: "conversation_event",
        runtime: "openhands",
        event_class: "MessageEvent",
        event: {
          source: "agent",
          llm_message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: `Running ${request.agentName}`,
              },
            ],
          },
        },
        timestamp: Date.now(),
      }) + "\n",
    );
    stdout.write(
      JSON.stringify({
        type: "conversation_state",
        runtime: "openhands",
        status: "completed",
        result_text: JSON.stringify(structuredOutput),
        error_detail: null,
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
    llm: {
      model: "anthropic/claude-sonnet-4-6",
      apiKey: "sk-llm-test",
    },
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

function terminalState(messages: Record<string, unknown>[]) {
  return messages.find(
    (message) =>
      message.type === "conversation_state" &&
      message.status === "completed",
  ) as Record<string, unknown> | undefined;
}

function conversationEvents(messages: Record<string, unknown>[]) {
  return messages.filter((message) => message.type === "conversation_event");
}

const mockSpawn = vi.mocked(childProcess.spawn);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpenHands workflow smoke", () => {
  it("runs workflow research through skill-creator with parseable structured output", async () => {
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
        join(root, ".agents", "agents", "skill-creator.md"),
        "---\nname: skill-creator\nskills: [research, skill-creator]\n---\n",
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
            if (request.taskKind === "workflow.research") {
              return {
                status: "research_complete",
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
          agentName: "skill-creator",
          taskKind: "workflow.research",
          maxTurns: 12,
          allowedTools: ["file_editor", "terminal"],
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

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests.map((request) => request.agentName)).toEqual([
        "skill-creator",
      ]);
      expect(capturedRequests[0].taskKind).toBe("workflow.research");
      expect(capturedRequests[0].allowedTools).toEqual([
        "file_editor",
        "terminal",
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
      expect(JSON.stringify(capturedRequests)).not.toContain("research-agent");

      expect(conversationEvents(step0.messages)).toHaveLength(1);
      expect(terminalState(step0.messages)).toMatchObject({
        status: "completed",
        result_text: expect.stringContaining("dimensions_selected"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
