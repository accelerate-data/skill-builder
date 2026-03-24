import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface EvalIntentDialogProps {
  open: boolean;
  /** Skill-aware placeholder derived from the skill's description. */
  placeholder: string;
  onGenerate: (intent: string) => void;
  onCancel: () => void;
}

export function EvalIntentDialog({ open, placeholder, onGenerate, onCancel }: EvalIntentDialogProps) {
  const [intent, setIntent] = useState("");

  // Clear input each time the dialog opens
  useEffect(() => {
    if (open) setIntent("");
  }, [open]);

  function handleGenerate() {
    const trimmed = intent.trim();
    if (!trimmed) return;
    onGenerate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate eval</DialogTitle>
          <DialogDescription>What do you want to evaluate?</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <Label htmlFor="eval-intent" className="sr-only">Scenario</Label>
          <Textarea
            id="eval-intent"
            autoFocus
            placeholder={placeholder}
            className="min-h-20 resize-none"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p className="text-xs text-muted-foreground">
            Be specific — "SCD type 2 insert creates a new row" works better than "snapshot works".
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={!intent.trim()}>
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
