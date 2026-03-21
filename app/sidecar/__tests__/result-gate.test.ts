import { describe, it, expect, vi } from "vitest";
import { ResultGate } from "../result-gate.js";

function makeProcessor(subagents = 0, bgTasks = 0) {
  return {
    activeSubagentCount: subagents,
    pendingBackgroundTaskCount: bgTasks,
  } as never;
}

function runResult(): Record<string, unknown> {
  return { type: "agent_event", event: { type: "run_result", status: "completed" } };
}

function displayItem(): Record<string, unknown> {
  return { type: "display_item", item: { type: "output", id: "di-1" } };
}

function turnUsage(): Record<string, unknown> {
  return { type: "agent_event", event: { type: "turn_usage", turn: 1 } };
}

describe("ResultGate", () => {
  it("emits non-run_result items immediately regardless of active agents", () => {
    const processor = makeProcessor(2, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.emit(displayItem(), onMessage);
    gate.emit(turnUsage(), onMessage);
    expect(emitted).toHaveLength(2);
  });

  it("emits run_result immediately when no agents are active", () => {
    const processor = makeProcessor(0, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.emit(runResult(), onMessage);
    expect(emitted).toHaveLength(1);
    expect(gate.deferredCount).toBe(0);
  });

  it("defers run_result when subagents are active", () => {
    const processor = makeProcessor(2, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.emit(runResult(), onMessage);
    expect(emitted).toHaveLength(0);
    expect(gate.deferredCount).toBe(1);
  });

  it("defers run_result when background tasks are active", () => {
    const processor = makeProcessor(0, 1);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.emit(runResult(), onMessage);
    expect(emitted).toHaveLength(0);
    expect(gate.deferredCount).toBe(1);
  });

  it("tryFlush emits deferred items when agents complete", () => {
    const processor = makeProcessor(1, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.emit(runResult(), onMessage);
    expect(emitted).toHaveLength(0);

    // Simulate subagent completing
    (processor as { activeSubagentCount: number }).activeSubagentCount = 0;
    gate.tryFlush(onMessage);

    expect(emitted).toHaveLength(1);
    expect(gate.deferredCount).toBe(0);
  });

  it("tryFlush does not emit when agents are still active", () => {
    const processor = makeProcessor(2, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.emit(runResult(), onMessage);
    gate.tryFlush(onMessage);
    expect(emitted).toHaveLength(0);
  });

  it("flush force-emits deferred items even when agents are active", () => {
    const processor = makeProcessor(3, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.emit(runResult(), onMessage);
    gate.flush(onMessage);
    expect(emitted).toHaveLength(1);
    expect(gate.deferredCount).toBe(0);
  });

  it("flush is a no-op when nothing is deferred", () => {
    const processor = makeProcessor(0, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    gate.flush(onMessage);
    expect(emitted).toHaveLength(0);
  });

  it("full lifecycle: defer → subagent completes → tryFlush emits", () => {
    const processor = makeProcessor(2, 0);
    const gate = new ResultGate(processor);
    const emitted: Record<string, unknown>[] = [];
    const onMessage = (msg: Record<string, unknown>) => emitted.push(msg);

    // Emit display items + run_result with 2 subagents active
    gate.emit(displayItem(), onMessage);
    gate.emit(runResult(), onMessage);
    gate.emit(displayItem(), onMessage);
    expect(emitted).toHaveLength(2); // 2 display items, run_result deferred

    // First subagent completes
    (processor as { activeSubagentCount: number }).activeSubagentCount = 1;
    gate.tryFlush(onMessage);
    expect(emitted).toHaveLength(2); // Still deferred

    // Second subagent completes
    (processor as { activeSubagentCount: number }).activeSubagentCount = 0;
    gate.tryFlush(onMessage);
    expect(emitted).toHaveLength(3); // run_result now emitted
  });
});
