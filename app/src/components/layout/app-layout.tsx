import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CloseGuard } from "@/components/close-guard";
import { SplashScreen } from "@/components/splash-screen";
import { useSettingsStore } from "@/stores/settings-store";
import { getSettings, saveSettings } from "@/lib/tauri";

export function AppLayout() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const splashShown = useSettingsStore((s) => s.splashShown);
  const navigate = useNavigate();
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Hydrate settings store from Tauri backend on app startup
  useEffect(() => {
    getSettings().then((s) => {
      setSettings({
        anthropicApiKey: s.anthropic_api_key,
        workspacePath: s.workspace_path,
        preferredModel: s.preferred_model,
        debugMode: s.debug_mode,
        extendedContext: s.extended_context,
        splashShown: s.splash_shown,
      });
      setSettingsLoaded(true);
    }).catch(() => {
      // Settings may not exist yet — show splash
      setSettingsLoaded(true);
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

  const handleSplashDismiss = async () => {
    setSettings({ splashShown: true });
    try {
      const current = await getSettings();
      await saveSettings({ ...current, splash_shown: true });
    } catch {
      // Best effort — splash won't show again this session regardless
    }
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
      {settingsLoaded && !splashShown && (
        <SplashScreen onDismiss={handleSplashDismiss} />
      )}
    </div>
  );
}
