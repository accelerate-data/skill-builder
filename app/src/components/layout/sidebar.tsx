import { Link, useRouterState } from "@tanstack/react-router";
import { Home, FileText, Settings, PanelLeftClose, PanelLeftOpen, DollarSign, Github, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GitHubLoginDialog } from "@/components/github-login-dialog";
import { useAuthStore } from "@/stores/auth-store";

const navItems = [
  { to: "/" as const, label: "Skills", icon: Home },
  { to: "/prompts" as const, label: "Prompts", icon: FileText },
  { to: "/usage" as const, label: "Usage", icon: DollarSign },
];

const STORAGE_KEY = "sidebar-collapsed";

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { user, isLoggedIn, logout } = useAuthStore();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

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
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2" : "gap-3 px-3",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
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

        {/* Auth UI */}
        {isLoggedIn && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {collapsed ? (
                <button
                  className="flex w-full items-center justify-center rounded-md py-2 transition-colors hover:bg-sidebar-accent/50"
                  title={user.login}
                >
                  <Avatar size="sm">
                    <AvatarImage src={user.avatar_url} alt={user.login} />
                    <AvatarFallback>{user.login[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                </button>
              ) : (
                <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                  <Avatar size="sm">
                    <AvatarImage src={user.avatar_url} alt={user.login} />
                    <AvatarFallback>{user.login[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm font-medium">{user.login}</span>
                </button>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align={collapsed ? "center" : "start"}>
              <DropdownMenuLabel className="font-normal">
                <span className="text-xs text-muted-foreground">{user.login}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : collapsed ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="mx-auto"
            onClick={() => setLoginDialogOpen(true)}
            title="Sign in with GitHub"
          >
            <Github className="size-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 px-3 text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
            onClick={() => setLoginDialogOpen(true)}
          >
            <Github className="size-4" />
            Sign in
          </Button>
        )}
      </div>

      <GitHubLoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </aside>
  );
}
