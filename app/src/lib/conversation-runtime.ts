import { sendConversationMessageCommand } from "@/lib/tauri";

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
    return await sendConversationMessageCommand(
      args.conversationId,
      args.localEventId,
      args.message,
    );
  } catch (error) {
    return {
      accepted: false,
      error: error instanceof Error ? error.message : "Failed to send message.",
    };
  }
}
