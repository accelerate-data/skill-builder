import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CloseGuard } from "@/components/close-guard";
import { SplashScreen } from "@/components/splash-screen";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { getSettings } from "@/lib/tauri";

export function AppLayout() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const navigate = useNavigate();
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [splashDismissed, setSplashDismissed] = useState(false);

  // Hydrate settings store from Tauri backend on app startup
  useEffect(() => {
    getSettings().then((s) => {
      setSettings({
        anthropicApiKey: s.anthropic_api_key,
        workspacePath: s.workspace_path,
        skillsPath: s.skills_path,
        preferredModel: s.preferred_model,
        debugMode: s.debug_mode,
        extendedContext: s.extended_context,
      });
      setSettingsLoaded(true);
    }).catch(() => {
      // Settings may not exist yet — show splash
      setSettingsLoaded(true);
    });
  }, [setSettings]);

  const isRunning = useWorkflowStore((s) => s.isRunning);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+, (Mac) or Ctrl+, (Win/Linux) -> Settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        if (!isRunning) navigate({ to: "/settings" });
      }
      // Cmd+1 -> Dashboard
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        if (!isRunning) navigate({ to: "/" });
      }
      // Cmd+3 -> Prompts
      if ((e.metaKey || e.ctrlKey) && e.key === "3") {
        e.preventDefault();
        if (!isRunning) navigate({ to: "/prompts" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, isRunning]);

  const handleSplashDismiss = () => {
    setSplashDismissed(true);
  };

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
      {settingsLoaded && !splashDismissed && (
        <SplashScreen onDismiss={handleSplashDismiss} />
      )}
    </div>
  );
}
