import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectConversationEvents } from "@/lib/conversation-event-projection";
import type { ConversationEventEnvelope } from "@/lib/conversation-event-types";
import {
  buildCanonicalConversationEventEnvelope,
  normalizeConversationEventMessage,
} from "@/lib/openhands-conversation-events";

function makeEvent(
  overrides: Partial<ConversationEventEnvelope> & {
    eventId: string;
    conversationId: string;
    createdAtMs: number;
  },
): ConversationEventEnvelope {
  return {
    eventId: overrides.eventId,
    conversationId: overrides.conversationId,
    origin: "frontend",
    status: "accepted",
    createdAtMs: overrides.createdAtMs,
    display: {
      kind: "user_message",
    },
    payload: {
      frontendCommand: {
        type: "send_message",
        text: "hello",
      },
    },
    ...overrides,
  };
}

const FIXTURE_ROOT = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "openhands-conversations",
);

function loadFixtureEnvelopes(name: string): ConversationEventEnvelope[] {
  const fixturePath = path.join(FIXTURE_ROOT, `${name}.json`);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
    conversationId: string;
    records: Array<Record<string, unknown>>;
  };

  return fixture.records.map((record) => {
    const event = normalizeConversationEventMessage(record);
    if (!event) {
      throw new Error(`Failed to normalize fixture record from ${name}`);
    }
    return buildCanonicalConversationEventEnvelope(event, fixture.conversationId);
  });
}

describe("conversation-event-projection", () => {
  it("projects frontend and assistant messages into semantic narrative rows", () => {
    const nodes = projectConversationEvents([
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
        display: { kind: "user_message", label: "You" },
      }),
      makeEvent({
        eventId: "evt-2",
        conversationId: "conv-1",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "agent_message", label: "OpenHands" },
        payload: { rawOpenHandsEvent: { text: "Done." } },
      }),
    ]);

    expect(nodes).toEqual([
      expect.objectContaining({
        id: "evt-1",
        kind: "task_sent",
        status: "accepted",
        sourceEventIds: ["evt-1"],
      }),
      expect.objectContaining({
        id: "evt-2",
        kind: "agent_update",
        status: "observed",
        sourceEventIds: ["evt-2"],
      }),
    ]);
  });

  it("groups terminal, file, and reasoning activity from fixture-derived OpenHands events", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("terminal-and-file-activity"));

    expect(nodes.map((node) => node.kind)).toEqual([
      "task_sent",
      "activity_trace",
      "agent_update",
    ]);

    expect(nodes[1]).toMatchObject({
      kind: "activity_trace",
      traceItems: expect.arrayContaining([
        expect.objectContaining({ kind: "runtime_setup", title: "Runtime setup" }),
        expect.objectContaining({ kind: "lifecycle", title: "Conversation running" }),
        expect.objectContaining({ kind: "file_activity", title: "File activity" }),
        expect.objectContaining({ kind: "terminal_activity", title: "Terminal activity" }),
        expect.objectContaining({
          kind: "reasoning",
          title: "Reasoning",
          summary: "Let me synthesize the generation brief from the confirmed decisions and then create the skill package.",
        }),
        expect.objectContaining({ kind: "lifecycle", title: "Conversation finished" }),
      ]),
    });
  });

  it("produces first-class Skill, Subagent, and Result rows from real tool semantics", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("skill-and-subagent"));

    expect(nodes.map((node) => node.kind)).toEqual(["activity_trace"]);
    expect(nodes[0]).toMatchObject({
      kind: "activity_trace",
      traceItems: expect.arrayContaining([
        expect.objectContaining({ kind: "skill", title: "Skill invocation" }),
        expect.objectContaining({ kind: "subagent", title: "Subagent invocation" }),
        expect.objectContaining({ kind: "result", title: "Result" }),
      ]),
    });
  });

  it("suppresses telemetry-only state updates and reduces lifecycle churn", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("lifecycle-and-suppression"));

    expect(nodes.map((node) => node.kind)).toEqual(["task_sent", "activity_trace"]);
    expect(nodes[1]).toMatchObject({
      traceItems: expect.arrayContaining([
        expect.objectContaining({ kind: "lifecycle", title: "Conversation running" }),
        expect.objectContaining({ kind: "pause", title: "Paused" }),
        expect.objectContaining({ kind: "lifecycle", title: "Conversation error" }),
        expect.objectContaining({ kind: "lifecycle", title: "Conversation finished" }),
      ]),
    });

    const suppressedIds = nodes.flatMap((node) => node.suppressedEventIds ?? []);
    expect(suppressedIds).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ConversationStateUpdateEvent"),
        expect.stringContaining("ConversationStateUpdateEvent"),
      ]),
    );
  });

  it("renders runtime setup and distinct error rows from fixture-derived events", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("system-prompt-and-errors"));

    expect(nodes.map((node) => node.kind)).toEqual(["activity_trace"]);
    expect(nodes[0]).toMatchObject({
      traceItems: expect.arrayContaining([
        expect.objectContaining({ kind: "runtime_setup", title: "Runtime setup" }),
        expect.objectContaining({ kind: "tool_error", title: "Tool error" }),
        expect.objectContaining({ kind: "subagent_error", title: "Subagent error" }),
      ]),
    });
  });

  it("keeps unknown raw event shapes visible instead of dropping them", () => {
    const [node] = projectConversationEvents([
      makeEvent({
        eventId: "evt-unknown",
        conversationId: "conv-1",
        createdAtMs: 1_000,
        origin: "backend",
        status: "observed",
        display: { kind: "system" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-1",
            eventClass: "CustomSdkEvent",
            timestamp: 1_000,
            event: {
              nested: {
                value: "Preserve unknown payloads.",
              },
            },
          },
        },
      }),
    ]);

    expect(node).toMatchObject({
      kind: "unknown_event",
      sourceEventIds: ["evt-unknown"],
    });
  });
});
