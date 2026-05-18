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
          summary:
            "file_editor: command: view path: /Users/hbanerjee/skill-builder/default/skills/measuring-pipeline-value",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({ title: "Action" }),
            expect.objectContaining({ title: "Observation" }),
          ]),
        }),
        expect.objectContaining({
          kind: "terminal_activity",
          title: "Terminal activity",
          summary:
            "terminal: ls -la /Users/hbanerjee/skill-builder/default/skills/measuring-pipeline-value",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({ title: "Action" }),
            expect.objectContaining({ title: "Observation" }),
          ]),
        }),
        expect.objectContaining({
          kind: "reasoning",
          title: "Think",
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
          summary:
            "invoke_skill: name: researching-skill-requirements action: InvokeSkillAction",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({
              title: "Action",
              body: "name: researching-skill-requirements action: InvokeSkillAction",
            }),
            expect.objectContaining({
              title: "Observation",
              body: "Skill content loaded.",
            }),
          ]),
        }),
        expect.objectContaining({
          kind: "subagent",
          title: "Subagent invocation",
          summary: "task: Verify forecasting-revenue skill package",
          drawerSections: expect.arrayContaining([
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
          openHandsEvent: {
            kind: "ActionEvent",
            id: "task-action-1",
            timestamp: new Date(1_778_000_500).toISOString(),
            source: "agent",
            tool_name: "task",
            tool_call_id: "call-task-1",
            thought: "Now I'll launch the verifier subagent for pass 1.",
            action: {
              description: "Verify generated skill package",
              kind: "TaskAction",
            },
          },
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
          openHandsEvent: {
            kind: "ObservationEvent",
            id: "task-observation-1",
            timestamp: new Date(1_778_000_501).toISOString(),
            source: "environment",
            tool_name: "task",
            tool_call_id: "call-task-1",
            action_id: "task-action-1",
            observation: {
              content: [{ type: "text", text: "{\"status\":\"pass\",\"findings\":[]}" }],
              kind: "TaskObservation",
            },
          },
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
            summary: "Now I'll launch the verifier subagent for pass 1.",
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

  it("renders ThinkEvent reasoning items using thought text", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-reasoning-fallback",
        conversationId: "conv-reasoning-fallback",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_301,
        display: { kind: "reasoning" },
        payload: {
          openHandsEvent: {
            kind: "ThinkEvent",
            id: "think-fallback-1",
            timestamp: new Date(1_778_000_301).toISOString(),
            source: "agent",
            thought: "Let me analyze the current clarification record and identify material gaps.",
          },
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-reasoning-fallback",
            eventClass: "ThinkEvent",
            timestamp: 1_778_000_301,
            event: {
              source: "agent",
              thought: "Let me analyze the current clarification record and identify material gaps.",
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
            title: "Think",
            summary:
              "Let me analyze the current clarification record and identify material gaps.",
          }),
        ],
      },
    ]);
  });

  it("renders ThinkEvent reasoning drawers from the thought field", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-think-split",
        conversationId: "conv-think-split",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_303,
        display: { kind: "reasoning" },
        payload: {
          openHandsEvent: {
            kind: "ThinkEvent",
            id: "think-1",
            timestamp: new Date(1_778_000_303).toISOString(),
            source: "agent",
            thought:
              "Now I have the schema and semantic invariants. Let me apply the researching-skill-requirements skill to determine the right clarification questions.",
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
            title: "Think",
            summary:
              "Now I have the schema and semantic invariants. Let me apply the researching-skill-requirements skill to determine the right clarification questions.",
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Reasoning",
                body:
                  "Now I have the schema and semantic invariants. Let me apply the researching-skill-requirements skill to determine the right clarification questions.",
              }),
            ]),
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
          openHandsEvent: {
            kind: "ObservationEvent",
            id: "file-observation-1",
            timestamp: new Date(1_778_000_400).toISOString(),
            source: "environment",
            tool_name: "file_editor",
            tool_call_id: "call-file-1",
            action_id: "file-action-1",
            observation: {
              path: "/workspace/shared/schemas.md",
              content: "Read 140 lines from /workspace/shared/schemas.md.",
            },
          },
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
            summary: "file_editor: /workspace/shared/schemas.md",
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Observation",
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
          summary: expect.stringMatching(
            /^file_editor: command: view path: \/Users\/hbanerjee\/skill-builder\//,
          ),
          drawerSections: expect.arrayContaining([
            expect.objectContaining({
              title: "Observation",
              body: expect.stringContaining("Here are the files and directories up to 2 levels deep"),
            }),
          ]),
        }),
      ]),
    });
  });

  it("renders runtime setup and keeps tool-call failures inside activity trace", () => {
    const nodes = projectConversationEvents(loadFixtureEnvelopes("system-prompt-and-errors"));

    expect(nodes.map((node) => node.kind)).toEqual(["runtime_setup", "activity_trace"]);
    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime_setup",
          label: "Runtime setup",
          bodyText: "You are OpenHands agent.",
        }),
        expect.objectContaining({
          kind: "activity_trace",
          traceItems: expect.arrayContaining([
            expect.objectContaining({
              kind: "subagent",
              drawerSections: expect.arrayContaining([
                expect.objectContaining({
                  title: "Error",
                  body: "A restart occurred while this tool was in progress.",
                }),
              ]),
            }),
          ]),
        }),
      ]),
    );
  });

  it("renders unmatched observations inside activity trace", () => {
    const [node] = projectConversationEvents([
      {
        eventId: "evt-orphan-observation",
        conversationId: "conv-orphan-observation",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_778_000_500,
        display: { kind: "tool_result" },
        payload: {
          openHandsEvent: {
            kind: "ObservationEvent",
            id: "orphan-observation-1",
            timestamp: new Date(1_778_000_500).toISOString(),
            source: "environment",
            tool_name: "custom_tool",
            tool_call_id: "call-custom-1",
            action_id: "missing-action-1",
            observation: {
              content: "Observation without a matching action.",
            },
          },
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
      kind: "activity_trace",
      traceItems: [
        expect.objectContaining({
          kind: "tool_batch",
          drawerSections: expect.arrayContaining([
            expect.objectContaining({
              title: "Observation",
              body: "Observation without a matching action.",
            }),
          ]),
        }),
      ],
    });
  });

  it("pairs observations to actions by action_id even when tool_call_id differs", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-file-action",
        conversationId: "conv-action-id",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_000,
        display: { kind: "tool_call" },
        payload: {
          openHandsEvent: {
            kind: "ActionEvent",
            id: "action-1",
            timestamp: new Date(1_000).toISOString(),
            source: "agent",
            tool_name: "file_editor",
            tool_call_id: "call-action",
            action: { command: "view", path: "/tmp/README.md" },
          },
          rawOpenHandsEvent: {
            kind: "ActionEvent",
            id: "action-1",
          },
        },
      },
      {
        eventId: "evt-file-observation",
        conversationId: "conv-action-id",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_001,
        display: { kind: "tool_result" },
        payload: {
          openHandsEvent: {
            kind: "ObservationEvent",
            id: "obs-1",
            timestamp: new Date(1_001).toISOString(),
            source: "environment",
            tool_name: "file_editor",
            tool_call_id: "call-observation-mismatch",
            action_id: "action-1",
            observation: {
              command: "view",
              path: "/tmp/README.md",
              content: "Read 20 lines.",
            },
          },
          rawOpenHandsEvent: {
            kind: "ObservationEvent",
            id: "obs-1",
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
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Action",
                body: "command: view path: /tmp/README.md",
              }),
              expect.objectContaining({
                title: "Observation",
                body: "Read 20 lines.",
              }),
            ]),
          }),
        ],
      },
    ]);
  });

  it("keeps tool-call failures inside activity trace as action-plus-error outcomes", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-terminal-action",
        conversationId: "conv-tool-error",
        origin: "backend",
        status: "observed",
        createdAtMs: 2_000,
        display: { kind: "tool_call" },
        payload: {
          openHandsEvent: {
            kind: "ActionEvent",
            id: "action-err-1",
            timestamp: new Date(2_000).toISOString(),
            source: "agent",
            tool_name: "terminal",
            tool_call_id: "call-err-1",
            action: { command: "npm test" },
          },
          rawOpenHandsEvent: {
            kind: "ActionEvent",
            id: "action-err-1",
          },
        },
      },
      {
        eventId: "evt-terminal-error",
        conversationId: "conv-tool-error",
        origin: "backend",
        status: "failed",
        createdAtMs: 2_001,
        display: { kind: "error" },
        payload: {
          openHandsEvent: {
            kind: "AgentErrorEvent",
            id: "err-1",
            timestamp: new Date(2_001).toISOString(),
            source: "agent",
            tool_name: "terminal",
            tool_call_id: "call-err-1",
            error: "Command exited with code 1.",
          },
          rawOpenHandsEvent: {
            kind: "AgentErrorEvent",
            id: "err-1",
          },
        },
      },
    ]);

    expect(nodes).toMatchObject([
      {
        kind: "activity_trace",
        traceItems: [
          expect.objectContaining({
            kind: "terminal_activity",
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Action",
                body: "npm test",
              }),
              expect.objectContaining({
                title: "Error",
                body: "Command exited with code 1.",
              }),
            ]),
          }),
        ],
      },
    ]);
    expect(nodes.some((node) => node.kind === "tool_error")).toBe(false);
  });

  it("renders unknown-tool AgentErrorEvent inside activity trace as an error outcome", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-unknown-tool-error",
        conversationId: "conv-unknown-tool-error",
        origin: "backend",
        status: "failed",
        createdAtMs: 2_500,
        display: { kind: "error" },
        payload: {
          openHandsEvent: {
            kind: "AgentErrorEvent",
            id: "err-unknown-1",
            timestamp: new Date(2_500).toISOString(),
            source: "agent",
            tool_name: "mystery_tool",
            tool_call_id: "call-unknown-1",
            error: "Unexpected tool failure.",
          },
          rawOpenHandsEvent: {
            kind: "AgentErrorEvent",
            id: "err-unknown-1",
          },
        },
      },
    ]);

    expect(nodes).toMatchObject([
      {
        kind: "activity_trace",
        traceItems: [
          expect.objectContaining({
            kind: "tool_batch",
            title: "Tool calls",
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Error",
                body: "Unexpected tool failure.",
              }),
            ]),
          }),
        ],
      },
    ]);
    expect(nodes[0]?.kind).not.toBe("unknown_event");
  });

  it("groups parallel tool calls by llm_response_id and shows shared thought once", () => {
    const nodes = projectConversationEvents([
      {
        eventId: "evt-batch-action-1",
        conversationId: "conv-parallel-batch",
        origin: "backend",
        status: "observed",
        createdAtMs: 3_000,
        display: { kind: "tool_call" },
        payload: {
          openHandsEvent: {
            kind: "ActionEvent",
            id: "action-batch-1",
            timestamp: new Date(3_000).toISOString(),
            source: "agent",
            tool_name: "file_editor",
            tool_call_id: "call-batch-1",
            llm_response_id: "resp-batch-1",
            thought: "I should inspect the schema and test file in parallel before editing.",
            action: { command: "view", path: "/tmp/schema.md" },
          },
        },
      },
      {
        eventId: "evt-batch-action-2",
        conversationId: "conv-parallel-batch",
        origin: "backend",
        status: "observed",
        createdAtMs: 3_001,
        display: { kind: "tool_call" },
        payload: {
          openHandsEvent: {
            kind: "ActionEvent",
            id: "action-batch-2",
            timestamp: new Date(3_001).toISOString(),
            source: "agent",
            tool_name: "terminal",
            tool_call_id: "call-batch-2",
            llm_response_id: "resp-batch-1",
            action: { command: "npm test -- conversation" },
          },
        },
      },
      {
        eventId: "evt-batch-observation-1",
        conversationId: "conv-parallel-batch",
        origin: "backend",
        status: "observed",
        createdAtMs: 3_002,
        display: { kind: "tool_result" },
        payload: {
          openHandsEvent: {
            kind: "ObservationEvent",
            id: "obs-batch-1",
            timestamp: new Date(3_002).toISOString(),
            source: "environment",
            tool_name: "file_editor",
            tool_call_id: "call-batch-1",
            action_id: "action-batch-1",
            observation: { path: "/tmp/schema.md", content: "Read 40 lines." },
          },
        },
      },
      {
        eventId: "evt-batch-observation-2",
        conversationId: "conv-parallel-batch",
        origin: "backend",
        status: "observed",
        createdAtMs: 3_003,
        display: { kind: "tool_result" },
        payload: {
          openHandsEvent: {
            kind: "ObservationEvent",
            id: "obs-batch-2",
            timestamp: new Date(3_003).toISOString(),
            source: "environment",
            tool_name: "terminal",
            tool_call_id: "call-batch-2",
            action_id: "action-batch-2",
            observation: { command: "npm test -- conversation", content: "Tests passed." },
          },
        },
      },
    ]);

    expect(nodes).toMatchObject([
      {
        kind: "activity_trace",
        traceItems: expect.arrayContaining([
          expect.objectContaining({
            kind: "tool_batch",
            summary: "I should inspect the schema and test file in parallel before editing.",
            drawerSections: expect.arrayContaining([
              expect.objectContaining({
                title: "Item 1: Action",
                body: "command: view path: /tmp/schema.md",
              }),
              expect.objectContaining({ title: "Item 1: Observation", body: "Read 40 lines." }),
              expect.objectContaining({
                title: "Item 2: Action",
                body: "npm test -- conversation",
              }),
              expect.objectContaining({
                title: "Item 2: Observation",
                body: "Tests passed.",
              }),
            ]),
          }),
        ]),
      },
    ]);
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

  it("suppresses canonical conversation state update events for stats and finished markers", () => {
    const nodes = projectConversationEvents([
      makeEvent({
        eventId: "evt-wrapped-stats",
        conversationId: "conv-restored",
        createdAtMs: 1_000,
        origin: "backend",
        status: "observed",
        display: { kind: "system" },
        payload: {
          openHandsEvent: {
            kind: "ConversationStateUpdateEvent",
            id: "state-stats-1",
            timestamp: new Date(1_000).toISOString(),
            source: "environment",
            key: "stats",
            value: { usage_to_metrics: {} },
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
          openHandsEvent: {
            kind: "ConversationStateUpdateEvent",
            id: "state-finished-1",
            timestamp: new Date(1_001).toISOString(),
            source: "environment",
            key: "execution_status",
            value: "finished",
          },
        },
      }),
    ]);

    expect(nodes).toEqual([]);
  });
});
