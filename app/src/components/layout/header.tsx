import { useRouterState, useNavigate } from "@tanstack/react-router";
import { Settings, CircleHelp } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { ReviewModeToggle } from "@/components/review-mode-toggle";
import { getHelpUrl, getWorkflowStepUrl } from "@/lib/help-urls";
import { useWorkflowStore } from "@/stores/workflow-store";

function getPageTitle(path: string): string {
  if (path === "/") return "Dashboard";
  if (path === "/settings") return "Settings";
  if (path === "/usage") return "Usage";
  if (path === "/refine") return "Refine";
  if (path.startsWith("/skill/")) return decodeURIComponent(path.slice("/skill/".length));
  return "Skill Builder";
}

export function Header() {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isWorkflow = currentPath.startsWith("/skill/");
  const currentStep = useWorkflowStore((s) => s.currentStep);

  function helpUrl() {
    if (isWorkflow) return getWorkflowStepUrl(currentStep);
    return getHelpUrl(currentPath);
  }

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">{getPageTitle(currentPath)}</h1>
      </div>
      <div className="flex items-center gap-2">
        {isWorkflow && <ReviewModeToggle />}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => openUrl(helpUrl())}
          title="Help"
        >
          <CircleHelp className="size-4" />
        </Button>
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
