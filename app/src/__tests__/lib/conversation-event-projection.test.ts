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
      "runtime_setup",
      "task_sent",
      "activity_trace",
      "agent_update",
    ]);

    expect(nodes[0]).toMatchObject({
      kind: "runtime_setup",
      label: "Runtime setup",
    });

    expect(nodes[2]).toMatchObject({
      kind: "activity_trace",
      traceItems: expect.arrayContaining([
        expect.objectContaining({
          kind: "file_activity",
          title: "File activity",
          summary: "/Users/hbanerjee/skill-builder/default/skills/measuring-pipeline-value",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({ title: "Item 1: Action" }),
            expect.objectContaining({ title: "Item 1: Observation" }),
          ]),
        }),
        expect.objectContaining({
          kind: "terminal_activity",
          title: "Terminal activity",
          summary: "ls -la /Users/hbanerjee/skill-builder/default/skills/measuring-pipeline-value",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({ title: "Item 1: Action" }),
            expect.objectContaining({ title: "Item 1: Observation" }),
          ]),
        }),
        expect.objectContaining({
          kind: "reasoning",
          title: "Reasoning",
          summary: "Let me synthesize the generation brief from the confirmed decisions and then create the skill package.",
        }),
      ]),
    });
  });

  it("renders skill and subagent invocation inside activity trace while keeping result standalone", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("skill-and-subagent"));

    expect(nodes.map((node) => node.kind)).toEqual(["activity_trace", "result"]);
    expect(nodes[0]).toMatchObject({
      kind: "activity_trace",
      traceItems: expect.arrayContaining([
        expect.objectContaining({
          kind: "skill",
          title: "Skill invocation",
          summary: "Load skill-requirements research methodology",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({
              title: "Summary",
              body:
                "Load skill-requirements research methodology\n\nSkill content loaded.",
            }),
          ]),
        }),
        expect.objectContaining({
          kind: "subagent",
          title: "Subagent invocation",
          summary: "Verify forecasting-revenue skill package",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({
              title: "Summary",
              body: "Verify forecasting-revenue skill package",
            }),
            expect.objectContaining({
              title: "Action",
              body: "Verify forecasting-revenue skill package",
            }),
            expect.objectContaining({
              title: "Observation",
              body: "{\"status\":\"pass\",\"findings\":[]}",
            }),
          ]),
        }),
      ]),
    });
    expect(nodes[1]).toMatchObject({
      kind: "result",
      bodyText:
        "Verification complete. The skill package passes all review criteria with two minor findings.",
    });
  });

  it("shows subagent thought separately from action and observation", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-subagent-action",
        conversationId: "conv-subagent-thought",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_500,
        display: { kind: "tool_call" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-subagent-thought",
            eventClass: "ActionEvent",
            timestamp: 1_778_000_500,
            tool_call_id: "call-task-1",
            event: {
              source: "agent",
              tool_name: "task",
              tool_call_id: "call-task-1",
              thought: [
                {
                  type: "text",
                  text: "Now I'll launch the verifier subagent for pass 1.",
                },
              ],
              action: {
                description: "Verify generated skill package",
                kind: "TaskAction",
              },
            },
          },
        },
      },
      {
        eventId: "evt-subagent-observation",
        conversationId: "conv-subagent-thought",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_501,
        display: { kind: "tool_result" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-subagent-thought",
            eventClass: "ObservationEvent",
            timestamp: 1_778_000_501,
            tool_call_id: "call-task-1",
            event: {
              source: "environment",
              tool_name: "task",
              tool_call_id: "call-task-1",
              observation: {
                content: [{ type: "text", text: "{\"status\":\"pass\",\"findings\":[]}" }],
                kind: "TaskObservation",
              },
            },
          },
        },
      },
    ]);

    expect(nodes).toMatchObject([
      {
        kind: "activity_trace",
        traceItems: [
          expect.objectContaining({
            kind: "subagent",
            summary: "Verify generated skill package",
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Thought",
                body: "Now I'll launch the verifier subagent for pass 1.",
              }),
              expect.objectContaining({
                title: "Action",
                body: "Verify generated skill package",
              }),
              expect.objectContaining({
                title: "Observation",
                body: "{\"status\":\"pass\",\"findings\":[]}",
              }),
            ]),
          }),
        ],
      },
    ]);
  });

  it("suppresses telemetry-only state updates and reduces lifecycle churn", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("lifecycle-and-suppression"));

    expect(nodes.map((node) => node.kind)).toEqual(["task_sent"]);

    const suppressedIds = nodes.flatMap((node) => node.suppressedEventIds ?? []);
    expect(suppressedIds).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ConversationStateUpdateEvent"),
        expect.stringContaining("ConversationStateUpdateEvent"),
      ]),
    );
  });

  it("uses thought-array reasoning text instead of placeholder summaries", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-reasoning-fallback",
        conversationId: "conv-reasoning-fallback",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_301,
        display: { kind: "tool_call" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-reasoning-fallback",
            eventClass: "ActionEvent",
            timestamp: 1_778_000_301,
            event: {
              source: "agent",
              tool_name: "think",
              tool_call_id: "call-think-2",
              thought: [
                {
                  type: "text",
                  text: "Let me analyze the current clarification record and identify material gaps.",
                },
              ],
              action: {
                kind: "ThinkAction",
              },
            },
          },
        },
      },
    ]);

    expect(nodes).toMatchObject([
      {
        kind: "activity_trace",
        traceItems: [
          expect.objectContaining({
            kind: "reasoning",
            summary:
              "Let me analyze the current clarification record and identify material gaps.",
          }),
        ],
      },
    ]);
  });

  it("uses nested think-action thought text when top-level reasoning fields are blank", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-reasoning-action-fallback",
        conversationId: "conv-reasoning-action-fallback",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_302,
        display: { kind: "tool_call" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-reasoning-action-fallback",
            eventClass: "ActionEvent",
            timestamp: 1_778_000_302,
            event: {
              source: "agent",
              tool_name: "think",
              tool_call_id: "call-think-3",
              reasoning_content: "",
              thought: [{ type: "text", text: "" }],
              action: {
                kind: "ThinkAction",
                thought:
                  "Let me carefully analyze every answer for material gaps before constructing the refinements.",
              },
            },
          },
        },
      },
    ]);

    expect(nodes).toMatchObject([
      {
        kind: "activity_trace",
        traceItems: [
          expect.objectContaining({
            kind: "reasoning",
            summary:
              "Let me carefully analyze every answer for material gaps before constructing the refinements.",
          }),
        ],
      },
    ]);
  });

  it("includes both file path and observation text for file activity", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-file-observation",
        conversationId: "conv-file-observation",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_400,
        display: { kind: "tool_result" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-file-observation",
            eventClass: "ObservationEvent",
            timestamp: 1_778_000_400,
            event: {
              source: "environment",
              tool_name: "file_editor",
              observation: {
                path: "/workspace/shared/schemas.md",
                content: "Read 140 lines from /workspace/shared/schemas.md.",
              },
            },
          },
        },
      },
    ]);

    expect(nodes).toMatchObject([
      {
        kind: "activity_trace",
        traceItems: [
          expect.objectContaining({
            kind: "file_activity",
            summary: "/workspace/shared/schemas.md",
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Summary",
                body: "Read 140 lines from /workspace/shared/schemas.md.",
              }),
              expect.objectContaining({
                title: "Item 1: Action",
                body: "/workspace/shared/schemas.md",
              }),
              expect.objectContaining({
                title: "Item 1: Observation",
                body: "Read 140 lines from /workspace/shared/schemas.md.",
              }),
            ]),
          }),
        ],
      },
    ]);
  });

  it("keeps long file activity details in the drawer while showing only a compact inline summary", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("terminal-and-file-activity"));

    expect(nodes[2]).toMatchObject({
      kind: "activity_trace",
      traceItems: expect.arrayContaining([
        expect.objectContaining({
          kind: "file_activity",
          summary: expect.stringMatching(/^\/Users\/hbanerjee\/skill-builder\//),
          drawerSections: expect.arrayContaining([
            expect.objectContaining({
              title: "Summary",
              body: expect.stringContaining("Here are the files and directories up to 2 levels deep"),
            }),
          ]),
        }),
      ]),
    });
  });

  it("renders runtime setup and distinct standalone error rows from fixture-derived events", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("system-prompt-and-errors"));

    expect(nodes.map((node) => node.kind)).toEqual([
      "runtime_setup",
      "error",
      "subagent_error",
    ]);
    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime_setup",
          label: "Runtime setup",
          bodyText: "You are OpenHands agent.",
        }),
        expect.objectContaining({ kind: "error", label: "Error" }),
        expect.objectContaining({ kind: "subagent_error", label: "Subagent error" }),
      ]),
    );
  });

  it("renders unmatched observations as visible standalone observation results", () => {
    const [node] = projectConversationEvents([
      {
        eventId: "evt-orphan-observation",
        conversationId: "conv-orphan-observation",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_500,
        display: { kind: "tool_result" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-orphan-observation",
            eventClass: "ObservationEvent",
            timestamp: 1_778_000_500,
            event: {
              source: "environment",
              tool_name: "custom_tool",
              observation: {
                content: "Observation without a matching action.",
              },
            },
          },
        },
      },
    ]);

    expect(node).toMatchObject({
      kind: "result",
      label: "Tool observation",
      bodyText: "Observation without a matching action.",
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

  it("suppresses restored wrapped conversation_state completion markers", () => {
    const nodes = projectConversationEvents([
      makeEvent({
        eventId: "evt-restored-finished",
        conversationId: "conv-restored",
        createdAtMs: 1_000,
        origin: "backend",
        status: "observed",
        display: { kind: "system" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-restored",
            eventClass: "conversation_state",
            timestamp: 1_000,
            event: {
              type: "conversation_state",
              status: "completed",
              result_text: "{\"status\":\"ok\"}",
            },
          },
        },
      }),
    ]);

    expect(nodes).toEqual([]);
  });

  it("suppresses wrapped nested conversation state update events for stats and finished markers", () => {
    const nodes = projectConversationEvents([
      makeEvent({
        eventId: "evt-wrapped-stats",
        conversationId: "conv-restored",
        createdAtMs: 1_000,
        origin: "backend",
        status: "observed",
        display: { kind: "system" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-restored",
            eventClass: "UnknownEvent",
            timestamp: 1_000,
            event: {
              kind: "ConversationStateUpdateEvent",
              key: "stats",
              value: { usage_to_metrics: {} },
            },
          },
        },
      }),
      makeEvent({
        eventId: "evt-wrapped-finished",
        conversationId: "conv-restored",
        createdAtMs: 1_001,
        origin: "backend",
        status: "observed",
        display: { kind: "system" },
        payload: {
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-restored",
            eventClass: "UnknownEvent",
            timestamp: 1_001,
            event: {
              kind: "ConversationStateUpdateEvent",
              key: "execution_status",
              value: "finished",
            },
          },
        },
      }),
    ]);

    expect(nodes).toEqual([]);
  });
});
