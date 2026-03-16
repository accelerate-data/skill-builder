import { useNavigate } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

export function IconRail() {
  const navigate = useNavigate();
  return (
    <aside className="flex h-full w-[52px] flex-shrink-0 flex-col items-center border-r bg-sidebar-background py-2.5">
      {/* Logo mark */}
      <div className="flex size-8 items-center justify-center rounded-lg bg-[oklch(0.215_0.105_265)]">
        <img src="/icon-256.png" alt="Skill Builder" className="size-5 block dark:hidden" />
        <img src="/icon-dark-256.png" alt="Skill Builder" className="size-5 hidden dark:block" />
      </div>
      {/* Spacer */}
      <div className="mt-auto" />
      {/* Settings gear — pinned to bottom */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-8"
        onClick={() => navigate({ to: "/settings" })}
        title="Settings (⌘,)"
      >
        <Settings className="size-4" />
      </Button>
    </aside>
  );
}
