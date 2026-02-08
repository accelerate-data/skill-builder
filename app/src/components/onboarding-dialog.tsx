import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppSettings } from "@/lib/types";

export function OnboardingDialog({ onComplete }: { onComplete: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [wsPath, setWsPath] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then((settings) => {
        if (!settings.anthropic_api_key && !settings.workspace_path) {
          setIsOpen(true);
        }
      })
      .catch(() => setIsOpen(true));
  }, []);

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, title: "Select workspace folder" });
      if (selected) setWsPath(selected as string);
    } catch {
      // User cancelled
    }
  };

  const handleSave = async () => {
    if (!apiKey || !wsPath) return;
    setSaving(true);
    try {
      await invoke("save_settings", {
        settings: { anthropic_api_key: apiKey, workspace_path: wsPath },
      });
      toast.success("Settings saved! You're ready to start.");
      setIsOpen(false);
      onComplete();
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to Skill Builder</DialogTitle>
          <DialogDescription>
            Set up your API key and workspace folder to start building skills.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="onboard-apiKey">Anthropic API Key</Label>
            <Input
              id="onboard-apiKey"
              type="password"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboard-workspace">Workspace Folder</Label>
            <div className="flex gap-2">
              <Input
                id="onboard-workspace"
                readOnly
                value={wsPath}
                placeholder="Select a folder..."
                className="flex-1"
              />
              <Button variant="outline" onClick={handleBrowse}>
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Skills will be stored in this folder.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setIsOpen(false)}
          >
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={!apiKey || !wsPath || saving}>
            {saving ? "Saving..." : "Get Started"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
