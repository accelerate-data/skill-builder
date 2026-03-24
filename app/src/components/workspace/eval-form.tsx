import { useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import type { TestCase } from "@/lib/types";
import {
  EMPTY_TEST_CASE,
  addExpectation,
  applyExpectationChange,
  applyNameChange,
  prepareForSave,
  removeExpectation,
  validateTestCaseForm,
} from "@/lib/evals";

interface EvalFormProps {
  open: boolean;
  initial?: TestCase;
  /** Initial intent for generated evals. When provided, shows the intent row with ↻ button. */
  intent?: string;
  /** Whether the agent is re-generating from an updated intent (dims fields). */
  isRegenerating?: boolean;
  onClose: () => void;
  onSave: (tc: TestCase) => Promise<void>;
  /** Called when user edits intent and clicks ↻. Receives the current intent value. */
  onRegenerate?: (intent: string) => void;
  /** Called when user clicks "Queue & generate another". */
  onQueue?: () => void;
}

export function EvalForm({
  open,
  initial,
  intent: initialIntent,
  isRegenerating = false,
  onClose,
  onSave,
  onRegenerate,
  onQueue,
}: EvalFormProps) {
  const [form, setForm] = useState<TestCase>(initial ?? EMPTY_TEST_CASE);
  const [localIntent, setLocalIntent] = useState(initialIntent ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setForm(initial ?? EMPTY_TEST_CASE);
      setLocalIntent(initialIntent ?? "");
      setError(null);
    }
  }, [open, initial, initialIntent]);

  // Keep form in sync when initial changes (re-generate updates it)
  useEffect(() => {
    if (open && initial) {
      setForm(initial);
    }
  }, [open, initial]);

  const isEdit = (initial?.id ?? 0) > 0;
  const isGenerated = initialIntent !== undefined;

  // --- Action handlers (thin wrappers over pure calculations) ---

  function handleNameChange(name: string) {
    setForm((prev) => applyNameChange(prev, name, isEdit));
  }

  function handleExpectationChange(idx: number, value: string) {
    setForm((prev) => applyExpectationChange(prev, idx, value));
  }

  function handleAddExpectation() {
    setForm((prev) => addExpectation(prev));
  }

  function handleRemoveExpectation(idx: number) {
    setForm((prev) => removeExpectation(prev, idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateTestCaseForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(prepareForSave(form));
      onClose();
    } catch (err) {
      console.error("event=save_eval status=failure error=%s", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const fieldsDisabled = isRegenerating || saving;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !fieldsDisabled) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Eval" : "Review Generated Eval"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto py-2">

            {/* Intent row — only for generated evals */}
            {isGenerated && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="eval-intent">Intent</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="eval-intent"
                      value={localIntent}
                      onChange={(e) => setLocalIntent(e.target.value)}
                      disabled={fieldsDisabled}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={fieldsDisabled || !localIntent.trim()}
                      onClick={() => onRegenerate?.(localIntent)}
                      title="Re-generate eval from updated intent"
                      aria-label="Re-generate eval"
                    >
                      {isRegenerating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Edit this field and click ↻ to regenerate the full eval from the updated intent.
                  </p>
                </div>
                <Separator />
              </>
            )}

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eval_name">Name</Label>
              <Input
                id="eval_name"
                placeholder="Customer returns workflow"
                value={form.eval_name}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={fieldsDisabled}
                autoFocus={!isGenerated}
              />
            </div>

            {/* Slug preview */}
            {form.slug && (
              <p className="text-xs text-muted-foreground">
                Slug: <span className="font-mono">{form.slug}</span>
              </p>
            )}

            {/* Prompt */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                placeholder="Describe the task the skill should perform..."
                className="min-h-32 resize-y"
                value={form.prompt}
                disabled={fieldsDisabled}
                onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
              />
            </div>

            {/* Expectations */}
            <div className="flex flex-col gap-2">
              <Label>Expectations</Label>
              {form.expectations.map((exp, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    placeholder={`Assertion ${idx + 1}`}
                    value={exp}
                    disabled={fieldsDisabled}
                    onChange={(e) => handleExpectationChange(idx, e.target.value)}
                    className="flex-1"
                  />
                  {form.expectations.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={fieldsDisabled}
                      onClick={() => handleRemoveExpectation(idx)}
                      aria-label="Remove expectation"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                disabled={fieldsDisabled}
                onClick={handleAddExpectation}
              >
                <Plus className="mr-1.5 size-3.5" />
                Add expectation
              </Button>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={fieldsDisabled}
            >
              Cancel
            </Button>
            {isGenerated && onQueue && (
              <Button
                type="button"
                variant="secondary"
                disabled={fieldsDisabled}
                onClick={onQueue}
              >
                Queue &amp; generate another
              </Button>
            )}
            <Button type="submit" disabled={fieldsDisabled}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
