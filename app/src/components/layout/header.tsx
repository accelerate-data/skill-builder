import { useRouterState, useNavigate } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { ReviewModeToggle } from "@/components/review-mode-toggle";

export function Header() {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isWorkflow = currentPath.startsWith("/skill/");

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Skill Builder</h1>
      </div>
      <div className="flex items-center gap-2">
        {isWorkflow && <ReviewModeToggle />}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate({ to: "/settings" })}
          title="Settings (⌘,)"
        >
          <Settings className="size-4" />
        </Button>
        <FeedbackDialog />
      </div>
    </header>
  );
}
