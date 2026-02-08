import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { GitHubUser, AppSettings } from "@/lib/types";

export function Header() {
  const [user, setUser] = useState<GitHubUser | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const settings = await invoke<AppSettings>("get_settings");
        if (settings.github_token) {
          const githubUser = await invoke<GitHubUser>("get_current_user", {
            token: settings.github_token,
          });
          setUser(githubUser);
        }
      } catch {
        // No token or invalid — that's fine
      }
    };
    fetchUser();
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <h1 className="text-lg font-semibold">Skill Builder</h1>

      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-2 text-sm">
            <Avatar className="size-7">
              <AvatarImage src={user.avatar_url} alt={user.login} />
              <AvatarFallback>
                {user.login.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-muted-foreground">{user.name ?? user.login}</span>
          </div>
        )}
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="size-8">
            <Settings className="size-4" />
          </Button>
        </Link>
      </div>
    </header>
  );
}
