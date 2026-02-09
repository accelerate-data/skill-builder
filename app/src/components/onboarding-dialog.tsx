import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then((settings) => {
        if (!settings.anthropic_api_key) {
          setIsOpen(true);
        }
      })
      .catch(() => setIsOpen(true));
  }, []);

  const handleSave = async () => {
    if (!apiKey) return;
    setSaving(true);
    try {
      await invoke("save_settings", {
        settings: { anthropic_api_key: apiKey, workspace_path: null },
      });
      toast.success("API key saved! You're ready to start.");
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
            Enter your Anthropic API key to start building skills.
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
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setIsOpen(false)}
          >
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={!apiKey || saving}>
            {saving ? "Saving..." : "Get Started"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
