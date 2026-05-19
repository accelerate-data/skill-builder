# Event Display Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat-bubble + slide-out drawer conversation UI with a compact activity-log style where every event is a collapsible tinted row and tool-call rows expand inline to show Thought → Action → Observation.

**Architecture:** Four new components are created under `app/src/components/event-display/` and the two integration points (`workflow.tsx`, `workspace-conversation.tsx`) are updated to import `EventDisplayTimeline` instead of `ConversationTimeline`. The existing projection layer (`conversation-display-semantics.ts`, `display-types.ts`, `conversation-event-projection.ts`) is untouched. Old conversation components and their tests are deleted after the new timeline is verified.

**Tech Stack:** React 19, TypeScript, Tailwind 4, vitest + React Testing Library, CSS custom properties (`var(--chat-*-bg/border)`)

---

## File Map

### Create

| File | Responsibility |
|---|---|
| `app/src/components/event-display/event-display-row.tsx` | Generic collapsible tinted row: bg, label, summary, tok badge, dur, status dot, chevron |
| `app/src/components/event-display/tao-panel.tsx` | Inline T/A/O panel with three colour-banded sections (thought, action, observation/error) |
| `app/src/components/event-display/event-display-list.tsx` | Renders `DisplayNode[]` with per-kind dispatch and turn dividers |
| `app/src/components/event-display/event-display-timeline.tsx` | Top-level: wires store → projection → list + `RunStatusFooter` |
| `app/src/__tests__/components/event-display/event-display-row.test.tsx` | Unit tests for row expand/collapse, status dot, badges |
| `app/src/__tests__/components/event-display/tao-panel.test.tsx` | Unit tests for section presence/absence |
| `app/src/__tests__/components/event-display/event-display-list.test.tsx` | Unit tests for kind dispatch, turn dividers, windowing |
| `app/src/__tests__/components/event-display/event-display-timeline.test.tsx` | Integration tests mirroring existing timeline tests |

### Delete (Task 6)

- `app/src/components/conversation/conversation-timeline.tsx`
- `app/src/components/conversation/conversation-event-row.tsx`
- `app/src/components/conversation/conversation-activity-group.tsx`
- `app/src/components/conversation/conversation-semantic-row.tsx`
- `app/src/__tests__/components/conversation/conversation-event-row.test.tsx`
- `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`

### Modify

- `app/src/pages/workflow.tsx` — swap import and JSX tag (line ~32 and ~391)
- `app/src/components/workspace/workspace-conversation.tsx` — swap import and JSX tag (line ~2 and ~38)
- `repo-map.json` — reflect new component directory and deleted files

---

## Task 1: EventDisplayRow

**Files:**

- Create: `app/src/components/event-display/event-display-row.tsx`
- Create: `app/src/__tests__/components/event-display/event-display-row.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
// app/src/__tests__/components/event-display/event-display-row.test.tsx
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EventDisplayRow } from "@/components/event-display/event-display-row";

const BG = "var(--chat-tool-bg)";
const LABEL_COLOR = "var(--chat-tool-border)";

describe("EventDisplayRow", () => {
  it("renders label and summary text", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="read_file">
        <div>content</div>
      </EventDisplayRow>,
    );
    expect(screen.getByText("Tool")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("does not render a chevron when no children are provided", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Message" summary="hello" />,
    );
    expect(screen.queryByTestId("row-chevron")).not.toBeInTheDocument();
  });

  it("renders a chevron when children are provided", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="run_cmd">
        <div>inner</div>
      </EventDisplayRow>,
    );
    expect(screen.getByTestId("row-chevron")).toBeInTheDocument();
  });

  it("starts expanded by default when children present and defaultExpanded not set to false", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="run_cmd">
        <div>inner content</div>
      </EventDisplayRow>,
    );
    expect(screen.getByText("inner content")).toBeInTheDocument();
  });

  it("starts collapsed when defaultExpanded is false", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Setup"
        summary="system prompt"
        defaultExpanded={false}
      >
        <div>inner content</div>
      </EventDisplayRow>,
    );
    expect(screen.queryByText("inner content")).not.toBeInTheDocument();
  });

  it("toggles expansion when the row is clicked", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="run_cmd">
        <div>inner content</div>
      </EventDisplayRow>,
    );
    expect(screen.getByText("inner content")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("row-header"));
    expect(screen.queryByText("inner content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("row-header"));
    expect(screen.getByText("inner content")).toBeInTheDocument();
  });

  it("shows token badge when tokenCount is provided", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Think"
        summary="reasoning"
        tokenCount={42}
      />,
    );
    expect(screen.getByText("42 tok")).toBeInTheDocument();
  });

  it("does not show token badge when tokenCount is absent", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Message" summary="hello" />,
    );
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });

  it("shows duration when durationMs is greater than 0", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Tool"
        summary="run_cmd"
        durationMs={2500}
      />,
    );
    expect(screen.getByTestId("row-duration")).toBeInTheDocument();
  });

  it("does not show duration when durationMs is 0 or absent", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Tool"
        summary="run_cmd"
        durationMs={0}
      />,
    );
    expect(screen.queryByTestId("row-duration")).not.toBeInTheDocument();
  });

  it("applies italic class to summary when italic prop is true", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Think"
        summary="the agent thought about it"
        italic
      />,
    );
    const summary = screen.getByTestId("row-summary");
    expect(summary.className).toMatch(/italic/);
  });

  it("shows done status dot when status is done", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Tool"
        summary="done"
        status="done"
      />,
    );
    expect(screen.getByTestId("status-dot")).toBeInTheDocument();
  });

  it("shows error status dot when status is error", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Error"
        summary="failed"
        status="error"
      />,
    );
    const dot = screen.getByTestId("status-dot");
    expect(dot.className).toMatch(/destructive/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/__tests__/components/event-display/event-display-row.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/event-display/event-display-row'"

- [ ] **Step 3: Create the component**

```tsx
// app/src/components/event-display/event-display-row.tsx
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EventDisplayRowProps {
  bg: string;
  labelColor: string;
  label: string;
  summary: string;
  italic?: boolean;
  tokenCount?: number;
  durationMs?: number;
  status?: "running" | "done" | "error";
  defaultExpanded?: boolean;
  children?: ReactNode;
}

