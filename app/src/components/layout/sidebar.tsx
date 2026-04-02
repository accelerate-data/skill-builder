import { useLocation, useNavigate } from "@tanstack/react-router";
import { Settings } from "lucide-react";

export function IconRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const isOnSettings = location.pathname === "/settings";

  return (
    <aside className="flex h-full w-[64px] flex-shrink-0 flex-col items-center border-r bg-sidebar-background py-2.5">
      {/* Logo mark */}
      <div className="flex size-11 items-center justify-center">
        <img src="/icon-dark-256.png" alt="Skill Builder" className="size-8 block dark:hidden" />
        <img src="/icon-light-256.png" alt="Skill Builder" className="size-8 hidden dark:block" />
      </div>
      {/* Spacer */}
      <div className="mt-auto" />
      {/* Settings (toggle) */}
      <button
        onClick={() => navigate({ to: isOnSettings ? "/" : "/settings" })}
        className={`flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${isOnSettings ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
        title="Settings"
      >
        <Settings className="size-4" />
      </button>
    </aside>
  );
}
