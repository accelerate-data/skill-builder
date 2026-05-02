import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "@/lib/toast";
import { Loader2, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsStore } from "@/stores/settings-store";
import {
  getSettings,
  saveSettings,
  getDefaultSkillsPath,
} from "@/lib/tauri";
import { normalizeDirectoryPickerPath } from "@/lib/utils";

interface SetupScreenProps {
  /** @deprecated No longer needed -- the parent reads isConfigured from the store. */
  onComplete?: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps = {}) {
  const existingSkillsPath = useSettingsStore((s) => s.skillsPath);
  const [skillsPath, setSkillsPath] = useState(existingSkillsPath ?? "");
  const [saving, setSaving] = useState(false);
  const setStoreSettings = useSettingsStore((s) => s.setSettings);

  // Only fetch default skills path if no existing value
  useEffect(() => {
    if (!existingSkillsPath) {
      getDefaultSkillsPath()
        .then((path) => setSkillsPath(path))
        .catch((e) =>
          console.warn(
            "[setup-screen] non-fatal: op=getDefaultSkillsPath err=%s",
            e,
          ),
        );
    }
  }, [existingSkillsPath]);

  const handleBrowseSkillsPath = async () => {
    const folder = await open({
      directory: true,
      title: "Select Skills Folder",
    });
    if (folder) {
      setSkillsPath(normalizeDirectoryPickerPath(folder));
    }
  };

  const handleContinue = async () => {
    if (!skillsPath) return;
    setSaving(true);
    try {
      const existing = await getSettings();
      await saveSettings({
        ...existing,
        skills_path: skillsPath,
      });
      setStoreSettings({
        skillsPath,
      });
      onComplete?.();
    } catch (err) {
      toast.error(
        `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      );
    } finally {
      setSaving(false);
    }
  };

  const canContinue = !!skillsPath && !saving;

  return (
    <div
      data-testid="setup-screen"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
    >
      {/* Gradient backdrop */}
      <div className="absolute inset-0 bg-background">
        <div className="absolute inset-0 opacity-30 dark:opacity-20">
          <div className="absolute -top-1/4 -left-1/4 h-3/4 w-3/4 rounded-full bg-[oklch(0.7_0.12_210)] blur-[120px]" />
          <div className="absolute -right-1/4 -bottom-1/4 h-3/4 w-3/4 rounded-full bg-[oklch(0.7_0.10_208)] blur-[120px]" />
        </div>
      </div>

      {/* Card */}
      <div className="relative z-10 flex w-full max-w-md flex-col gap-6 rounded-xl border bg-card p-10 shadow-lg">
        <div className="flex flex-col gap-1.5 text-center">
          <img
            src="/icon-dark-256.png"
            alt="Skill Builder"
            className="mx-auto mb-2 size-14 block dark:hidden"
          />
          <img
            src="/icon-light-256.png"
            alt="Skill Builder"
            className="mx-auto mb-2 size-14 hidden dark:block"
          />
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome to Skill Builder
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose where Skill Builder should store your skills.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-skills-path">Skills Folder</Label>
            <div className="flex gap-2">
              <Input
                id="setup-skills-path"
                placeholder="~/skill-builder"
                value={skillsPath}
                onChange={(e) => setSkillsPath(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleBrowseSkillsPath}
              >
                <FolderSearch className="size-4" />
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Where your built skills will be stored.
            </p>
          </div>
        </div>

        <Button
          size="lg"
          onClick={handleContinue}
          disabled={!canContinue}
          className="w-full"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Get Started
        </Button>
      </div>
    </div>
  );
}