export function EventDisplayRow({
  bg,
  labelColor,
  label,
  summary,
  italic,
  tokenCount,
  durationMs,
  status,
  defaultExpanded = true,
  children,
}: EventDisplayRowProps) {
  const expandable = children !== undefined;
  const [expanded, setExpanded] = useState(expandable ? defaultExpanded : false);

  return (
    <div className="rounded-md overflow-hidden text-xs">
      <div
        data-testid="row-header"
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 select-none",
          expandable && "cursor-pointer hover:brightness-95",
        )}
        style={{ background: bg }}
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        <span
          className="font-bold uppercase tracking-wide shrink-0"
          style={{ color: labelColor, fontSize: "11px" }}
        >
          {label}
        </span>

        <span
          data-testid="row-summary"
          className={cn(
            "min-w-0 flex-1 truncate text-muted-foreground",
            italic && "italic",
          )}
          style={{ fontSize: "11px" }}
        >
          {summary}
        </span>

        {tokenCount !== undefined && tokenCount > 0 && (
          <span
            className="shrink-0 font-mono text-muted-foreground"
            style={{ fontSize: "10px" }}
          >
            {tokenCount} tok
          </span>
        )}

        {durationMs !== undefined && durationMs > 0 && (
          <span
            data-testid="row-duration"
            className="shrink-0 font-mono text-muted-foreground"
            style={{ fontSize: "10px" }}
          >
            {formatDuration(durationMs)}
          </span>
        )}

        {status && (
          <span
            data-testid="status-dot"
            className={cn(
              "shrink-0 h-1.5 w-1.5 rounded-full",
              status === "done" && "bg-[var(--color-seafoam,theme(colors.emerald.400))]",
              status === "running" && "bg-[var(--color-pacific,theme(colors.sky.400))] animate-pulse",
              status === "error" && "bg-destructive",
            )}
          />
        )}

        {expandable && (
          <span
            data-testid="row-chevron"
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-150",
              expanded && "rotate-90",
            )}
            style={{ fontSize: "10px" }}
          >
            ›
          </span>
        )}
      </div>

      {expandable && expanded && (
        <div style={{ background: bg }} className="border-t border-black/5">
          {children}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && npx vitest run src/__tests__/components/event-display/event-display-row.test.tsx
```

Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add app/src/components/event-display/event-display-row.tsx \
        app/src/__tests__/components/event-display/event-display-row.test.tsx
git commit -m "feat: add EventDisplayRow base collapsible row component"
```

---

## Task 2: TaoPanel

**Files:**

- Create: `app/src/components/event-display/tao-panel.tsx`
- Create: `app/src/__tests__/components/event-display/tao-panel.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
// app/src/__tests__/components/event-display/tao-panel.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaoPanel } from "@/components/event-display/tao-panel";

describe("TaoPanel", () => {
  it("renders thought section when thought is provided", () => {
    render(<TaoPanel thought="I should read the file first" />);
    expect(screen.getByText("THOUGHT")).toBeInTheDocument();
    expect(screen.getByText("I should read the file first")).toBeInTheDocument();
  });

  it("omits thought section when thought is absent", () => {
    render(<TaoPanel action="cat README.md" />);
    expect(screen.queryByText("THOUGHT")).not.toBeInTheDocument();
  });

  it("renders action section when action is provided", () => {
    render(<TaoPanel action="cat README.md" />);
    expect(screen.getByText("ACTION")).toBeInTheDocument();
    expect(screen.getByText("cat README.md")).toBeInTheDocument();
  });

  it("omits action section when action is absent", () => {
    render(<TaoPanel thought="thinking" />);
    expect(screen.queryByText("ACTION")).not.toBeInTheDocument();
  });

  it("renders observation section when observation is provided", () => {
    render(<TaoPanel action="cat README.md" observation="# README content" />);
    expect(screen.getByText("OBSERVATION")).toBeInTheDocument();
    expect(screen.getByText("# README content")).toBeInTheDocument();
  });

  it("omits observation section when observation is absent", () => {
    render(<TaoPanel action="cat README.md" />);
    expect(screen.queryByText("OBSERVATION")).not.toBeInTheDocument();
  });

  it("renders error section when error is provided", () => {
    render(<TaoPanel action="cat missing.txt" error="File not found" />);
    expect(screen.getByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("File not found")).toBeInTheDocument();
  });

  it("omits error section when error is absent", () => {
    render(<TaoPanel action="cat README.md" observation="content" />);
    expect(screen.queryByText("ERROR")).not.toBeInTheDocument();
  });

  it("renders all three sections when all are provided", () => {
    render(
      <TaoPanel
        thought="Reasoning text"
        action="cat README.md"
        observation="file content"
      />,
    );
    expect(screen.getByText("THOUGHT")).toBeInTheDocument();
    expect(screen.getByText("ACTION")).toBeInTheDocument();
    expect(screen.getByText("OBSERVATION")).toBeInTheDocument();
  });

  it("renders nothing when no props are provided", () => {
    const { container } = render(<TaoPanel />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/__tests__/components/event-display/tao-panel.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/event-display/tao-panel'"

- [ ] **Step 3: Create the component**

```tsx
// app/src/components/event-display/tao-panel.tsx
interface TaoPanelProps {
  thought?: string;
  action?: string;
  observation?: string;
  error?: string;
}

const SECTION_LABEL_WIDTH = "72px";

export function TaoPanel({ thought, action, observation, error }: TaoPanelProps) {
  const hasAny = thought || action || observation || error;
  if (!hasAny) return null;

  return (
    <div className="text-xs">
      {thought && (
        <TaoSection
          title="THOUGHT"
          bg="var(--chat-thinking-bg)"
          labelColor="var(--chat-thinking-border)"
        >
          <p className="text-muted-foreground whitespace-pre-wrap">{thought}</p>
        </TaoSection>
      )}
      {action && (
        <TaoSection
          title="ACTION"
          bg="var(--chat-tool-bg)"
          labelColor="var(--chat-tool-border)"
        >
          <pre className="font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">
            {action}
          </pre>
        </TaoSection>
      )}
      {observation && (
        <TaoSection
          title="OBSERVATION"
          bg="var(--chat-result-bg)"
          labelColor="var(--chat-result-border)"
        >
          <p className="text-muted-foreground whitespace-pre-wrap">{observation}</p>
        </TaoSection>
      )}
      {error && (
        <TaoSection
          title="ERROR"
          bg="var(--chat-error-bg)"
          labelColor="var(--chat-error-border)"
        >
          <p className="text-muted-foreground whitespace-pre-wrap">{error}</p>
        </TaoSection>
      )}
    </div>
  );
}

function TaoSection({
  title,
  bg,
  labelColor,
  children,
}: {
  title: string;
  bg: string;
  labelColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 px-3 py-2 border-t border-black/5" style={{ background: bg }}>
      <span
        className="shrink-0 font-bold uppercase tracking-wide pt-px"
        style={{ width: SECTION_LABEL_WIDTH, color: labelColor, fontSize: "10px" }}
      >
        {title}
      </span>
      <div className="min-w-0 flex-1" style={{ fontSize: "11px" }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && npx vitest run src/__tests__/components/event-display/tao-panel.test.tsx
```

Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add app/src/components/event-display/tao-panel.tsx \
        app/src/__tests__/components/event-display/tao-panel.test.tsx
git commit -m "feat: add TaoPanel inline thought/action/observation expansion panel"
```

---

## Task 3: EventDisplayList

**Files:**

- Create: `app/src/components/event-display/event-display-list.tsx`
- Create: `app/src/__tests__/components/event-display/event-display-list.test.tsx`

**Background:** `DisplayNode` comes from `@/lib/display-types`. The tool-type kinds are `activity_trace | tool_batch | file_activity | terminal_activity`. A turn divider is inserted whenever a `task_sent` node follows an `agent_update` node.

- [ ] **Step 1: Create the test file**

```tsx
// app/src/__tests__/components/event-display/event-display-list.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventDisplayList } from "@/components/event-display/event-display-list";
import type { DisplayNode } from "@/lib/display-types";

function makeNode(
  overrides: Partial<DisplayNode> & { id: string; kind: DisplayNode["kind"] },
): DisplayNode {
  return {
    id: overrides.id,
    kind: overrides.kind,
    status: "observed",
    createdAtMs: 1_000,
    sourceEventIds: [overrides.id],
    ...overrides,
  };
}

describe("EventDisplayList", () => {
  it("renders a task_sent node with Message label", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "Write a plan" }),
        ]}
      />,
    );
    expect(screen.getByText("Message")).toBeInTheDocument();
    expect(screen.getByText("Write a plan")).toBeInTheDocument();
  });

  it("renders an agent_update node with Output label", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "agent_update", bodyText: "Here is the plan." }),
        ]}
      />,
    );
    expect(screen.getByText("Output")).toBeInTheDocument();
  });

  it("renders a reasoning node with Think label and italic summary", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "reasoning", reasoningText: "Step by step..." }),
        ]}
      />,
    );
    expect(screen.getByText("Think")).toBeInTheDocument();
    const summary = screen.getByTestId("row-summary");
    expect(summary.className).toMatch(/italic/);
  });

  it("renders a tool_batch node with '1 tool' label for a single member", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_batch",
            members: [
              {
                id: "m1",
                title: "read_file",
                toolName: "read_file",
                sourceEventIds: ["n1"],
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("1 tool")).toBeInTheDocument();
  });

  it("renders a tool_batch node with 'N tools' label for multiple members", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_batch",
            members: [
              { id: "m1", title: "read_file", toolName: "read_file", sourceEventIds: ["n1"] },
              { id: "m2", title: "write_file", toolName: "write_file", sourceEventIds: ["n1"] },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("2 tools")).toBeInTheDocument();
  });

  it("renders tool names joined by · as summary", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_batch",
            members: [
              { id: "m1", title: "read_file", toolName: "read_file", sourceEventIds: ["n1"] },
              { id: "m2", title: "write_file", toolName: "write_file", sourceEventIds: ["n1"] },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("read_file · write_file")).toBeInTheDocument();
  });

  it("inserts a turn divider when task_sent follows agent_update", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First message" }),
          makeNode({ id: "n2", kind: "agent_update", bodyText: "First reply" }),
          makeNode({ id: "n3", kind: "task_sent", bodyText: "Second message" }),
        ]}
      />,
    );
    expect(screen.getByTestId("turn-divider")).toBeInTheDocument();
  });

  it("does not insert a turn divider before the first task_sent", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First message" }),
        ]}
      />,
    );
    expect(screen.queryByTestId("turn-divider")).not.toBeInTheDocument();
  });

  it("does not insert a turn divider when task_sent follows task_sent", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First" }),
          makeNode({ id: "n2", kind: "task_sent", bodyText: "Second" }),
        ]}
      />,
    );
    expect(screen.queryByTestId("turn-divider")).not.toBeInTheDocument();
  });

  it("shows 'N older events hidden' when more than 100 nodes are provided", () => {
    const nodes = Array.from({ length: 105 }, (_, i) =>
      makeNode({ id: `n${i}`, kind: "task_sent", bodyText: `msg ${i}` }),
    );
    render(<EventDisplayList nodes={nodes} />);
    expect(screen.getByText("5 older events hidden")).toBeInTheDocument();
  });

  it("renders a runtime_setup node with 'Runtime setup' label", () => {
    render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "runtime_setup", bodyText: "System prompt" })]}
      />,
    );
    expect(screen.getByText("Runtime setup")).toBeInTheDocument();
  });

  it("renders a lifecycle node with 'Condensation' label", () => {
    render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "lifecycle", bodyText: "Summary" })]}
      />,
    );
    expect(screen.getByText("Condensation")).toBeInTheDocument();
  });

  it("renders an error node with 'Error' label", () => {
    render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "error", bodyText: "Something failed" })]}
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders an unknown_event node with 'Unknown' label", () => {
    render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "unknown_event" })]}
      />,
    );
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/__tests__/components/event-display/event-display-list.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/event-display/event-display-list'"

- [ ] **Step 3: Create the component**

```tsx
// app/src/components/event-display/event-display-list.tsx
import { useMemo } from "react";
import type { DisplayNode, DisplayNodeMember } from "@/lib/display-types";
import { EventDisplayRow } from "./event-display-row";
import { TaoPanel } from "./tao-panel";
import { MemoizedMarkdown } from "@/components/agent-items/memoized-markdown";

const WINDOW_SIZE = 100;
const TOOL_KINDS = new Set<DisplayNode["kind"]>([
  "activity_trace",
  "tool_batch",
  "file_activity",
  "terminal_activity",
]);

interface EventDisplayListProps {
  nodes: DisplayNode[];
}

export function EventDisplayList({ nodes }: EventDisplayListProps) {
  const hidden = Math.max(0, nodes.length - WINDOW_SIZE);
  const visible = nodes.slice(-WINDOW_SIZE);

  const items = useMemo(() => buildItems(visible), [visible]);

  return (
    <div className="flex flex-col gap-1.5">
      {hidden > 0 && (
        <p className="text-center text-xs text-muted-foreground py-1">
          {hidden} older events hidden
        </p>
      )}
      {items.map(({ node, showDivider, turnNumber }) => (
        <div key={node.id} className="animate-message-in">
          {showDivider && <TurnDivider n={turnNumber} />}
          <NodeRow node={node} />
        </div>
      ))}
    </div>
  );
}

interface ListItem {
  node: DisplayNode;
  showDivider: boolean;
  turnNumber: number;
}

function buildItems(nodes: DisplayNode[]): ListItem[] {
  let turnNumber = 1;
  let lastKind: DisplayNode["kind"] | null = null;
  return nodes.map((node) => {
    const showDivider = node.kind === "task_sent" && lastKind === "agent_update";
    if (showDivider) turnNumber += 1;
    const item: ListItem = { node, showDivider, turnNumber };
    lastKind = node.kind;
    return item;
  });
}

function NodeRow({ node }: { node: DisplayNode }) {
  if (TOOL_KINDS.has(node.kind)) return <ToolRow node={node} />;

  switch (node.kind) {
    case "task_sent":
      return (
        <EventDisplayRow
          bg="var(--chat-question-bg)"
          labelColor="var(--chat-question-border)"
          label="Message"
          summary={node.bodyText ?? ""}
        />
      );

    case "agent_update":
      return (
        <EventDisplayRow
          bg="var(--chat-subagent-bg)"
          labelColor="var(--chat-subagent-border)"
          label="Output"
          summary={truncate(node.bodyText ?? "", 120)}
          status={statusDot(node)}
        >
          <div className="px-3 py-2 prose prose-sm max-w-none">
            <MemoizedMarkdown content={node.bodyText ?? ""} />
          </div>
        </EventDisplayRow>
      );

    case "reasoning":
      return (
        <EventDisplayRow
          bg="var(--chat-thinking-bg)"
          labelColor="var(--chat-thinking-border)"
          label="Think"
          summary={node.reasoningText ?? node.thoughtText ?? node.bodyText ?? ""}
          italic
          tokenCount={undefined}
          defaultExpanded={false}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {node.reasoningText && <p>{node.reasoningText}</p>}
            {node.thoughtText && node.thoughtText !== node.reasoningText && (
              <p className="mt-2">{node.thoughtText}</p>
            )}
          </div>
        </EventDisplayRow>
      );

    case "runtime_setup":
      return (
        <EventDisplayRow
          bg="var(--muted)"
          labelColor="var(--muted-foreground)"
          label="Runtime setup"
          summary={node.label ?? "System prompt"}
          defaultExpanded={false}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {node.bodyText}
          </div>
        </EventDisplayRow>
      );

    case "lifecycle":
      return (
        <EventDisplayRow
          bg="var(--muted)"
          labelColor="var(--muted-foreground)"
          label="Condensation"
          summary={node.label ?? "Condensation summary"}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {node.bodyText}
          </div>
        </EventDisplayRow>
      );

    case "error":
    case "subagent_error": {
      const errorLabel = node.kind === "error" ? "Error" : "Subagent error";
      return (
        <EventDisplayRow
          bg="var(--chat-error-bg)"
          labelColor="var(--chat-error-border)"
          label={errorLabel}
          summary={node.bodyText ?? node.label ?? "Error"}
          status="error"
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {node.bodyText}
          </div>
        </EventDisplayRow>
      );
    }

    case "tool_error":
      return (
        <EventDisplayRow
          bg="var(--chat-error-bg)"
          labelColor="var(--chat-error-border)"
          label="Tool error"
          summary={node.bodyText ?? node.label ?? "Tool error"}
          status="error"
        >
          <TaoPanel
            thought={node.thoughtText ?? node.reasoningText}
            action={node.actionText}
            error={node.bodyText}
          />
        </EventDisplayRow>
      );

    default:
      return (
        <EventDisplayRow
          bg="var(--muted)"
          labelColor="var(--muted-foreground)"
          label="Unknown"
          summary={node.label ?? node.kind}
        >
          <pre className="px-3 py-2 text-xs text-muted-foreground overflow-x-auto">
            {JSON.stringify(node.rawPayload ?? { kind: node.kind }, null, 2)}
          </pre>
        </EventDisplayRow>
      );
  }
}

function ToolRow({ node }: { node: DisplayNode }) {
  const members = node.members ?? [];
  const toolCount = members.length || 1;
  const label = toolCount === 1 ? "1 tool" : `${toolCount} tools`;

  const summary =
    node.thoughtText ??
    (members.length > 0
      ? members.map((m) => m.toolName ?? m.title).join(" · ")
      : node.actionText ?? "");

  const thought = node.thoughtText ?? node.reasoningText ?? members[0]?.thoughtText;
  const action = buildActionText(node, members);
  const observation = node.observationText ?? buildObservationText(members);
  const error = buildErrorText(members);

  return (
    <EventDisplayRow
      bg="var(--chat-tool-bg)"
      labelColor="var(--chat-tool-border)"
      label={label}
      summary={summary ?? ""}
      status={statusDot(node)}
    >
      <TaoPanel
        thought={thought}
        action={action}
        observation={error ? undefined : observation}
        error={error}
      />
    </EventDisplayRow>
  );
}

function buildActionText(node: DisplayNode, members: DisplayNodeMember[]): string | undefined {
  if (members.length === 0) return node.actionText;
  return members.map((m) => m.actionText ?? m.title).join("\n");
}

function buildObservationText(members: DisplayNodeMember[]): string | undefined {
  const parts = members.map((m) => m.observationText).filter(Boolean);
  return parts.length > 0 ? parts.join("\n---\n") : undefined;
}

function buildErrorText(members: DisplayNodeMember[]): string | undefined {
  const parts = members.map((m) => m.errorText).filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function statusDot(node: DisplayNode): "running" | "done" | "error" | undefined {
  if (node.status === "failed") return "error";
  if (node.status === "observed") return "done";
  if (node.status === "accepted" || node.status === "sending") return "running";
  return undefined;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function TurnDivider({ n }: { n: number }) {
  return (
    <div
      data-testid="turn-divider"
      className="flex items-center gap-2 my-1 opacity-45"
    >
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        Turn {n}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && npx vitest run src/__tests__/components/event-display/event-display-list.test.tsx
```

Expected: PASS — all tests green

- [ ] **Step 5: Run the full unit test suite**

```bash
cd app && npm run test:unit
```

Expected: PASS — no regressions

- [ ] **Step 6: Commit**

```bash
git add app/src/components/event-display/event-display-list.tsx \
        app/src/__tests__/components/event-display/event-display-list.test.tsx
git commit -m "feat: add EventDisplayList with turn dividers and per-kind dispatch"
```

---

## Task 4: EventDisplayTimeline

**Files:**

- Create: `app/src/components/event-display/event-display-timeline.tsx`
- Create: `app/src/__tests__/components/event-display/event-display-timeline.test.tsx`

**Background:** This is a drop-in replacement for `ConversationTimeline`. It takes the same `{ conversationId: string }` prop, wires `useConversationEvents` → `projectConversationEvents` → `EventDisplayList` + `RunStatusFooter`. The `deriveConversationFooterState` function is copied from `conversation-timeline.tsx`.

- [ ] **Step 1: Create the test file**

The tests mirror `conversation-timeline.test.tsx` exactly, just importing the new component.

```tsx
// app/src/__tests__/components/event-display/event-display-timeline.test.tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EventDisplayTimeline } from "@/components/event-display/event-display-timeline";
import { useConversationStore } from "@/stores/conversation-store";
import type { ConversationEventEnvelope } from "@/lib/conversation-event-types";

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
    display: { kind: "user_message", label: "You" },
    payload: {
      frontendCommand: { type: "send_message", text: "hello" },
    },
    ...overrides,
  };
}

describe("EventDisplayTimeline", () => {
  beforeEach(() => {
    useConversationStore.setState({ eventsByConversation: {} });
  });

  it("renders canonical events for the selected session conversation only", () => {
    useConversationStore.getState().replaceConversationHistory("conv-session-1", [
      makeEvent({
        eventId: "evt-user",
        conversationId: "conv-session-1",
        createdAtMs: 1_000,
        display: { kind: "user_message", label: "You" },
        payload: {
          frontendCommand: { type: "send_message", text: "Draft the rollout plan" },
        },
      }),
      makeEvent({
        eventId: "evt-state-running",
        conversationId: "conv-session-1",
        createdAtMs: 1_500,
        origin: "backend",
        status: "observed",
        display: { kind: "state", label: "State" },
        payload: {
          openHandsEvent: {
            kind: "ConversationStateUpdateEvent",
            id: "state-running",
            timestamp: new Date(1_500).toISOString(),
            source: "environment",
            key: "execution_status",
            value: "running",
          },
        },
      }),
      makeEvent({
        eventId: "evt-agent",
        conversationId: "conv-session-1",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "agent_message", label: "OpenHands" },
        payload: {
          openHandsEvent: {
            kind: "MessageEvent",
            id: "agent-message",
            timestamp: new Date(2_000).toISOString(),
            source: "agent",
            llm_message: {
              role: "assistant",
              content: [{ type: "text", text: "Plan drafted and ready for review." }],
            },
          },
        },
      }),
      makeEvent({
        eventId: "evt-error",
        conversationId: "conv-session-1",
        createdAtMs: 3_000,
        origin: "backend",
        status: "failed",
        display: { kind: "error", label: "Transport" },
        payload: {
          openHandsEvent: {
            kind: "ConversationErrorEvent",
            id: "conversation-error",
            timestamp: new Date(3_000).toISOString(),
            source: "environment",
            code: "dispatch_failed",
            detail: "Session dispatch failed",
          },
        },
      }),
    ]);
    useConversationStore.getState().replaceConversationHistory("conv-session-2", [
      makeEvent({
        eventId: "evt-other",
        conversationId: "conv-session-2",
        createdAtMs: 500,
        payload: {
          frontendCommand: { type: "send_message", text: "This should stay hidden" },
        },
      }),
    ]);

    render(<EventDisplayTimeline conversationId="conv-session-1" />);

    expect(screen.getByText("Draft the rollout plan")).toBeInTheDocument();
    expect(screen.getByText("Plan drafted and ready for review.")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-status-footer")).toHaveTextContent("error");
    expect(screen.queryByText("This should stay hidden")).not.toBeInTheDocument();
  });

  it("shows an empty state when the selected session has no canonical events yet", () => {
    render(<EventDisplayTimeline conversationId="conv-empty" />);
    const emptyState = screen.getByTestId("conversation-timeline-empty");
    expect(within(emptyState).getByText("No conversation activity yet")).toBeInTheDocument();
  });

  it("shows paused state in the bottom footer when a pause event is the latest runtime signal", () => {
    useConversationStore.getState().replaceConversationHistory("conv-paused", [
      makeEvent({
        eventId: "evt-user",
        conversationId: "conv-paused",
        createdAtMs: 1_000,
        payload: {
          frontendCommand: { type: "send_message", text: "Wait for review" },
        },
      }),
      makeEvent({
        eventId: "evt-pause",
        conversationId: "conv-paused",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "state", label: "State" },
        payload: {
          openHandsEvent: {
            kind: "PauseEvent",
            id: "pause-1",
            timestamp: new Date(2_000).toISOString(),
            source: "environment",
            reason: "Waiting for review.",
          },
        },
      }),
    ]);

    render(<EventDisplayTimeline conversationId="conv-paused" />);

    expect(screen.getByTestId("conversation-status-footer")).toHaveTextContent("paused");
    expect(screen.getByTestId("conversation-status-footer")).toHaveTextContent(
      "Waiting for review.",
    );
  });

  it("shows completed state from canonical execution_status updates", () => {
    useConversationStore.getState().replaceConversationHistory("conv-completed", [
      makeEvent({
        eventId: "evt-user",
        conversationId: "conv-completed",
        createdAtMs: 1_000,
        payload: {
          frontendCommand: { type: "send_message", text: "Finish the run" },
        },
      }),
      makeEvent({
        eventId: "evt-completed",
        conversationId: "conv-completed",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "state", label: "State" },
        payload: {
          openHandsEvent: {
            kind: "ConversationStateUpdateEvent",
            id: "state-completed",
            timestamp: new Date(2_000).toISOString(),
            source: "environment",
            key: "execution_status",
            value: "completed",
          },
        },
      }),
    ]);

    render(<EventDisplayTimeline conversationId="conv-completed" />);

    expect(screen.getByTestId("conversation-status-footer")).toHaveTextContent("completed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/__tests__/components/event-display/event-display-timeline.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/event-display/event-display-timeline'"

- [ ] **Step 3: Create the component**

```tsx
// app/src/components/event-display/event-display-timeline.tsx
import { useMemo } from "react";
import { useConversationEvents } from "@/hooks/use-conversation-stream";
import { projectConversationEvents } from "@/lib/conversation-event-projection";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";
import { EventDisplayList } from "./event-display-list";

interface EventDisplayTimelineProps {
  conversationId: string;
}

export function EventDisplayTimeline({ conversationId }: EventDisplayTimelineProps) {
  const events = useConversationEvents(conversationId);
  const nodes = useMemo(() => projectConversationEvents(events), [events]);
  const footerState = useMemo(() => deriveConversationFooterState(events), [events]);

  if (nodes.length === 0) {
    return (
      <Card className="flex min-h-0 flex-1">
        <CardContent
          data-testid="conversation-timeline-empty"
          className="flex h-full items-center justify-center text-sm text-muted-foreground"
        >
          No conversation activity yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-0 flex-1 overflow-hidden py-2 gap-0">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-2">
          <EventDisplayList nodes={nodes} />
        </div>
      </ScrollArea>
      <RunStatusFooter
        status={footerState.status}
        label={footerState.label}
        errorText={footerState.errorText}
        testId="conversation-status-footer"
      />
    </Card>
  );
}

function deriveConversationFooterState(events: ReturnType<typeof useConversationEvents>): {
  status: FooterDisplayStatus;
  label?: string | null;
  errorText?: string | null;
} {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const openHandsEvent = event.payload.openHandsEvent;
    if (!openHandsEvent) continue;

    if (openHandsEvent.kind === "PauseEvent") {
      return { status: "paused", label: openHandsEvent.reason ?? "conversation" };
    }

    if (openHandsEvent.kind === "ConversationStateUpdateEvent") {
      if (openHandsEvent.key !== "execution_status") continue;
      const value =
        typeof openHandsEvent.value === "string" ? openHandsEvent.value : undefined;
      switch (value) {
        case "running":
          return { status: "running", label: "conversation" };
        case "paused":
          return { status: "paused", label: "conversation" };
        case "finished":
        case "completed":
          return { status: "completed", label: "conversation" };
        case "error":
          return { status: "error", label: "conversation" };
        case "idle":
          return { status: "idle", label: "conversation" };
      }
    }

    if (openHandsEvent.kind === "FinishEvent") {
      return { status: "completed", label: "conversation" };
    }

    if (openHandsEvent.kind === "ConversationErrorEvent") {
      return {
        status: "error",
        label: "conversation",
        errorText: openHandsEvent.detail,
      };
    }
  }

  return { status: "idle", label: "conversation" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && npx vitest run src/__tests__/components/event-display/event-display-timeline.test.tsx
```

Expected: PASS — all tests green

- [ ] **Step 5: Run TypeScript check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run the full unit test suite**

```bash
cd app && npm run test:unit
```

Expected: PASS — no regressions

- [ ] **Step 7: Commit**

```bash
git add app/src/components/event-display/event-display-timeline.tsx \
        app/src/__tests__/components/event-display/event-display-timeline.test.tsx
git commit -m "feat: add EventDisplayTimeline drop-in replacement for ConversationTimeline"
```

---

## Task 5: Integration

Swap the two import sites to use `EventDisplayTimeline`.

**Files:**

- Modify: `app/src/pages/workflow.tsx` (line ~32 import, line ~391 JSX)
- Modify: `app/src/components/workspace/workspace-conversation.tsx` (line ~2 import, line ~38 JSX)

- [ ] **Step 1: Update workflow.tsx**

Find and replace in `app/src/pages/workflow.tsx`:

```tsx
// Remove:
import { ConversationTimeline } from "@/components/conversation/conversation-timeline";

// Add:
import { EventDisplayTimeline } from "@/components/event-display/event-display-timeline";
```

And replace the JSX usage (the line that reads `return <ConversationTimeline conversationId={conversationId} />;`):

```tsx
return <EventDisplayTimeline conversationId={conversationId} />;
```

- [ ] **Step 2: Update workspace-conversation.tsx**

Find and replace in `app/src/components/workspace/workspace-conversation.tsx`:

```tsx
// Remove:
import { ConversationTimeline } from "@/components/conversation/conversation-timeline";

// Add:
import { EventDisplayTimeline } from "@/components/event-display/event-display-timeline";
```

And replace the JSX usage (the line that reads `<ConversationTimeline conversationId={conversationId} />`):

```tsx
<EventDisplayTimeline conversationId={conversationId} />
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run the full unit test suite**

```bash
cd app && npm run test:unit
```

Expected: PASS — existing `workspace-conversation.test.tsx` still passes

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/workflow.tsx \
        app/src/components/workspace/workspace-conversation.tsx
git commit -m "feat: swap ConversationTimeline → EventDisplayTimeline in all integration points"
```

---

## Task 6: Cleanup

Delete old components, old tests, and update `repo-map.json`.

**Files:**

- Delete: `app/src/components/conversation/conversation-timeline.tsx`
- Delete: `app/src/components/conversation/conversation-event-row.tsx`
- Delete: `app/src/components/conversation/conversation-activity-group.tsx`
- Delete: `app/src/components/conversation/conversation-semantic-row.tsx`
- Delete: `app/src/__tests__/components/conversation/conversation-event-row.test.tsx`
- Delete: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`
- Modify: `repo-map.json`

- [ ] **Step 1: Delete the old component files**

```bash
rm app/src/components/conversation/conversation-timeline.tsx \
   app/src/components/conversation/conversation-event-row.tsx \
   app/src/components/conversation/conversation-activity-group.tsx \
   app/src/components/conversation/conversation-semantic-row.tsx
```

- [ ] **Step 2: Delete the old test files**

```bash
rm app/src/__tests__/components/conversation/conversation-event-row.test.tsx \
   app/src/__tests__/components/conversation/conversation-timeline.test.tsx
```

- [ ] **Step 3: Verify no remaining imports**

```bash
grep -r "conversation-timeline\|conversation-event-row\|conversation-activity-group\|conversation-semantic-row" app/src --include="*.tsx" --include="*.ts"
```

Expected: no output (zero matches)

- [ ] **Step 4: Update repo-map.json**

Open `repo-map.json` and apply these changes to the `frontend_components` section:

Remove entries for:

- `app/src/components/conversation/conversation-timeline.tsx`
- `app/src/components/conversation/conversation-event-row.tsx`
- `app/src/components/conversation/conversation-activity-group.tsx`
- `app/src/components/conversation/conversation-semantic-row.tsx`

Add entries for:

- `app/src/components/event-display/event-display-timeline.tsx` — top-level conversation timeline: wires event store → projection → list + footer
- `app/src/components/event-display/event-display-list.tsx` — renders DisplayNode[] with turn dividers and per-kind row dispatch
- `app/src/components/event-display/event-display-row.tsx` — generic collapsible tinted activity-log row
- `app/src/components/event-display/tao-panel.tsx` — inline Thought/Action/Observation expansion panel

- [ ] **Step 5: Run TypeScript check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run the full unit test suite**

```bash
cd app && npm run test:unit
```

Expected: PASS — all tests green, no references to deleted files

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove old ConversationTimeline components and tests, update repo-map"
```

---

## Validation Checklist

After Task 6 is complete, verify:

- [ ] `cd app && npm run test:unit` — green
- [ ] `cd app && npx tsc --noEmit` — no errors
- [ ] `grep -r "ConversationTimeline\|ConversationEventRow\|ConversationActivityGroup\|ConversationSemanticRow" app/src --include="*.tsx" --include="*.ts"` — no matches
- [ ] Open the app in dev mode (`cd app && npm run dev`), open a workflow with an active conversation, and verify the timeline renders tinted rows instead of chat bubbles
