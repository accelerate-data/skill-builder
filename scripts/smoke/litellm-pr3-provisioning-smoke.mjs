#!/usr/bin/env node
/**
 * PR3 Live Smoke Test: Virtual Key Provisioning
 *
 * Tests:
 * 1. Bootstrap persistent LiteLLM venv under {appData}/litellm/venv
 * 2. Spawn LiteLLM proxy via <venv>/python -m litellm
 * 3. Health check
 * 4. Bootstrap shared user "skill-builder"
 * 5. Generate virtual key with models + per-model budgets
 * 6. Verify key via /key/info
 * 7. Shutdown proxy
 *
 * Run: LITELLM_PR3_SMOKE=1 node scripts/smoke/litellm-pr3-provisioning-smoke.mjs
 */
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const enabled = process.env.LITELLM_PR3_SMOKE === "1";
if (!enabled) {
  console.log("SKIP: set LITELLM_PR3_SMOKE=1 to run the PR3 provisioning smoke test.");
  process.exit(0);
}

const appDataDir = await mkdtemp(path.join(tmpdir(), "litellm-pr3-smoke-"));
const litellmDir = path.join(appDataDir, "litellm");
const venvDir = path.join(litellmDir, "venv");
const port = await reservePort();
const masterKey = `sk-pr3-smoke-${Date.now()}`;
const baseUrl = `http://127.0.0.1:${port}`;
const configPath = path.join(litellmDir, "config.yaml");
const pythonPath = process.platform === "win32"
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python");
const prismaPath = process.platform === "win32"
  ? path.join(venvDir, "Scripts", "prisma.exe")
  : path.join(venvDir, "bin", "prisma");
const venvBinDir = path.dirname(prismaPath);
const databaseUrl = `sqlite:///${litellmDir}/litellm.db`;

const configYaml = `model_list: []
general_settings:
  master_key: ${masterKey}
  database_url: ${databaseUrl}
`;

await mkdir(litellmDir, { recursive: true });
await writeFile(configPath, configYaml);

