import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Settings, Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";

const navItems = [
  { to: "/" as const, label: "Dashboard", icon: Home },
  { to: "/settings" as const, label: "Settings", icon: Settings },
];

const themeOptions = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
] as const;

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { theme, setTheme } = useTheme();
  const isRunning = useWorkflowStore((s) => s.isRunning);

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-sidebar-background text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="text-lg font-semibold">Skill Builder</span>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            to === "/" ? currentPath === "/" : currentPath.startsWith(to);
          const disabled = isRunning && !isActive;
          return (
            <Link
              key={to}
              to={to}
              onClick={disabled ? (e) => e.preventDefault() : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                disabled && "pointer-events-none opacity-40",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
              aria-disabled={disabled}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center rounded-md bg-muted p-1">
          {themeOptions.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
                theme === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title={label}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
