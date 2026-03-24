import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
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
  onClose: () => void;
  onSave: (tc: TestCase) => Promise<void>;
}

export function EvalForm({ open, initial, onClose, onSave }: EvalFormProps) {
  const [form, setForm] = useState<TestCase>(initial ?? EMPTY_TEST_CASE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setForm(initial ?? EMPTY_TEST_CASE);
      setError(null);
    }
  }, [open, initial]);

  const isEdit = (initial?.id ?? 0) > 0;

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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Eval" : "Review Generated Eval"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eval_name">Name</Label>
            <Input
              id="eval_name"
              placeholder="Customer returns workflow"
              value={form.eval_name}
              onChange={(e) => handleNameChange(e.target.value)}
              autoFocus
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
              className="min-h-20 resize-y"
              value={form.prompt}
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
                  onChange={(e) => handleExpectationChange(idx, e.target.value)}
                  className="flex-1"
                />
                {form.expectations.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
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
              onClick={handleAddExpectation}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add expectation
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {isEdit ? "Cancel" : "Discard"}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Save eval"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