console.log("\n--- PR3 Provisioning Smoke Test ---\n");
console.log(`  INFO: Bootstrapping LiteLLM venv at ${venvDir}`);
await run("uv", ["venv", venvDir], { cwd: litellmDir });
await run("uv", ["pip", "install", "--python", pythonPath, "litellm[proxy]", "prisma"], {
  cwd: litellmDir,
});
const schemaPath = await capture(
  pythonPath,
  [
    "-c",
    "import litellm, os; print(os.path.join(os.path.dirname(litellm.__file__), 'proxy', 'schema.prisma'))",
  ],
  { cwd: litellmDir }
);
await assertExists(schemaPath, "LiteLLM packaged schema");
await run(prismaPath, ["generate", "--schema", schemaPath], {
  cwd: path.dirname(schemaPath),
  env: {
    PATH: `${venvBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
  },
});
await assertExists(pythonPath, "LiteLLM venv python");
await assertExists(prismaPath, "LiteLLM venv prisma");

const proxy = spawn(
  pythonPath,
  ["-m", "litellm.proxy.proxy_cli", "--config", configPath, "--port", String(port)],
  {
    cwd: litellmDir,
    env: {
      ...process.env,
      LITELLM_MASTER_KEY: masterKey,
      DATABASE_URL: databaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

const stderr = [];
proxy.stderr.on("data", (chunk) => stderr.push(String(chunk)));

let passed = 0;
let failed = 0;

function pass(label) { console.log(`  PASS: ${label}`); passed++; }
function fail(label, reason) { console.log(`  FAIL: ${label} — ${reason}`); failed++; }

try {
  await waitForPort(port);
  await sleep(2000);

  if (proxy.exitCode !== null) {
    const stderrText = stderr.join("");
    console.log(`\n  FAIL: Proxy exited unexpectedly:\n${stderrText}`);
    process.exit(1);
  }

  // Test 1: Health check
  try {
    const resp = await fetch(`${baseUrl}/health`);
    if (resp.ok) {
      const body = await resp.json();
      if (body.status === "healthy") pass("Health check returned healthy");
      else fail("Health check", `unexpected status: ${body.status}`);
    } else {
      fail("Health check", `HTTP ${resp.status}`);
    }
  } catch (e) {
    fail("Health check", e.message);
  }

  // Test 2: Bootstrap shared user "skill-builder"
  let userId = "skill-builder";
  try {
    const resp = await fetch(`${baseUrl}/user/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
      body: JSON.stringify({ user_id: userId }),
    });
    if (resp.ok) {
      const body = await resp.json();
      pass(`Created shared user '${userId}' (response user_id: ${body.user_id})`);
    } else {
      const text = await resp.text();
      if (resp.status === 409 || text.includes("already exists")) {
        pass(`Shared user '${userId}' already exists (409 — idempotent)`);
      } else {
        fail("Create shared user", `HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
    }
  } catch (e) {
    fail("Create shared user", e.message);
  }

  // Test 3: Generate virtual key with per-model budgets
  let virtualKey = null;
  try {
    const keyReq = {
      user_id: userId,
      models: ["gpt-4", "claude-sonnet-4-5"],
      max_budget: 100.0,
      budget_duration: "30d",
      tpm_limit: 10000,
      rpm_limit: 60,
      model_max_budget: { "gpt-4": 50.0, "claude-sonnet-4-5": 30.0 },
    };
    const resp = await fetch(`${baseUrl}/key/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
      body: JSON.stringify(keyReq),
    });
    if (resp.ok) {
      const body = await resp.json();
      virtualKey = body.key;
      if (virtualKey && virtualKey.startsWith("sk-")) {
        pass(`Generated virtual key: ${virtualKey.slice(0, 12)}...`);
      } else {
        fail("Generate key", `key missing or invalid format: ${JSON.stringify(body).slice(0, 100)}`);
      }
    } else {
      const text = await resp.text();
      fail("Generate key", `HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
  } catch (e) {
    fail("Generate key", e.message);
  }

  // Test 4: Verify key via /key/info
  if (virtualKey) {
    try {
      const resp = await fetch(`${baseUrl}/key/info?key=${virtualKey}`, {
        headers: { Authorization: `Bearer ${masterKey}` },
      });
      if (resp.ok) {
        const body = await resp.json();
        const info = body.info || body;
        const models = info.models || [];
        const spend = info.spend ?? info.total_spend ?? 0;
        pass(`Key info verified — models: [${models.join(", ")}], spend: $${spend}`);
      } else {
        const text = await resp.text();
        fail("Key info", `HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      fail("Key info", e.message);
    }
  }

  // Test 5: Verify per-profile budget was applied
  if (virtualKey) {
    try {
      const resp = await fetch(`${baseUrl}/key/info?key=${virtualKey}`, {
        headers: { Authorization: `Bearer ${masterKey}` },
      });
      if (resp.ok) {
        const body = await resp.json();
        const info = body.info || body;
        const maxBudget = info.max_budget ?? info.spend_limit;
        if (maxBudget === 100.0 || maxBudget === "100.0") {
          pass(`Per-profile budget verified: $${maxBudget}`);
        } else {
          fail("Per-profile budget", `expected 100.0, got: ${maxBudget}`);
        }
      }
    } catch (e) {
      fail("Per-profile budget check", e.message);
    }
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
} finally {
  proxy.kill("SIGTERM");
  await sleep(2000);
  if (proxy.exitCode === null) proxy.kill("SIGKILL");
  await rm(appDataDir, { recursive: true, force: true });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const p = server.address()?.port;
      server.close(() => resolve(p));
    });
    server.on("error", reject);
  });
}

async function waitForPort(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const conn = net.createConnection({ port, host: "127.0.0.1" });
      await new Promise((resolve, reject) => {
        conn.on("connect", () => { conn.end(); resolve(); });
        conn.on("error", reject);
        setTimeout(() => { conn.destroy(); reject(new Error("timeout")); }, 1000);
      });
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(command, args, options = {}) {
  await capture(command, args, options, false);
}

async function capture(command, args, options = {}, trim = true) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(trim ? stdout.trim() : stdout);
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
      }
    });
  });
}

async function assertExists(filePath, label) {
  await access(filePath);
  console.log(`  PASS: ${label} exists at ${filePath}`);
}
