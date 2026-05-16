import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversationEventRow } from "@/components/conversation/conversation-event-row";
import type { DisplayNode } from "@/lib/display-types";

function makeNode(
  overrides: Partial<DisplayNode> & {
    id: string;
    kind: DisplayNode["kind"];
  },
): DisplayNode {
  return {
    id: overrides.id,
    kind: overrides.kind,
    status: "observed",
    createdAtMs: 1_000,
    payload: {},
    ...overrides,
  };
}

describe("ConversationEventRow", () => {
  it("renders user messages as right-aligned bubbles and agent messages as left-aligned prose", () => {
    const { rerender } = render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-user",
          kind: "user_message",
          status: "accepted",
          payload: {
            frontendCommand: {
              type: "send_message",
              text: "User message",
            },
          },
        })}
      />,
    );

    const userRow = screen.getByTestId("conversation-event-row");
    expect(userRow.className).toMatch(/\bml-auto\b/);
    expect(userRow.className).toMatch(/\bborder-primary\/20\b/);

    rerender(
      <ConversationEventRow
        node={makeNode({
          id: "evt-agent",
          kind: "agent_message",
          payload: {
            rawOpenHandsEvent: {
              text: "Agent reply",
            },
          },
        })}
      />,
    );

    const agentRow = screen.getByTestId("conversation-event-row");
    expect(agentRow.className).toMatch(/\bmr-auto\b/);
    expect(agentRow.className).toMatch(/\bborder-border\b/);
  });
});
