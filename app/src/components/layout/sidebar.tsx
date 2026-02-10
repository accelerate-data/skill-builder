import { Link, useRouterState } from "@tanstack/react-router";
import { Home, FileText, Settings, Moon, Sun, Monitor, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";

const navItems = [
  { to: "/" as const, label: "Dashboard", icon: Home },
  { to: "/prompts" as const, label: "Prompts", icon: FileText },
  { to: "/settings" as const, label: "Settings", icon: Settings },
];

const themeOptions = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
] as const;

const STORAGE_KEY = "sidebar-collapsed";

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { theme, setTheme } = useTheme();
  const isRunning = useWorkflowStore((s) => s.isRunning);

  // Initialize collapsed state from localStorage
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "true";
  });

  // Toggle function that persists state
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  // Keyboard shortcut: Cmd+B (Mac) / Ctrl+B (Win/Linux)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-sidebar-background text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div className={cn("flex h-14 items-center border-b", collapsed ? "justify-center px-2" : "gap-2 px-4")}>
        {collapsed ? (
          <Home className="size-5" />
        ) : (
          <span className="text-lg font-semibold">Skill Builder</span>
        )}
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
                "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2" : "gap-3 px-3",
                disabled && "pointer-events-none opacity-40",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
              aria-disabled={disabled}
              title={collapsed ? label : undefined}
            >
              <Icon className="size-4" />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t p-2">
        <button
          onClick={toggleCollapsed}
          className={cn(
            "flex w-full items-center rounded-md py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
            collapsed ? "justify-center px-2" : "gap-3 px-3"
          )}
          title={collapsed ? "Expand sidebar (Cmd+B)" : "Collapse sidebar (Cmd+B)"}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <>
              <PanelLeftClose className="size-4" />
              Collapse
            </>
          )}
        </button>

        <div className={cn("rounded-md bg-muted p-1", collapsed ? "flex flex-col" : "flex items-center")}>
          {themeOptions.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={cn(
                "flex items-center justify-center rounded-sm text-xs font-medium transition-colors",
                collapsed ? "w-full py-1.5" : "flex-1 gap-1.5 px-2 py-1.5",
                theme === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title={label}
            >
              <Icon className="size-3.5" />
              {!collapsed && label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
