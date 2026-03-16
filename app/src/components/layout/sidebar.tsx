import { Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";

export function IconRail() {
  return (
    <aside className="flex h-full w-[52px] flex-shrink-0 flex-col items-center border-r bg-sidebar-background py-2.5">
      {/* Logo mark */}
      <div className="flex size-8 items-center justify-center rounded-lg bg-[oklch(0.215_0.105_265)]">
        <img src="/icon-256.png" alt="Skill Builder" className="size-5 block dark:hidden" />
        <img src="/icon-dark-256.png" alt="Skill Builder" className="size-5 hidden dark:block" />
      </div>
      {/* Spacer */}
      <div className="mt-auto" />
      {/* Settings */}
      <Link
        to="/settings"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title="Settings"
      >
        <Settings className="size-4" />
      </Link>
    </aside>
  );
}
