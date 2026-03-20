import type { DisplayItem, ToolStatus } from "./display-types";

// ---------------------------------------------------------------------------
// Visual group types — view-only abstraction for DisplayItemList rendering
// ---------------------------------------------------------------------------

interface BareOutputGroup {
  type: "bare-output";
  key: string;
  item: DisplayItem;
}

interface ToolActivityGroup {
  type: "tool-activity";
  key: string;
  items: DisplayItem[];
}

interface PassthroughGroup {
  type: "passthrough";
  key: string;
  item: DisplayItem;
}

export type VisualGroup = BareOutputGroup | ToolActivityGroup | PassthroughGroup;

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/** Items that get collapsed into a tool activity group. */
function isGroupable(item: DisplayItem): boolean {
  return item.type === "tool_call" || item.type === "thinking";
}

/**
 * Groups a flat DisplayItem array into visual groups for rendering.
 *
 * - `output` items → bare markdown (no BaseItem wrapper)
 * - Consecutive `tool_call` and `thinking` items → single collapsible summary
 * - Everything else (result, error, subagent, compact_boundary) → passthrough
 *
 * Pure function, safe to call in useMemo.
 */
export function groupDisplayItems(items: DisplayItem[]): VisualGroup[] {
  const groups: VisualGroup[] = [];
  let pendingTools: DisplayItem[] = [];

  function flushTools() {
    if (pendingTools.length === 0) return;
    // Always emit tool-activity, even for a single item. This keeps the React
    // key stable during streaming — a sequence that starts with one tool and
    // grows to N must not change key (which would remount the component and
    // lose expand state).
    groups.push({
      type: "tool-activity",
      key: `tool-group-${pendingTools[0].id}`,
      items: [...pendingTools],
    });
    pendingTools = [];
  }

  for (const item of items) {
    if (isGroupable(item)) {
      pendingTools.push(item);
      continue;
    }

    flushTools();

    if (item.type === "output") {
      groups.push({ type: "bare-output", key: item.id, item });
    } else {
      groups.push({ type: "passthrough", key: item.id, item });
    }
  }

  // Trailing group (streaming — tools still arriving, no output yet)
  flushTools();

  return groups;
}

// ---------------------------------------------------------------------------
// Summary helpers for ToolActivityGroup rendering
// ---------------------------------------------------------------------------

export interface ToolActivitySummary {
  totalTools: number;
  breakdown: string;
  aggregateStatus: ToolStatus;
  totalDurationMs: number;
}

/**
 * Computes display summary for a tool activity group.
 * Only counts tool_call items (thinking items are included in the group
 * but not in the tool count).
 */
export function summarizeToolActivity(items: DisplayItem[]): ToolActivitySummary {
  const toolItems = items.filter((i) => i.type === "tool_call");
  const counts = new Map<string, number>();

  for (const item of toolItems) {
    const name = item.toolName ?? "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const parts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} ${name}`);

  const breakdown = parts.length > 0 ? parts.join(", ") : "thinking";

  // Aggregate status: any error → error, any pending → pending, else ok
  let aggregateStatus: ToolStatus = "ok";
  for (const item of toolItems) {
    if (item.toolStatus === "error") {
      aggregateStatus = "error";
      break;
    }
    if (item.toolStatus === "pending") {
      aggregateStatus = "pending";
    }
  }
  // If no tool_call items (all thinking), check if group is still building
  if (toolItems.length === 0) {
    aggregateStatus = "pending";
  }

  const totalDurationMs = toolItems.reduce(
    (sum, item) => sum + (item.toolDurationMs ?? 0),
    0,
  );

  return {
    totalTools: toolItems.length,
    breakdown,
    aggregateStatus,
    totalDurationMs,
  };
}
