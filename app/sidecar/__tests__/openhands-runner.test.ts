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
  it("maps default maxTurns, base URL, agent name, and workspace paths onto AppConfig", () => {
    const result = runPython(
      runnerImportScript(`
captured = {}

class LLMConfig:
    pass

class AppConfig:
    def __init__(self):
        self.llm = LLMConfig()

def fake_main(config, task_str):
    captured["task_str"] = task_str
    captured["default_agent"] = config.default_agent
    captured["model"] = config.llm.model
    captured["api_key"] = config.llm.api_key
    captured["base_url"] = config.llm.base_url
    captured["workspace_base"] = config.workspace_base
    captured["workspace_mount_path"] = config.workspace_mount_path
    captured["max_iterations"] = config.max_iterations
    return None

runner.AppConfig = AppConfig
runner._openhands_main = fake_main

request = {
    "mode": "one-shot",
    "prompt": "build",
    "apiKey": "sk-secret",
    "model": "anthropic/claude-sonnet-4-6",
    "modelBaseUrl": "https://models.example.com/v1",
    "agentName": "skill-writer-agent",
    "workspaceRootDir": "/tmp/workspace",
    "workspaceSkillDir": "/tmp/workspace/plugin/skill",
}

with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    runner.run_via_openhands_main(request)

print(json.dumps(captured, sort_keys=True))
`),
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(captured).toMatchObject({
      task_str: "build",
      default_agent: "skill-writer-agent",
      model: "anthropic/claude-sonnet-4-6",
      api_key: "sk-secret",
      base_url: "https://models.example.com/v1",
      workspace_base: "/tmp/workspace",
      workspace_mount_path: "/tmp/workspace/plugin/skill",
      max_iterations: 50,
    });
  });

  it("uses explicit maxTurns as max_iterations", () => {
    const result = runPython(
      runnerImportScript(`
print(runner.parse_max_iterations({"maxTurns": 12}))
`),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("12");
  });

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
  });

  it("redacts API keys from stderr and emitted error results", () => {
    const result = runPython(
      runnerImportScript(`
class LLMConfig:
    pass

class AppConfig:
    def __init__(self):
        self.llm = LLMConfig()

def fake_main(config, task_str):
    raise RuntimeError("provider rejected sk-secret")

runner.AppConfig = AppConfig
runner._openhands_main = fake_main

request = {
    "mode": "one-shot",
    "prompt": "build",
    "apiKey": "sk-secret",
}

stdout = io.StringIO()
stderr = io.StringIO()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    runner.run(request)

print(json.dumps({"stdout": stdout.getvalue(), "stderr": stderr.getvalue()}, sort_keys=True))
`),
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(result.stdout) as { stdout: string; stderr: string };
    expect(captured.stdout).not.toContain("sk-secret");
    expect(captured.stderr).not.toContain("sk-secret");
    expect(captured.stdout).toContain("[REDACTED]");
    expect(captured.stderr).toContain("[REDACTED]");
  });
});
