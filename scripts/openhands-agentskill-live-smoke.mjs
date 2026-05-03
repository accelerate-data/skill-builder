#!/usr/bin/env node
// Live smoke for AgentSkill loading via agent_context.skills.
//
// Drops a SKILL.md under <workspace>/.agents/skills/greet-helper/, sends a
// prompt that should route through the skill, and asserts the agent emits an
// invoke_skill ActionEvent before terminal. Mirrors the shape Skill Builder
// sends from `app/src-tauri/src/agents/openhands_server/types.rs::from_one_shot`
// (in particular `agent_context.skills` with `is_agentskills_format=true`).
//
// Gate: set OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 to run.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";

const enabled = process.env.OPENHANDS_AGENT_SERVER_LIVE_SMOKE === "1";
if (!enabled) {
  console.log(
    "SKIP: set OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 to run the AgentSkill live smoke.",
  );
  process.exit(0);
}

const SKILL_NAME = "greet-helper";
const SKILL_DESCRIPTION =
  "Use when the user asks for a personalized greeting. Always returns the literal greeting in the form 'GREETING_OK <name>'.";
const SKILL_BODY = `---
name: ${SKILL_NAME}
description: ${SKILL_DESCRIPTION}
---

# Greet Helper

When invoked with a user name, respond with exactly:

GREETING_OK <name>

Replace <name> with the user-provided name. Do not add any other text.
`;

const dbSettings = readDbModelSettings();
const model = process.env.OPENHANDS_LIVE_SMOKE_MODEL ?? dbSettings.model;
const apiKey =
  process.env.OPENHANDS_LIVE_SMOKE_API_KEY ??
  process.env.ANTHROPIC_API_KEY ??
  process.env.OPENAI_API_KEY ??
  process.env.GEMINI_API_KEY ??
  dbSettings.apiKey;
const baseUrl = process.env.OPENHANDS_LIVE_SMOKE_BASE_URL ?? dbSettings.baseUrl;
const apiVersion =
  process.env.OPENHANDS_LIVE_SMOKE_API_VERSION ?? dbSettings.apiVersion;
const extraHeaders = dbSettings.extraHeaders;

if (!model || !apiKey) {
  console.error(
    "Missing live smoke model/API key. Set OPENHANDS_LIVE_SMOKE_MODEL and OPENHANDS_LIVE_SMOKE_API_KEY, or configure Settings in the app DB.",
  );
  process.exit(1);
}

const port = await reservePort();
const sessionApiKey = crypto.randomUUID();
const workspace = await mkdtemp(path.join(tmpdir(), "openhands-agentskill-smoke-"));
const skillDir = path.join(workspace, ".agents", "skills", SKILL_NAME);
await mkdir(skillDir, { recursive: true });
await writeFile(path.join(skillDir, "SKILL.md"), SKILL_BODY);

