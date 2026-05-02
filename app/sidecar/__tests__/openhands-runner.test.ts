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

describe("openhands runner.py", () => {
  it("maps llm config, agent context, tools, and workspace onto SDK Conversation", () => {
    const result = runPython(
      runnerImportScript(`
captured = {}

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
    def __init__(self, skills=None, system_message_suffix=None):
        captured["skills"] = skills
        captured["system_message_suffix"] = system_message_suffix

class Agent:
    def __init__(self, llm, tools, agent_context):
        captured["tools"] = [tool.name for tool in tools]

class Conversation:
    def __init__(self, agent, workspace):
        captured["workspace"] = workspace
        self.state = type("State", (), {"events": []})()
    def send_message(self, prompt):
        captured["prompt"] = prompt
    def run(self, max_iterations):
        captured["max_iterations"] = max_iterations
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
runner.load_project_skills = lambda workspace_dir: ["project-skill"]
runner.load_skills_from_dir = lambda skills_dir: ({}, {}, {"research": "research-skill"})
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
    "agentName": "skill-writer-agent",
    "workspaceRootDir": "/tmp/workspace",
    "workspaceSkillDir": "/tmp/workspace/plugin/skill",
    "allowedTools": ["terminal", "file_editor"],
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
      workspace: "/tmp/workspace/plugin/skill",
      tools: ["TerminalTool", "FileEditorTool", "TaskTrackerTool"],
      skills: ["project-skill"],
      max_iterations: 50,
    });
  }, 30_000);

  it("extracts final text from OpenHands conversation state events", () => {
    const result = runPython(
      runnerImportScript(`
conversation = type("Conversation", (), {})()
conversation.state = type("State", (), {})()
conversation.state.events = [
    type("Event", (), {"message": "first"})(),
    type("Event", (), {"message": "{\\"status\\":\\"complete\\"}"})(),
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

  it("redacts API keys from stderr and emitted error results", () => {
    const result = runPython(
      runnerImportScript(`
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
class Conversation:
    pass

runner.LLM = LLM
runner.Tool = Tool
runner.TerminalTool = TerminalTool
runner.FileEditorTool = FileEditorTool
runner.TaskTrackerTool = TaskTrackerTool
runner.AgentContext = AgentContext
runner.Agent = Agent
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
