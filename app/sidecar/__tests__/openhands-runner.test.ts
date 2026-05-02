import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(__dirname, "..");
const runnerPath = path.join(sidecarDir, "openhands", "runner.py");

function runPython(script: string) {
  const result = spawnSync("python3", ["-c", script], {
    cwd: sidecarDir,
    encoding: "utf8",
  });

  return {
    ...result,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runnerImportScript(body: string): string {
  return `
import contextlib
import importlib.util
import io
import json
import pathlib
import sys

runner_path = pathlib.Path(${JSON.stringify(runnerPath)})
spec = importlib.util.spec_from_file_location("openhands_runner_under_test", runner_path)
runner = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(runner)

${body}
`;
}

function parseJsonl(stdout: string): Record<string, unknown>[] {
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function expectOnlyOpenHandsProtocolRecords(records: Record<string, unknown>[]): void {
  expect(
    records.every(
      (record) =>
        record.type === "conversation_state" ||
        record.type === "conversation_event",
    ),
  ).toBe(true);
  expect(JSON.stringify(records)).not.toContain("openhands_event");
  expect(JSON.stringify(records)).not.toContain("openhands_result");
  expect(JSON.stringify(records)).not.toContain("display_item");
  expect(JSON.stringify(records)).not.toContain("run_result");
  expect(JSON.stringify(records)).not.toContain("sdk_stderr");
}

describe("openhands runner.py", () => {
  it("maps llm config, file agent context, workspace skills, tools, and workspace onto SDK Conversation", () => {
    const result = runPython(
      runnerImportScript(`
import tempfile
from pathlib import Path

captured = {}
workspace = tempfile.TemporaryDirectory()
workspace_dir = Path(workspace.name)
agent_dir = workspace_dir / ".agents" / "agents"
agent_dir.mkdir(parents=True)
(workspace_dir / ".agents" / "skills").mkdir(parents=True)
(agent_dir / "skill-creator.md").write_text("""---
name: skill-creator
---

You create Skill Builder skills.
""", encoding="utf-8")

class LLM:
    def __init__(self, **kwargs):
        captured["llm"] = kwargs

class Tool:
    def __init__(self, name):
        self.name = name

class TerminalTool:
    name = "TerminalTool"

class FileEditorTool:
    name = "FileEditorTool"

class TaskTrackerTool:
    name = "TaskTrackerTool"

class AgentContext:
    def __init__(
        self,
        skills=None,
        system_message_suffix=None,
        user_message_suffix=None,
        load_public_skills=True,
    ):
        captured["skills"] = skills
        captured["system_message_suffix"] = system_message_suffix
        captured["user_message_suffix"] = user_message_suffix
        captured["load_public_skills"] = load_public_skills

class Agent:
    def __init__(self, llm, tools, agent_context):
        captured["tools"] = [tool.name for tool in tools]

class LocalWorkspace:
    def __init__(self, working_dir):
        self.working_dir = working_dir
        captured["local_workspace_working_dir"] = working_dir

class Conversation:
    def __init__(self, agent, workspace, callbacks=None, max_iteration_per_run=500, visualizer="default", delete_on_close=True):
        captured["workspace"] = {"working_dir": workspace.working_dir}
        captured["callbacks_count"] = len(callbacks or [])
        captured["max_iteration_per_run"] = max_iteration_per_run
        captured["visualizer"] = visualizer
        captured["delete_on_close"] = delete_on_close
        self.state = type("State", (), {"events": []})()
    def send_message(self, prompt):
        captured["prompt"] = prompt
    def run(self):
        captured["run_called"] = True
        self.state.events.append(type("Event", (), {"message": "ok"})())
        return None

runner.LLM = LLM
runner.Tool = Tool
runner.TerminalTool = TerminalTool
runner.FileEditorTool = FileEditorTool
runner.TaskTrackerTool = TaskTrackerTool
runner.AgentContext = AgentContext
runner.Agent = Agent
runner.Conversation = Conversation
runner.LocalWorkspace = LocalWorkspace
runner.load_project_skills = lambda workspace_dir: ["project-skill"]
def load_skills_from_dir(skills_dir):
    captured["skills_dir"] = skills_dir
    return ({}, {}, {"research": "research-skill"})
runner.load_skills_from_dir = load_skills_from_dir
runner._OPENHANDS_IMPORT_ERROR = None

request = {
    "mode": "one-shot",
    "prompt": "build",
    "llm": {
        "model": "anthropic/claude-sonnet-4-6",
        "apiKey": "sk-secret",
        "baseUrl": "https://models.example.com/v1",
        "apiVersion": "2024-10-01",
        "temperature": 0.2,
        "maxOutputTokens": 4096,
        "timeoutSeconds": 300,
        "numRetries": 5,
        "reasoningEffort": "high",
        "extraHeaders": {
            "x-provider-routing": "secure-route"
        },
        "inputCostPerToken": 0.000003,
        "outputCostPerToken": 0.000015,
        "usageId": "workflow"
    },
    "agentName": "skill-creator",
    "taskKind": "scope_review",
    "userMessageSuffix": "Follow the current user message exactly.",
    "workspaceRootDir": str(workspace_dir),
    "workspaceSkillDir": str(workspace_dir),
    "allowedTools": ["terminal", "file_editor"],
    "maxTurns": 8,
}

with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    runner.run_via_openhands_sdk(request)

print(json.dumps(captured, sort_keys=True))
`),
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(captured).toMatchObject({
      prompt: "build",
      llm: {
        model: "anthropic/claude-sonnet-4-6",
        api_key: "sk-secret",
        base_url: "https://models.example.com/v1",
        api_version: "2024-10-01",
        temperature: 0.2,
        max_output_tokens: 4096,
        timeout: 300,
        num_retries: 5,
        reasoning_effort: "high",
        extra_headers: {
          "x-provider-routing": "secure-route",
        },
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        usage_id: "workflow",
      },
      tools: ["TerminalTool", "FileEditorTool", "TaskTrackerTool"],
      skills: ["research-skill"],
      system_message_suffix: "You create Skill Builder skills.",
      user_message_suffix: "Follow the current user message exactly.",
      load_public_skills: false,
      max_iteration_per_run: 8,
      run_called: true,
      callbacks_count: 1,
      visualizer: null,
      delete_on_close: false,
    });
    expect(captured.local_workspace_working_dir).toBe(
      (captured.skills_dir as string).replace("/.agents/skills", ""),
    );
    expect((captured.workspace as { working_dir: string }).working_dir).toBe(
      (captured.skills_dir as string).replace("/.agents/skills", ""),
    );
    expect(captured.skills_dir).toMatch(/\/\.agents\/skills$/);
  }, 30_000);

  it("emits redacted JSONL for SDK callback events using the conversation_event protocol", () => {
    const result = runPython(
      runnerImportScript(`
class ActionEvent:
    def model_dump(self, mode="python"):
        return {
            "source": "agent",
            "llm_response_id": "resp_01JY",
            "tool_call_id": "toolu_01JZ",
            "reasoning_content": "Need to inspect sk-secret before calling secure-route",
            "thinking_blocks": [
                {
                    "type": "thinking",
                    "thinking": "Use vault-token only inside the provider boundary",
                    "signature": "sig_01"
                }
            ],
            "tool_call": {
                "id": "toolu_01JZ",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": {
                        "path": "app/sidecar/__tests__/openhands-runner.test.ts",
                        "headers": {"authorization": "Bearer sk-secret"},
                        "routes": ["secure-route"]
                    }
                }
            },
            "llm_message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "I will inspect the sidecar boundary."},
                    {
                        "type": "tool_use",
                        "id": "toolu_01JZ",
                        "name": "read_file",
                        "input": {
                            "path": "app/sidecar/__tests__/openhands-runner.test.ts",
                            "token": "vault-token"
                        }
                    }
                ]
            },
            "metadata": {
                "attempts": [{"provider": "secure-route", "api_key": "sk-secret"}],
                "tuple_value": ("vault-token", "keep-me")
            }
        }

stdout = io.StringIO()
with contextlib.redirect_stdout(stdout):
    runner.emit_conversation_event(
        ActionEvent(),
        ["sk-secret", "secure-route", "vault-token"],
    )

print(stdout.getvalue())
`),
    );

    expect(result.status).toBe(0);
    const records = parseJsonl(result.stdout);
    expectOnlyOpenHandsProtocolRecords(records);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "conversation_event",
      event_class: "ActionEvent",
      event: {
        source: "agent",
        llm_response_id: "resp_01JY",
        tool_call_id: "toolu_01JZ",
        reasoning_content: "Need to inspect [REDACTED] before calling [REDACTED]",
        thinking_blocks: [
          {
            type: "thinking",
            thinking: "Use [REDACTED] only inside the provider boundary",
            signature: "sig_01",
          },
        ],
        tool_call: {
          id: "toolu_01JZ",
          type: "function",
          function: {
            name: "read_file",
            arguments: {
              path: "app/sidecar/__tests__/openhands-runner.test.ts",
              headers: { authorization: "Bearer [REDACTED]" },
              routes: ["[REDACTED]"],
            },
          },
        },
        llm_message: {
          role: "assistant",
          content: [
            { type: "text", text: "I will inspect the sidecar boundary." },
            {
              type: "tool_use",
              id: "toolu_01JZ",
              name: "read_file",
              input: {
                path: "app/sidecar/__tests__/openhands-runner.test.ts",
                token: "[REDACTED]",
              },
            },
          ],
        },
        metadata: {
          attempts: [{ provider: "[REDACTED]", api_key: "[REDACTED]" }],
          tuple_value: ["[REDACTED]", "keep-me"],
        },
      },
    });
    expect(typeof records[0].timestamp).toBe("number");
    expect(records[0]).not.toHaveProperty("event_kind");
    expect(JSON.stringify(records[0])).not.toContain("sk-secret");
    expect(JSON.stringify(records[0])).not.toContain("secure-route");
    expect(JSON.stringify(records[0])).not.toContain("vault-token");
  }, 30_000);

  it("rejects non skill-creator agents", () => {
    const result = runPython(
      runnerImportScript(`
try:
    runner.parse_request(json.dumps({
        "mode": "one-shot",
        "prompt": "build",
        "llm": {"model": "anthropic/claude-sonnet-4-6"},
        "agentName": "other-agent"
    }))
except ValueError as exc:
    print(str(exc))
`),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      "Unsupported agentName: 'other-agent' (only 'skill-creator' is supported)",
    );
  }, 30_000);

  it("fails fast when the skill-creator agent file is missing", () => {
    const result = runPython(
      runnerImportScript(`
import tempfile

try:
    runner._read_skill_creator_agent_file(tempfile.mkdtemp())
except FileNotFoundError as exc:
    print(str(exc))
`),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toContain("Missing OpenHands agent file:");
    expect(result.stdout.trim()).toContain(".agents/agents/skill-creator.md");
  }, 30_000);

  it("omits auto reasoning effort from SDK LLM kwargs", () => {
    const result = runPython(
      runnerImportScript(`
print(json.dumps(runner._build_llm_kwargs({
    "llm": {
        "model": "anthropic/claude-sonnet-4-6",
        "apiKey": "sk-secret",
        "reasoningEffort": "auto"
    }
}), sort_keys=True))
`),
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      api_key: "sk-secret",
      model: "anthropic/claude-sonnet-4-6",
    });
  }, 30_000);

  it("maps OpenCode Go catalog model ids to OpenAI-compatible LiteLLM ids", () => {
    const result = runPython(
      runnerImportScript(`
print(json.dumps(runner._build_llm_kwargs({
    "llm": {
        "model": "opencode-go/minimax-m2.7",
        "apiKey": "sk-secret",
        "baseUrl": "https://opencode.ai/zen/go/v1"
    }
}), sort_keys=True))
`),
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      api_key: "sk-secret",
      base_url: "https://opencode.ai/zen/go/v1",
      model: "openai/minimax-m2.7",
    });
  }, 30_000);

  it("keeps SDK stdout noise off the JSONL protocol stream and emits native state/event records", () => {
    const result = runPython(
      runnerImportScript(`
import tempfile
from pathlib import Path

workspace_dir = Path(tempfile.mkdtemp())
agent_dir = workspace_dir / ".agents" / "agents"
agent_dir.mkdir(parents=True)
(workspace_dir / ".agents" / "skills").mkdir(parents=True)
(agent_dir / "skill-creator.md").write_text("# Skill Creator", encoding="utf-8")

class LLM:
    def __init__(self, **kwargs):
        print("llm stdout noise sk-secret")

class Tool:
    def __init__(self, name):
        self.name = name

class TerminalTool:
    name = "TerminalTool"
class FileEditorTool:
    name = "FileEditorTool"
class TaskTrackerTool:
    name = "TaskTrackerTool"
class AgentContext:
    def __init__(self, **kwargs):
        print("context stdout noise")
class Agent:
    def __init__(self, **kwargs):
        print("agent stdout noise")
class LocalWorkspace:
    def __init__(self, working_dir):
        self.working_dir = working_dir
class Conversation:
    def __init__(self, **kwargs):
        self.state = type("State", (), {"events": []})()
        self.callbacks = kwargs.get("callbacks") or []
        print("conversation stdout noise")
    def send_message(self, prompt):
        print("send stdout noise")
    def run(self):
        print("run stdout noise")
        class Event:
            def model_dump(self, mode="python"):
                return {"message": "using sk-secret", "nested": {"route": "secure-route"}}
        event = Event()
        for callback in self.callbacks:
            callback(event)
        self.state.events.append(type("FinalEvent", (), {"message": "{\\"status\\":\\"ok\\"}"})())

runner.LLM = LLM
runner.Tool = Tool
runner.TerminalTool = TerminalTool
runner.FileEditorTool = FileEditorTool
runner.TaskTrackerTool = TaskTrackerTool
runner.AgentContext = AgentContext
runner.Agent = Agent
runner.LocalWorkspace = LocalWorkspace
runner.Conversation = Conversation
runner.load_skills_from_dir = lambda skills_dir: ({}, {}, {})
runner._OPENHANDS_IMPORT_ERROR = None

request = {
    "mode": "one-shot",
    "prompt": "build",
    "llm": {
        "model": "openai/test",
        "apiKey": "sk-secret",
        "extraHeaders": {"x-provider-routing": "secure-route"},
    },
    "workspaceSkillDir": str(workspace_dir),
}
stdout = io.StringIO()
stderr = io.StringIO()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    runner.run(request)
print(json.dumps({"stdout": stdout.getvalue(), "stderr": stderr.getvalue()}, sort_keys=True))
`),
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(result.stdout) as {
      stdout: string;
      stderr: string;
    };
    expect(captured.stdout).not.toContain("stdout noise");
    expect(captured.stdout).not.toContain("sk-secret");
    expect(captured.stdout).not.toContain("secure-route");
    expect(captured.stderr).toContain("stdout noise");
    expect(captured.stderr).not.toContain("sk-secret");
    expect(captured.stderr).toContain("[REDACTED]");

    const records = parseJsonl(captured.stdout);
    expectOnlyOpenHandsProtocolRecords(records);
    expect(records.map((record) => record.type)).toEqual([
      "conversation_state",
      "conversation_state",
      "conversation_event",
      "conversation_state",
    ]);
    expect(records.map((record) => record.status).filter(Boolean)).toEqual([
      "starting",
      "running",
      "completed",
    ]);
    expect(
      records.filter(
        (record) =>
          record.type === "conversation_state" &&
          ["completed", "error", "cancelled"].includes(record.status as string),
      ),
    ).toHaveLength(1);
    expect(records[2]).toMatchObject({
      type: "conversation_event",
      event_class: "Event",
      event: {
        message: "using [REDACTED]",
        nested: { route: "[REDACTED]" },
      },
    });
    expect(records[3]).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      agent_id: "skill-creator",
      status: "completed",
      error_detail: null,
      result_text: '{"status":"ok"}',
      structured_output: null,
    });
  }, 30_000);

  it("extracts final text from OpenHands conversation state events", () => {
    const result = runPython(
      runnerImportScript(`
from openhands.sdk.event import MessageEvent
from openhands.sdk.llm import Message, TextContent

conversation = type("Conversation", (), {})()
conversation.state = type("State", (), {})()
conversation.state.events = [
    MessageEvent(
        source="user",
        llm_message=Message(role="user", content=[TextContent(text="first")]),
    ),
    MessageEvent(
        source="agent",
        llm_message=Message(role="assistant", content=[TextContent(text="{\\"status\\":\\"complete\\"}")]),
    ),
]
print(runner._extract_final_text(conversation))
`),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"status":"complete"}');
  }, 30_000);

  it("uses explicit maxTurns as max_iterations", () => {
    const result = runPython(
      runnerImportScript(`
print(runner.parse_max_iterations({"maxTurns": 12}))
`),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("12");
  }, 30_000);

  it("rejects invalid maxTurns values", () => {
    const result = runPython(
      runnerImportScript(`
try:
    runner.parse_max_iterations({"maxTurns": 0})
except ValueError as exc:
    print(str(exc))
`),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("maxTurns must be a positive integer");
  }, 30_000);

  it("redacts API keys from stderr and emitted error states exactly once", () => {
    const result = runPython(
      runnerImportScript(`
import tempfile
from pathlib import Path

workspace_dir = Path(tempfile.mkdtemp())
agent_dir = workspace_dir / ".agents" / "agents"
agent_dir.mkdir(parents=True)
(workspace_dir / ".agents" / "skills").mkdir(parents=True)
(agent_dir / "skill-creator.md").write_text("# Skill Creator", encoding="utf-8")

class LLM:
    def __init__(self, **kwargs):
        pass

class Tool:
    def __init__(self, name):
        self.name = name

class TerminalTool:
    name = "TerminalTool"
class FileEditorTool:
    name = "FileEditorTool"
class TaskTrackerTool:
    name = "TaskTrackerTool"
class AgentContext:
    def __init__(self, **kwargs):
        pass
class Agent:
    def __init__(self, **kwargs):
        raise RuntimeError("provider rejected sk-secret")
class LocalWorkspace:
    def __init__(self, working_dir):
        self.working_dir = working_dir
class Conversation:
    pass

runner.LLM = LLM
runner.Tool = Tool
runner.TerminalTool = TerminalTool
runner.FileEditorTool = FileEditorTool
runner.TaskTrackerTool = TaskTrackerTool
runner.AgentContext = AgentContext
runner.Agent = Agent
runner.LocalWorkspace = LocalWorkspace
runner.Conversation = Conversation
runner.load_project_skills = lambda workspace_dir: []
runner.load_skills_from_dir = lambda skills_dir: ({}, {}, {})
runner._OPENHANDS_IMPORT_ERROR = None

request = {
    "mode": "one-shot",
    "prompt": "build",
    "llm": {
        "model": "anthropic/claude-sonnet-4-6",
        "apiKey": "sk-secret",
    },
    "workspaceSkillDir": str(workspace_dir),
}

stdout = io.StringIO()
stderr = io.StringIO()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    runner.run(request)

print(json.dumps({"stdout": stdout.getvalue(), "stderr": stderr.getvalue()}, sort_keys=True))
`),
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(result.stdout) as {
      stdout: string;
      stderr: string;
    };
    expect(captured.stdout).not.toContain("sk-secret");
    expect(captured.stderr).not.toContain("sk-secret");
    expect(captured.stdout).toContain("[REDACTED]");
    expect(captured.stderr).toContain("[REDACTED]");
    const records = parseJsonl(captured.stdout);
    expect(records.map((record) => record.status).filter(Boolean)).toEqual([
      "starting",
      "running",
      "error",
    ]);
    expect(records.filter((record) => record.status === "error")).toHaveLength(1);
    expect(records.at(-1)).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      agent_id: "skill-creator",
      status: "error",
      error_detail: "provider rejected [REDACTED]",
    });
  }, 30_000);

  it("rejects requests without llm config", () => {
    const result = runPython(
      runnerImportScript(`
try:
    runner.parse_request(json.dumps({"mode": "one-shot", "prompt": "build"}))
except ValueError as exc:
    print(str(exc))
`),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("OpenHands runner request missing llm config");
  }, 30_000);
});
