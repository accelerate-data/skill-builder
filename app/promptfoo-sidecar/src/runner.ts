import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { listCompletedRuns, readCompletedRun } from "./history.js";
import {
  parseSidecarRequest,
  serializeSidecarEvent,
  type ListHistoryRequest,
  type ReadHistoryRequest,
  type RunEvalRequest,
  type SidecarRequest,
  type SidecarEvent,
} from "./protocol.js";

const PROMPTFOO_EVAL_SUBPROCESS_PATH = fileURLToPath(
  new URL("./promptfoo-eval-subprocess.js", import.meta.url),
);

export async function runJsonlSidecar(
  input: NodeJS.ReadableStream = stdin,
  output: NodeJS.WritableStream = stdout,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    const request = parseRequest(line, output);
    if (!request) {
      continue;
    }

    try {
      await handleRequest(request, output);
    } catch (error) {
      writeEvent(output, {
        id: request.id,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function parseRequest(
  line: string,
  output: NodeJS.WritableStream,
): SidecarRequest | null {
  try {
    return parseSidecarRequest(line);
  } catch (error) {
    writeEvent(output, {
      id: "unknown",
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function handleRunEvalRequest(
  request: RunEvalRequest,
  output: NodeJS.WritableStream,
): Promise<void> {
  const total = request.executions.length;

  for (let index = 0; index < request.executions.length; index += 1) {
    const execution = request.executions[index];
    writeEvent(output, {
      id: request.id,
      type: "progress",
      completed: index + 1,
      total,
      caseId: execution.caseId,
      candidateId: execution.candidateId,
    });
  }

  await runPromptfooEvalInSubprocess(request);

  const persistedRun = readCompletedRun(request.promptfooConfigDir, request.id);
  if (!persistedRun) {
    throw new Error(`Promptfoo did not persist completed run ${request.id}`);
  }

  writeEvent(output, {
    id: request.id,
    type: "result",
    result: {
      mode: request.mode,
      total: persistedRun.summary.total,
      passed: persistedRun.summary.passed,
      failed: persistedRun.summary.failed,
      results: persistedRun.results,
    },
  });
}

async function handleListHistoryRequest(
  request: ListHistoryRequest,
  output: NodeJS.WritableStream,
): Promise<void> {
  writeEvent(output, {
    id: request.id,
    type: "result",
    runs: listCompletedRuns(request),
  });
}

async function handleReadHistoryRequest(
  request: ReadHistoryRequest,
  output: NodeJS.WritableStream,
): Promise<void> {
  writeEvent(output, {
    id: request.id,
    type: "result",
    run: readCompletedRun(request.promptfooConfigDir, request.runId),
  });
}

function writeEvent(output: NodeJS.WritableStream, event: SidecarEvent): void {
  output.write(serializeSidecarEvent(event));
}

async function handleRequest(
  request: SidecarRequest,
  output: NodeJS.WritableStream,
): Promise<void> {
  switch (request.type) {
    case "run_eval":
      await handleRunEvalRequest(request, output);
      return;
    case "list_history":
      await handleListHistoryRequest(request, output);
      return;
    case "read_history":
      await handleReadHistoryRequest(request, output);
      return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runJsonlSidecar();
}

async function runPromptfooEvalInSubprocess(
  request: RunEvalRequest,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [PROMPTFOO_EVAL_SUBPROCESS_PATH],
      {
        env: {
          ...process.env,
          PROMPTFOO_CONFIG_DIR: request.promptfooConfigDir,
        },
        stdio: ["pipe", "ignore", "pipe"],
      },
    );

    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.from(chunk));
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          detail.length > 0
            ? detail
            : `Promptfoo evaluation subprocess exited with code ${code ?? -1}`,
        ),
      );
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}
