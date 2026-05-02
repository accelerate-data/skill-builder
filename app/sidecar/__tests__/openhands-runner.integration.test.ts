import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(__dirname, "..");
const runnerPath = path.join(sidecarDir, "openhands", "runner.py");

type JsonRecord = Record<string, unknown>;

type LiveLlmConfig = {
  model: string;
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
};

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function resolveLiveConfigFromEnv(): LiveLlmConfig | null {
  const model = nonEmpty(process.env.SKILL_BUILDER_OPENHANDS_MODEL);
  const apiKey = nonEmpty(process.env.SKILL_BUILDER_OPENHANDS_API_KEY);
  if (!model || !apiKey) {
    return null;
  }

  return {
    model,
    apiKey,
    baseUrl: nonEmpty(process.env.SKILL_BUILDER_OPENHANDS_BASE_URL),
    apiVersion: nonEmpty(process.env.SKILL_BUILDER_OPENHANDS_API_VERSION),
  };
}

function appDbCandidates(): string[] {
  if (process.env.SKILL_BUILDER_APP_DB_PATH) {
    return [process.env.SKILL_BUILDER_APP_DB_PATH];
  }

  if (process.platform === "darwin") {
    return [
      path.join(
        homedir(),
        "Library",
        "Application Support",
        "com.vibedata.skill-builder",
        "db",
        "skill-builder.db",
      ),
      path.join(
        homedir(),
        "Library",
        "Application Support",
        "com.vibedata.skill-builder",
        "skill-builder.db",
      ),
    ];
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return appData
      ? [
          path.join(
            appData,
            "com.vibedata.skill-builder",
            "db",
            "skill-builder.db",
          ),
        ]
      : [];
  }

  const configHome =
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  return [
    path.join(
      configHome,
      "com.vibedata.skill-builder",
      "db",
      "skill-builder.db",
    ),
  ];
}

function resolveLiveConfigFromAppDb(): LiveLlmConfig | null {
  const dbPath = appDbCandidates().find((candidate) => existsSync(candidate));
  if (!dbPath) {
    return null;
  }

  const result = spawnSync(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
SELECT
  json_extract(value, '$.model_settings.model') AS model,
  json_extract(value, '$.model_settings.api_key') AS apiKey,
  json_extract(value, '$.model_settings.base_url') AS baseUrl,
  json_extract(value, '$.model_settings.api_version') AS apiVersion
FROM settings
WHERE key = 'app_settings'
LIMIT 1;
`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }

  const rows = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  const row = rows[0];
  const model = nonEmpty(row?.model);
  const apiKey = nonEmpty(row?.apiKey);
  if (!model || !apiKey) {
    return null;
  }

  return {
    model,
    apiKey,
    baseUrl: nonEmpty(row.baseUrl),
    apiVersion: nonEmpty(row.apiVersion),
  };
}

const liveConfig = resolveLiveConfigFromEnv() ?? resolveLiveConfigFromAppDb();

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
  const researchDir = path.join(workspaceDir, ".agents", "skills", "research");
  mkdirSync(researchDir, { recursive: true });
  writeFileSync(
    path.join(researchDir, "SKILL.md"),
    `---
name: research
description: Workflow research smoke skill for OpenHands SDK integration tests.
---

Return only the requested workflow research JSON object.
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
  it.skipIf(!liveConfig)(
    "runs a one-shot request through the OpenHands SDK and emits only conversation protocol records",
    async () => {
      const config = liveConfig;
      if (!config) {
        throw new Error("Live OpenHands config was not resolved");
      }
      const workspaceDir = createWorkspace();

      try {
        const result = await runRunner({
          mode: "one-shot",
          agentName: "skill-creator",
          taskKind: "scope_review",
          prompt:
            "Reply with exactly this text and nothing else: SDK_EVENT_SMOKE_OK",
          llm: {
            model: config.model,
            apiKey: config.apiKey,
            ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
            ...(config.apiVersion
              ? { apiVersion: config.apiVersion }
              : {}),
            timeoutSeconds: 120,
            numRetries: 1,
          },
          workspaceRootDir: workspaceDir,
          workspaceSkillDir: workspaceDir,
          allowedTools: [],
          maxTurns: 3,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain(config.apiKey);
        expect(result.stderr).not.toContain(config.apiKey);

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

  it.skipIf(!liveConfig)(
    "runs workflow.research through skill-creator and returns parseable research JSON",
    async () => {
      const config = liveConfig;
      if (!config) {
        throw new Error("Live OpenHands config was not resolved");
      }
      const workspaceDir = createWorkspace();

      try {
        const result = await runRunner({
          mode: "one-shot",
          agentName: "skill-creator",
          taskKind: "workflow.research",
          prompt:
            'Return exactly this raw JSON object and nothing else: {"status":"research_complete","dimensions_selected":1,"question_count":0,"research_output":{"version":"1","metadata":{},"sections":[],"notes":[]}}',
          llm: {
            model: config.model,
            apiKey: config.apiKey,
            ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
            ...(config.apiVersion
              ? { apiVersion: config.apiVersion }
              : {}),
            timeoutSeconds: 120,
            numRetries: 1,
          },
          workspaceRootDir: workspaceDir,
          workspaceSkillDir: workspaceDir,
          allowedTools: ["file_editor", "terminal"],
          maxTurns: 5,
          outputFormat: { type: "json_schema", json_schema: { name: "ResearchStepOutput" } },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain(config.apiKey);
        expect(result.stderr).not.toContain(config.apiKey);

        const records = parseJsonl(result.stdout);
        expect(records.some((record) => record.type === "conversation_event")).toBe(true);
        const terminalState = records.find(
          (record) =>
            record.type === "conversation_state" &&
            record.status === "completed",
        );
        expect(terminalState).toMatchObject({
          type: "conversation_state",
          runtime: "openhands",
          agent_id: "skill-creator",
          status: "completed",
        });

        const resultText = String(terminalState?.result_text ?? "").trim();
        const fenced = resultText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        const jsonText = fenced ? fenced[1].trim() : resultText;
        const parsed = JSON.parse(jsonText);
        expect(parsed).toMatchObject({
          status: "research_complete",
          research_output: { version: "1" },
        });
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
