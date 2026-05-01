import type { AgentEvent } from "../agent-events.js";
import type { DisplayItem } from "../display-types.js";
import type { RefineQuestion, RuntimeSink } from "./types.js";

export function createRecordRuntimeSink(
  emit: (message: Record<string, unknown>) => void,
): RuntimeSink {
  return {
    emit(message) {
      emit(message);
    },

    emitDisplayItem(item: DisplayItem) {
      emit({ type: "display_item", item });
    },

    emitAgentEvent(event: AgentEvent, timestamp = Date.now()) {
      emit({ type: "agent_event", event, timestamp });
    },

    emitRefineQuestion(question: RefineQuestion) {
      emit({
        type: "refine_question",
        tool_use_id: question.tool_use_id,
        questions: question.questions,
        timestamp: question.timestamp,
      });
    },

    emitRaw(message: Record<string, unknown>) {
      emit(message);
    },
  };
}
