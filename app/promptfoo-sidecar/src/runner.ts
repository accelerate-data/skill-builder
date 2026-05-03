import "promptfoo";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  parseSidecarRequest,
  serializeSidecarEvent,
  type RunEvalRequest,
  type SidecarEvent,
} from "./protocol.js";
import { normalizePromptfooResults } from "./result-normalizer.js";

export async function runJsonlSidecar(
  input: NodeJS.ReadableStream = stdin,
  output: NodeJS.WritableStream = stdout,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const request = parseSidecarRequest(line);
      writeEvent(output, buildSkeletonResult(request));
    } catch (error) {
      writeEvent(output, {
        id: "unknown",
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function buildSkeletonResult(request: RunEvalRequest): SidecarEvent {
  const result = normalizePromptfooResults(request.mode, []);

  return {
    id: request.id,
    type: "result",
    result,
  };
}

function writeEvent(output: NodeJS.WritableStream, event: SidecarEvent): void {
  output.write(serializeSidecarEvent(event));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runJsonlSidecar();
}