const server = spawn(
  "uvx",
  [
    "--from",
    "openhands-agent-server==1.19.1",
    "--with",
    "openhands-tools==1.19.1",
    "--with",
    "libtmux",
    "python",
    "-m",
    "openhands.agent_server",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: workspace,
    env: {
      ...process.env,
      OPENHANDS_SUPPRESS_BANNER: "1",
      SESSION_API_KEY: sessionApiKey,
      OH_SESSION_API_KEYS_0: sessionApiKey,
      OH_SECRET_KEY: sessionApiKey,
      TMPDIR: "/tmp",
      TMP: "/tmp",
      TEMP: "/tmp",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const stderr = [];
server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

try {
  await waitForHealth(port);
  const conversation = await createConversation({
    port,
    sessionApiKey,
    workspace,
    skillDir,
    model,
    apiKey,
    baseUrl,
    apiVersion,
    extraHeaders,
  });
  const conversationId =
    conversation.id ?? conversation.conversation_id ?? conversation.conversationId;
  if (!conversationId) {
    throw new Error(
      `Create conversation response did not include an id: ${JSON.stringify(conversation)}`,
    );
  }

  const observed = {
    terminal: false,
    terminalStatus: undefined,
    terminalEvent: undefined,
    invokeSkillSeen: false,
    systemPromptHasSkill: false,
    toolNamesSeen: new Set(),
  };

  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/sockets/events/${conversationId}`,
  );
  const socketDone = waitForSocketTerminal(socket, observed);
  await waitForSocketOpen(socket);
  socket.send(JSON.stringify({ type: "auth", session_api_key: sessionApiKey }));

  // Backfill events 0..N from REST so we don't miss the SystemPromptEvent
  // emitted at conversation creation time. This mirrors what types.rs +
  // mod.rs do via list_all_events().
  await backfillExistingEvents(port, sessionApiKey, conversationId, observed);
  await runConversation(port, sessionApiKey, conversationId);
  await socketDone;

  if (!observed.terminal) {
    throw new Error("AgentSkill smoke did not observe terminal state.");
  }

  if (!observed.systemPromptHasSkill) {
    console.error("Tool names seen:", [...observed.toolNamesSeen].sort());
    throw new Error(
      `AgentSkill smoke FAILED: SystemPromptEvent did not list "${SKILL_NAME}" in <available_skills>. ` +
        `This means agent_context.skills was either empty or not parsed.`,
    );
  }

  if (!observed.invokeSkillSeen) {
    console.error("Tool names seen:", [...observed.toolNamesSeen].sort());
    throw new Error(
      `AgentSkill smoke FAILED: agent never called the invoke_skill tool. ` +
        `InvokeSkillTool may not have auto-attached, or the model didn't route ` +
        `to the skill. terminal=${JSON.stringify(observed.terminalEvent)}`,
    );
  }

  if (["error", "failed", "cancelled", "canceled"].includes(observed.terminalStatus)) {
    throw new Error(
      `AgentSkill smoke ended with ${observed.terminalStatus}: ${JSON.stringify(observed.terminalEvent)}\n${stderr.join("")}`,
    );
  }

  await apiFetch(port, sessionApiKey, `/api/conversations/${conversationId}`, {
    method: "DELETE",
  });
  console.log(
    `PASS: AgentSkill smoke saw <available_skills> contain "${SKILL_NAME}" and observed an invoke_skill tool call.`,
  );
} finally {
  server.kill("SIGTERM");
  await cleanupWorkspace(workspace);
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      const selected = address?.port;
      s.close(() => resolve(selected));
    });
    s.on("error", reject);
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Agent Server exited before health check passed:\n${stderr.join("")}`,
      );
    }
    for (const route of ["/alive", "/health"]) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${route}`);
        if (response.ok) return;
      } catch {
        // retry
      }
    }
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for Agent Server health:\n${stderr.join("")}`,
  );
}

async function createConversation({
  port,
  sessionApiKey,
  workspace,
  skillDir,
  model,
  apiKey,
  baseUrl,
  apiVersion,
  extraHeaders,
}) {
  const llm = {
    model: normalizeOpenHandsModel(model, baseUrl),
    api_key: apiKey,
  };
  if (baseUrl) llm.base_url = baseUrl;
  if (apiVersion) llm.api_version = apiVersion;
  if (extraHeaders && Object.keys(extraHeaders).length > 0) {
    llm.extra_headers = extraHeaders;
  }

  const body = {
    workspace: {
      kind: "LocalWorkspace",
      working_dir: workspace,
    },
    initial_message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "Greet 'Alice'. Use the greet-helper skill — it knows the exact response format.",
        },
      ],
      run: false,
    },
    max_iterations: 6,
    stuck_detection: true,
    confirmation_policy: { kind: "NeverConfirm" },
    tags: { source: "live-smoke", skill: "agentskill-smoke" },
    agent: {
      kind: "Agent",
      llm,
      tools: [
        { name: "file_editor", params: {} },
        { name: "terminal", params: {} },
      ],
      include_default_tools: ["FinishTool", "ThinkTool"],
      agent_context: {
        skills: [
          {
            name: SKILL_NAME,
            content: SKILL_BODY.split("---")[2]?.trim() ?? SKILL_BODY,
            description: SKILL_DESCRIPTION,
            is_agentskills_format: true,
            source: path.join(skillDir, "SKILL.md"),
            resources: {
              skill_root: skillDir,
            },
          },
        ],
      },
    },
  };

  return await apiFetch(port, sessionApiKey, "/api/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function runConversation(port, sessionApiKey, conversationId) {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/conversations/${conversationId}/run`,
    {
      method: "POST",
      headers: { "X-Session-API-Key": sessionApiKey },
    },
  );
  if (response.status === 409) return;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `POST /api/conversations/${conversationId}/run failed (${response.status}): ${text}`,
    );
  }
}

