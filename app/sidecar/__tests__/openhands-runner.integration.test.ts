import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(__dirname, "..");
const runnerPath = path.join(sidecarDir, "openhands", "runner.py");

type JsonRecord = Record<string, unknown>;

function hasLiveConfig(): boolean {
  return Boolean(
    process.env.SKILL_BUILDER_OPENHANDS_MODEL &&
      process.env.SKILL_BUILDER_OPENHANDS_API_KEY,
  );
}

function createWorkspace(): string {
  const workspaceDir = mkdtempSync(
    path.join(tmpdir(), "skill-builder-openhands-live-"),
  );
  const agentsDir = path.join(workspaceDir, ".agents", "agents");
  const skillsDir = path.join(workspaceDir, ".agents", "skills", "scope-review");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(
    path.join(agentsDir, "skill-creator.md"),
    `---
name: skill-creator
---

You are the Skill Builder skill-creator agent. Follow the user request exactly.
For this integration test, do not call tools unless absolutely necessary.
`,
    "utf8",
  );
  writeFileSync(
    path.join(skillsDir, "SKILL.md"),
    `---
name: scope-review
description: Scope review smoke skill for OpenHands SDK integration tests.
---

Return concise validation results for scope review requests.
`,
    "utf8",
  );
  return workspaceDir;
}

function runRunner(request: JsonRecord): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [runnerPath], {
      cwd: sidecarDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });

    child.stdin.end(JSON.stringify(request));
  });
}

function parseJsonl(stdout: string): JsonRecord[] {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
}

describe("OpenHands runner live SDK integration", () => {
  it.skipIf(!hasLiveConfig())(
    "runs a one-shot request through the OpenHands SDK and emits only conversation protocol records",
    async () => {
      const workspaceDir = createWorkspace();
      const apiKey = process.env.SKILL_BUILDER_OPENHANDS_API_KEY as string;
      const model = process.env.SKILL_BUILDER_OPENHANDS_MODEL as string;
      const baseUrl = process.env.SKILL_BUILDER_OPENHANDS_BASE_URL;
      const apiVersion = process.env.SKILL_BUILDER_OPENHANDS_API_VERSION;

      try {
        const result = await runRunner({
          mode: "one-shot",
          agentName: "skill-creator",
          taskKind: "scope_review",
          prompt:
            "Reply with exactly this text and nothing else: SDK_EVENT_SMOKE_OK",
          llm: {
            model,
            apiKey,
            ...(baseUrl ? { baseUrl } : {}),
            ...(apiVersion ? { apiVersion } : {}),
            timeoutSeconds: 120,
            numRetries: 1,
          },
          workspaceRootDir: workspaceDir,
          workspaceSkillDir: workspaceDir,
          allowedTools: [],
          maxTurns: 3,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain(apiKey);
        expect(result.stderr).not.toContain(apiKey);

        const records = parseJsonl(result.stdout);
        expect(records.length).toBeGreaterThan(0);
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

        expect(records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "conversation_state",
              runtime: "openhands",
              agent_id: "skill-creator",
              status: "starting",
            }),
            expect.objectContaining({
              type: "conversation_state",
              runtime: "openhands",
              agent_id: "skill-creator",
              status: "running",
            }),
          ]),
        );
        expect(
          records.some((record) => record.type === "conversation_event"),
        ).toBe(true);

        const terminalStates = records.filter(
          (record) =>
            record.type === "conversation_state" &&
            ["completed", "error", "cancelled"].includes(
              String(record.status),
            ),
        );
        expect(terminalStates).toHaveLength(1);
        expect(terminalStates[0]).toMatchObject({
          type: "conversation_state",
          runtime: "openhands",
          agent_id: "skill-creator",
          status: "completed",
          error_detail: null,
        });
        expect(String(terminalStates[0].result_text ?? "")).toContain(
          "SDK_EVENT_SMOKE_OK",
        );
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
