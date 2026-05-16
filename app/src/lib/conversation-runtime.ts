import { sendConversationMessageCommand } from "@/lib/tauri";
import { useConversationStore } from "@/stores/conversation-store";

export interface SendConversationMessageArgs {
  conversationId: string;
  message: string;
  localEventId: string;
}

export type ConversationSendResult =
  | { accepted: true }
  | { accepted: false; error: string };

export async function sendConversationMessage(
  args: SendConversationMessageArgs,
): Promise<ConversationSendResult> {
  try {
    const result = await sendConversationMessageCommand(
      args.conversationId,
      args.localEventId,
      args.message,
    );
    if (result.accepted) {
      useConversationStore.getState().markFrontendEventAccepted(
        args.conversationId,
        args.localEventId,
        Date.now(),
      );
    }
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send message.";
    useConversationStore.getState().markFrontendEventFailed(
      args.conversationId,
      args.localEventId,
      { message },
      Date.now(),
    );
    return {
      accepted: false,
      error: message,
    };
  }
}