async function backfillExistingEvents(port, sessionApiKey, conversationId, observed) {
  let pageId;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (pageId) params.set("page_id", pageId);
    const url = `/api/conversations/${conversationId}/events/search?${params.toString()}`;
    let payload;
    try {
      payload = await apiFetch(port, sessionApiKey, url, { method: "GET" });
    } catch (e) {
      console.warn(`backfill page ${page} failed:`, e.message);
      return;
    }
    for (const item of payload.items ?? []) {
      inspectEvent(item, observed);
    }
    pageId = payload.next_page_id;
    if (!pageId) return;
  }
}

function readDbModelSettings() {
  const dbPath =
    process.env.SKILL_BUILDER_DB_PATH ??
    path.join(
      homedir(),
      "Library",
      "Application Support",
      "com.vibedata.skill-builder",
      "db",
      "skill-builder.db",
    );
  const query = "select value from settings where key = 'app_settings'";
  const result = spawnSync("sqlite3", [dbPath, query], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) return {};

  try {
    const settings = JSON.parse(result.stdout);
    const m = settings.model_settings ?? settings.modelSettings ?? {};
    return {
      model: normalizeBlank(m.model),
      apiKey: normalizeBlank(m.api_key ?? m.apiKey),
      baseUrl: normalizeBlank(m.base_url ?? m.baseUrl),
      apiVersion: normalizeBlank(m.api_version ?? m.apiVersion),
      extraHeaders: m.extra_headers ?? m.extraHeaders,
    };
  } catch {
    return {};
  }
}

function normalizeBlank(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOpenHandsModel(model, baseUrl) {
  if (baseUrl && model.startsWith("opencode-go/")) {
    return `openai/${model.slice("opencode-go/".length)}`;
  }
  return model;
}

async function cleanupWorkspace(workspace) {
  spawnSync("chmod", ["-R", "u+rwx", workspace], { encoding: "utf8" });
  await rm(workspace, { recursive: true, force: true });
}

async function apiFetch(port, sessionApiKey, route, init) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "X-Session-API-Key": sessionApiKey,
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${route} failed (${response.status}): ${text}`,
    );
  }
  return text.trim() ? JSON.parse(text) : {};
}

function waitForSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function waitForSocketTerminal(socket, observed) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Agent Server terminal event."));
    }, 180_000);

    socket.addEventListener("message", (event) => {
      const payload = parseJson(String(event.data));
      if (!payload) return;
      inspectEvent(payload, observed);
      if (isTerminal(payload)) {
        observed.terminal = true;
        observed.terminalStatus = terminalStatus(payload);
        observed.terminalEvent = payload;
        clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });
    socket.addEventListener("error", (event) => {
      clearTimeout(timeout);
      reject(event.error ?? new Error("Agent Server socket error."));
    });
    socket.addEventListener("close", () => {
      if (!observed.terminal) {
        clearTimeout(timeout);
        reject(new Error("Agent Server socket closed before terminal state."));
      }
    });
  });
}

function inspectEvent(payload, observed) {
  const kind = payload.kind ?? payload.event_class ?? payload.type;
  if (kind === "SystemPromptEvent") {
    const text = JSON.stringify(payload);
    if (text.includes(SKILL_NAME) && /available_skills/i.test(text)) {
      observed.systemPromptHasSkill = true;
    }
  }
  if (kind === "ActionEvent") {
    const toolName = payload.tool_name ?? payload.toolName;
    if (typeof toolName === "string") {
      observed.toolNamesSeen.add(toolName);
      if (toolName === "invoke_skill") {
        const action = JSON.stringify(payload.action ?? payload);
        if (action.includes(SKILL_NAME)) {
          observed.invokeSkillSeen = true;
        }
      }
    }
  }
}

function isTerminal(payload) {
  const status = terminalStatus(payload);
  if (
    ["completed", "success", "error", "failed", "cancelled", "canceled"].includes(status)
  ) {
    return true;
  }
  const eventType = payload.kind ?? payload.type;
  const key = payload.key ?? payload.state_key;
  const value = payload.value ?? payload.status;
  return (
    eventType === "ConversationStateUpdateEvent" &&
    ["status", "execution_status"].includes(key) &&
    ["finished", "error", "stuck", "cancelled", "canceled"].includes(value)
  );
}

function terminalStatus(payload) {
  return (
    payload.status ??
    payload.state?.status ??
    payload.conversation?.status ??
    payload.value
  );
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
