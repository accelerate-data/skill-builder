import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EventDisplayTimeline } from "@/components/event-display/event-display-timeline";
import { useSkillStore } from "@/stores/skill-store";

interface WorkspaceConversationProps {
  skillName: string;
}

export function WorkspaceConversation({ skillName }: WorkspaceConversationProps) {
  const conversationId = useSkillStore((state) => state.conversationId);

  if (!conversationId) {
    return (
      <Card className="flex min-h-0 flex-1">
        <CardContent
          data-testid="workspace-conversation-empty"
          className="flex h-full flex-col items-center justify-center gap-2 text-center"
        >
          <p className="text-sm font-medium">Conversation session not ready</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Select or restore the {skillName} session to view its canonical conversation.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Conversation</CardTitle>
          <CardDescription>
            Session-backed timeline for {skillName}.
          </CardDescription>
        </CardHeader>
      </Card>
      <EventDisplayTimeline conversationId={conversationId} />
    </div>
  );
}
