import { query } from "@anthropic-ai/claude-code";
import { createInterface } from "readline";

interface SidecarConfig {
  prompt: string;
  model: string;
  apiKey: string;
  cwd: string;
  allowedTools?: string[];
  maxTurns?: number;
  permissionMode?: string;
}

function readLineFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin });
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
    rl.once("close", () => {
      reject(new Error("stdin closed before receiving config"));
    });
    rl.once("error", reject);
  });
}

let aborted = false;
const abortController = new AbortController();

function handleShutdown() {
  aborted = true;
  abortController.abort();
}

process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);
process.stdin.on("close", handleShutdown);

async function main() {
  let config: SidecarConfig;

  try {
    const line = await readLineFromStdin();
    config = JSON.parse(line) as SidecarConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({ type: "error", error: `Failed to read config: ${message}` }) + "\n"
    );
    process.exit(1);
  }

  try {
    if (config.apiKey) {
      process.env.ANTHROPIC_API_KEY = config.apiKey;
    }

    const conversation = query({
      prompt: config.prompt,
      options: {
        model: config.model,
        cwd: config.cwd,
        allowedTools: config.allowedTools,
        maxTurns: config.maxTurns ?? 50,
        permissionMode: (config.permissionMode || "bypassPermissions") as "default" | "acceptEdits" | "bypassPermissions" | "plan",
        abortController,
      },
    });

    for await (const message of conversation) {
      if (aborted) break;
      process.stdout.write(JSON.stringify(message) + "\n");
    }

    process.exit(0);
  } catch (err) {
    if (aborted) {
      process.stderr.write("Agent cancelled via signal\n");
      process.exit(0);
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({ type: "error", error: message }) + "\n"
    );
    process.exit(1);
  }
}

main();
