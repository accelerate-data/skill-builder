import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE_ROOT = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "openhands-conversations",
);

interface FixtureFile {
  conversationId: string;
  note: string;
  records: Array<Record<string, unknown>>;
}

function listFixturePaths(): string[] {
  return fs
    .readdirSync(FIXTURE_ROOT)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(FIXTURE_ROOT, name))
    .sort();
}

function readFixture(filePath: string): FixtureFile {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as FixtureFile;
}

describe("conversation-event fixtures", () => {
  it("keeps the checked-in projection fixture set present", () => {
    const fixtureNames = listFixturePaths().map((filePath) => path.basename(filePath));

    expect(fixtureNames).toEqual([
      "lifecycle-and-suppression.json",
      "skill-and-subagent.json",
      "system-prompt-and-errors.json",
      "terminal-and-file-activity.json",
    ]);
  });

  it("keeps the intended raw event kinds represented across fixtures", () => {
    const eventClasses = new Set<string>();
    const toolNames = new Set<string>();
    const stateKeys = new Set<string>();

    for (const filePath of listFixturePaths()) {
      const fixture = readFixture(filePath);
      expect(typeof fixture.note).toBe("string");
      expect(fixture.note.length).toBeGreaterThan(0);
      expect(Array.isArray(fixture.records)).toBe(true);
      expect(fixture.records.length).toBeGreaterThan(0);

      for (const record of fixture.records) {
        expect(record.type).toBe("conversation_event");
        expect(record.runtime).toBe("openhands");
        expect(record.conversation_id).toBe(fixture.conversationId);
        expect(typeof record.timestamp).toBe("number");
        expect(typeof record.event_class).toBe("string");
        eventClasses.add(record.event_class as string);

        const event = record.event as Record<string, unknown>;
        if (typeof event?.tool_name === "string") {
          toolNames.add(event.tool_name);
        }
        if (record.event_class === "ConversationStateUpdateEvent" && typeof event?.key === "string") {
          stateKeys.add(event.key);
        }
      }
    }

    expect(eventClasses).toEqual(
      new Set([
        "MessageEvent",
        "ActionEvent",
        "ObservationEvent",
        "ConversationStateUpdateEvent",
        "SystemPromptEvent",
        "PauseEvent",
        "ConversationErrorEvent",
        "AgentErrorEvent",
      ]),
    );
    expect(toolNames).toEqual(
      new Set(["file_editor", "terminal", "think", "invoke_skill", "task", "finish"]),
    );
    expect(stateKeys).toEqual(
      new Set(["execution_status", "stats", "last_user_message_id"]),
    );
  });
});
