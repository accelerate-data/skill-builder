import { useEffect } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CloseGuard } from "@/components/close-guard";
import { useSettingsStore } from "@/stores/settings-store";
import { getSettings } from "@/lib/tauri";

export function AppLayout() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const navigate = useNavigate();

  // Hydrate settings store from Tauri backend on app startup
  useEffect(() => {
    getSettings().then((s) => {
      setSettings({
        anthropicApiKey: s.anthropic_api_key,
        workspacePath: s.workspace_path,
      });
    }).catch(() => {
      // Settings may not exist yet
    });
  }, [setSettings]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+, (Mac) or Ctrl+, (Win/Linux) -> Settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        navigate({ to: "/settings" });
      }
      // Cmd+1 -> Dashboard
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        navigate({ to: "/" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <CloseGuard />
    </div>
  );
}
