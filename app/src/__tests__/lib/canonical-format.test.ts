import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE_ROOT = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "openhands-events",
);

type JsonRecord = Record<string, unknown>;

function listJsonlFixtures(): string[] {
  if (!fs.existsSync(FIXTURE_ROOT)) return [];
  return fs
    .readdirSync(FIXTURE_ROOT)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(FIXTURE_ROOT, name))
    .sort();
}

function readJsonlFixture(filePath: string): JsonRecord[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JsonRecord);
}

function relPath(filePath: string): string {
  return path.relative(FIXTURE_ROOT, filePath);
}

function parseStructuredResult(record: JsonRecord): JsonRecord | null {
  const resultText = record.result_text;
  if (typeof resultText !== "string") return null;
  const trimmed = resultText.trim();
  if (!trimmed.startsWith("{")) return null;
  return JSON.parse(trimmed) as JsonRecord;
}

const fixtureFiles = listJsonlFixtures();

describe("Canonical format: OpenHands transcript fixtures", () => {
  it("has checked-in JSONL fixtures to validate", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    const rel = relPath(file);

    describe(rel, () => {
      const records = readJsonlFixture(file);

      it("starts with a config record", () => {
        expect(records[0]?.type).toBe("config");
        expect(typeof records[0]?.config).toBe("object");
      });

      it("uses only supported transcript envelope types", () => {
        for (const record of records) {
          expect([
            "config",
            "conversation_event",
            "conversation_state",
          ]).toContain(record.type);
        }
      });

      it("keeps conversation_state envelopes structurally valid", () => {
        for (const record of records.filter((item) => item.type === "conversation_state")) {
          expect(record.runtime).toBe("openhands");
          expect(typeof record.agent_id).toBe("string");
          expect(typeof record.timestamp).toBe("number");
          expect([
            "starting",
            "running",
            "completed",
            "error",
            "cancelled",
          ]).toContain(record.status);
        }
      });

      it("keeps conversation_event envelopes structurally valid", () => {
        for (const record of records.filter((item) => item.type === "conversation_event")) {
          expect(typeof record.event_class).toBe("string");
          expect(typeof record.timestamp).toBe("number");
          expect(record.event).toBeTruthy();
          expect(typeof record.event).toBe("object");
        }
      });

      it("keeps completed structured-result payloads JSON-parseable", () => {
        const completedStates = records.filter(
          (item) =>
            item.type === "conversation_state" && item.status === "completed",
        );

        expect(completedStates.length).toBeGreaterThan(0);

        for (const record of completedStates) {
          const parsed = parseStructuredResult(record);
          expect(parsed).not.toBeNull();
        }
      });

      it("keeps answer-evaluator result payloads internally consistent", () => {
        const completedStates = records.filter(
          (item) =>
            item.type === "conversation_state" && item.status === "completed",
        );

        for (const record of completedStates) {
          const parsed = parseStructuredResult(record);
          if (!parsed || typeof parsed.verdict !== "string") continue;

          expect(["sufficient", "mixed", "insufficient"]).toContain(parsed.verdict);
          expect(typeof parsed.answered_count).toBe("number");
          expect(typeof parsed.empty_count).toBe("number");
          expect(typeof parsed.vague_count).toBe("number");
          expect(typeof parsed.total_count).toBe("number");
          expect(Array.isArray(parsed.per_question)).toBe(true);
        }
      });
    });
  }
});
