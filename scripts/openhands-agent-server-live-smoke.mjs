#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";

const enabled = process.env.OPENHANDS_AGENT_SERVER_LIVE_SMOKE === "1";
if (!enabled) {
  console.log("SKIP: set OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 to run the live Agent Server smoke.");
  process.exit(0);
}

const model = process.env.OPENHANDS_LIVE_SMOKE_MODEL;
const apiKey =
  process.env.OPENHANDS_LIVE_SMOKE_API_KEY ??
  process.env.ANTHROPIC_API_KEY ??
  process.env.OPENAI_API_KEY ??
  process.env.GEMINI_API_KEY;

if (!model || !apiKey) {
  console.error(
    "Missing OPENHANDS_LIVE_SMOKE_MODEL and OPENHANDS_LIVE_SMOKE_API_KEY, or a provider API key env var.",
  );
  process.exit(1);
}

const port = await reservePort();
const sessionApiKey = crypto.randomUUID();
const workspace = await mkdtemp(path.join(tmpdir(), "openhands-agent-server-smoke-"));
await writeFile(path.join(workspace, "README.md"), "OpenHands Agent Server smoke workspace\n");

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
    env: {
      ...process.env,
      OPENHANDS_SUPPRESS_BANNER: "1",
      SESSION_API_KEY: sessionApiKey,
      OH_SESSION_API_KEYS_0: sessionApiKey,
      OH_SECRET_KEY: sessionApiKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const stderr = [];
server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

try {
  await waitForHealth(port);
  const conversation = await createConversation({ port, sessionApiKey, workspace, model, apiKey });
  const conversationId = conversation.id ?? conversation.conversation_id ?? conversation.conversationId;
  if (!conversationId) {
    throw new Error(`Create conversation response did not include an id: ${JSON.stringify(conversation)}`);
  }

  const socket = new WebSocket(`ws://127.0.0.1:${port}/sockets/events/${conversationId}`);
  const observed = {
    progress: false,
    terminal: false,
    terminalEvent: undefined,
  };

  const socketDone = waitForSocketTerminal(socket, observed);
  await waitForSocketOpen(socket);
  socket.send(JSON.stringify({ type: "auth", session_api_key: sessionApiKey }));
  await apiFetch(port, sessionApiKey, `/api/conversations/${conversationId}/run`, {
    method: "POST",
    body: "{}",
  });
  await socketDone;

  if (!observed.progress) {
    throw new Error("Agent Server smoke did not observe a progress event before terminal state.");
  }
  if (!observed.terminal) {
    throw new Error("Agent Server smoke did not observe terminal state.");
  }

  await apiFetch(port, sessionApiKey, `/api/conversations/${conversationId}`, { method: "DELETE" });
  console.log(`PASS: Agent Server smoke completed with terminal event ${JSON.stringify(observed.terminalEvent)}`);
} finally {
  server.kill("SIGTERM");
  await rm(workspace, { recursive: true, force: true });
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = address?.port;
      server.close(() => resolve(selected));
    });
    server.on("error", reject);
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Agent Server exited before health check passed:\n${stderr.join("")}`);
    }
    for (const route of ["/alive", "/health"]) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${route}`);
        if (response.ok) return;
      } catch {
        // Retry until deadline.
      }
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Agent Server health:\n${stderr.join("")}`);
}

async function createConversation({ port, sessionApiKey, workspace, model, apiKey }) {
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
          text: "Smoke test. Inspect README.md, then finish with exactly SMOKE_OK.",
        },
      ],
      run: false,
    },
    max_iterations: 3,
    stuck_detection: true,
    confirmation_policy: {
      kind: "NeverConfirm",
    },
    tags: {
      source: "live-smoke",
      skill: "openhands-agent-server-smoke",
    },
    agent: {
      kind: "Agent",
      llm: {
        model,
        api_key: apiKey,
      },
      tools: [
        {
          name: "BashTool",
          params: {},
        },
      ],
      include_default_tools: ["FinishTool", "ThinkTool"],
      agent_context: {},
    },
  };
  return await apiFetch(port, sessionApiKey, "/api/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function apiFetch(port, sessionApiKey, route, init) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "X-Session-API-Key": sessionApiKey,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${route} failed (${response.status}): ${text}`);
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
    }, 120_000);

    socket.addEventListener("message", (event) => {
      const payload = parseJson(String(event.data));
      if (!payload) return;
      if (isTerminal(payload)) {
        observed.terminal = true;
        observed.terminalEvent = payload;
        clearTimeout(timeout);
        socket.close();
        resolve();
        return;
      }
      observed.progress = true;
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

function isTerminal(payload) {
  const status = payload.status ?? payload.state?.status ?? payload.conversation?.status;
  if (["completed", "success", "error", "failed", "cancelled", "canceled"].includes(status)) {
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
