import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAgentStore } from "@/stores/agent-store";

interface AgentMessagePayload {
  agent_id: string;
  message: {
    type: string;
    message?: {
      content?: Array<{ type: string; text?: string }>;
    };
    result?: string;
    error?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    cost_usd?: number;
    [key: string]: unknown;
  };
}

interface AgentExitPayload {
  agent_id: string;
  success: boolean;
}

// Module-level singleton subscription.  Multiple components (workflow page,
// chat page) may call useAgentStream(), and React StrictMode double-mounts
// effects.  Because Tauri's `listen()` returns a Promise<UnlistenFn>, the
// async cleanup races with the next mount's `listen()` call, accumulating
// duplicate subscriptions that cause messages to appear N times.
//
// The singleton ensures exactly ONE Tauri listener exists at any time,
// regardless of how many React components call the hook or how many times
// effects re-run.
let refCount = 0;
let teardown: (() => void) | null = null;

function subscribe() {
  refCount++;
  if (refCount > 1) return; // already subscribed

  // Track unlisten promises so we can tear down synchronously-ish
  let tornDown = false;
  const unlistenMessage = listen<AgentMessagePayload>(
    "agent-message",
    (event) => {
      if (tornDown) return;
      const { agent_id, message } = event.payload;

      let content: string | undefined;
      if (message.type === "assistant") {
        const textBlocks = message.message?.content?.filter(
          (b) => b.type === "text"
        );
        content = textBlocks?.map((b) => b.text).join("") || undefined;
      } else if (message.type === "result") {
        content = message.result || undefined;
      } else if (message.type === "error") {
        content = message.error || "Unknown error";
      }

      useAgentStore.getState().addMessage(agent_id, {
        type: message.type,
        content,
        raw: message as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      });
    }
  );

  const unlistenExit = listen<AgentExitPayload>(
    "agent-exit",
    (event) => {
      if (tornDown) return;
      useAgentStore.getState().completeRun(
        event.payload.agent_id,
        event.payload.success
      );
    }
  );

  teardown = () => {
    tornDown = true;
    unlistenMessage.then((fn) => fn());
    unlistenExit.then((fn) => fn());
    teardown = null;
  };
}

function unsubscribe() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && teardown) {
    teardown();
  }
}

export function useAgentStream() {
  useEffect(() => {
    subscribe();
    return () => unsubscribe();
  }, []);
}

/** Reset module-level singleton state for tests. */
export function _resetForTesting() {
  if (teardown) teardown();
  refCount = 0;
  teardown = null;
}
