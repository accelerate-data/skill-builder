import type { MessageProcessor } from "./message-processor.js";

/**
 * Gates `run_result` emission until all subagents and background tasks have
 * completed. This prevents the Rust side from tearing down the agent
 * connection while the SDK still has active subagents.
 *
 * Usage:
 *   const gate = new ResultGate(processor);
 *   // In the for-await loop:
 *   for (const item of processor.process(msg)) {
 *     gate.emit(item, onMessage);
 *   }
 *   gate.tryFlush(onMessage);  // after each message batch
 *   // After loop exits:
 *   gate.flush(onMessage);     // safety net
 */
export class ResultGate {
  private deferred: Record<string, unknown>[] = [];
  private processor: MessageProcessor;

  constructor(processor: MessageProcessor) {
    this.processor = processor;
  }

  /** Number of deferred run_result items currently held. */
  get deferredCount(): number {
    return this.deferred.length;
  }

  /**
   * Emit a processed item, deferring run_result events when agents are active.
   */
  emit(
    item: Record<string, unknown>,
    onMessage: (msg: Record<string, unknown>) => void,
  ): void {
    if (this.isRunResult(item)) {
      const active = this.activeCount();
      if (active > 0) {
        process.stderr.write(
          `[sidecar:gate] event=defer_run_result active_agents=${active}\n`,
        );
        this.deferred.push(item);
        return;
      }
    }

    onMessage(item);
  }

  /**
   * Flush deferred items if all agents have completed.
   * Call after processing each message batch.
   */
  tryFlush(onMessage: (msg: Record<string, unknown>) => void): void {
    if (this.deferred.length === 0) return;
    if (this.activeCount() > 0) return;

    process.stderr.write(
      `[sidecar:gate] event=flush_run_result reason=agents_completed count=${this.deferred.length}\n`,
    );
    for (const item of this.deferred) {
      onMessage(item);
    }
    this.deferred = [];
  }

  /**
   * Force-flush any remaining deferred items. Call when the loop exits
   * as a safety net — we must always emit run_result eventually.
   */
  flush(onMessage: (msg: Record<string, unknown>) => void): void {
    if (this.deferred.length === 0) return;

    const active = this.activeCount();
    if (active > 0) {
      process.stderr.write(
        `[sidecar:gate] event=force_flush_run_result reason=loop_ended active_agents=${active}\n`,
      );
    } else {
      process.stderr.write(
        `[sidecar:gate] event=flush_run_result reason=loop_ended count=${this.deferred.length}\n`,
      );
    }
    for (const item of this.deferred) {
      onMessage(item);
    }
    this.deferred = [];
  }

  private activeCount(): number {
    return (
      this.processor.activeSubagentCount +
      this.processor.pendingBackgroundTaskCount
    );
  }

  private isRunResult(item: Record<string, unknown>): boolean {
    if (item.type !== "agent_event") return false;
    const event = item.event as Record<string, unknown> | undefined;
    return event?.type === "run_result";
  }
}
