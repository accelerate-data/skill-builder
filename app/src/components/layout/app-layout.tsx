import { useEffect } from "react";
import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { useSettingsStore } from "@/stores/settings-store";
import { getSettings } from "@/lib/tauri";

export function AppLayout() {
  const setSettings = useSettingsStore((s) => s.setSettings);

  // Hydrate settings store from Tauri backend on app startup
  useEffect(() => {
    getSettings().then((s) => {
      setSettings({
        anthropicApiKey: s.anthropic_api_key,
        githubRepo: s.github_repo,
        workspacePath: s.workspace_path,
        autoCommit: s.auto_commit,
        autoPush: s.auto_push,
      });
    }).catch(() => {
      // Settings may not exist yet
    });
  }, [setSettings]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
