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

interface TestCaseFormProps {
  open: boolean;
  initial?: TestCase;
  onClose: () => void;
  onSave: (tc: TestCase) => Promise<void>;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const EMPTY: TestCase = {
  id: 0,
  eval_name: "",
  slug: "",
  prompt: "",
  expected_output: "",
  files: [],
  expectations: [""],
};

export function TestCaseForm({ open, initial, onClose, onSave }: TestCaseFormProps) {
  const [form, setForm] = useState<TestCase>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setForm(initial ?? EMPTY);
      setError(null);
    }
  }, [open, initial]);

  const isEdit = (initial?.id ?? 0) > 0;

  function handleNameChange(name: string) {
    setForm((prev) => ({
      ...prev,
      eval_name: name,
      // Only auto-generate slug on create
      slug: isEdit ? prev.slug : toSlug(name),
    }));
  }

  function handleExpectationChange(idx: number, value: string) {
    setForm((prev) => {
      const expectations = [...prev.expectations];
      expectations[idx] = value;
      return { ...prev, expectations };
    });
  }

  function addExpectation() {
    setForm((prev) => ({
      ...prev,
      expectations: [...prev.expectations, ""],
    }));
  }

  function removeExpectation(idx: number) {
    setForm((prev) => ({
      ...prev,
      expectations: prev.expectations.filter((_, i) => i !== idx),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.eval_name.trim()) {
      setError("Test case name is required.");
      return;
    }
    const nonEmpty = form.expectations.filter((e) => e.trim());
    if (nonEmpty.length === 0) {
      setError("At least one expectation is required.");
      return;
    }

    setSaving(true);
    try {
      await onSave({ ...form, expectations: nonEmpty });
      onClose();
    } catch (err) {
      console.error("event=save_test_case status=failure error=%s", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Test Case" : "Add Test Case"}</DialogTitle>
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

          {/* Expected output */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expected_output">Expected Output</Label>
            <Textarea
              id="expected_output"
              placeholder="Describe the expected result..."
              className="min-h-16 resize-y"
              value={form.expected_output}
              onChange={(e) => setForm((prev) => ({ ...prev, expected_output: e.target.value }))}
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
                    onClick={() => removeExpectation(idx)}
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
              onClick={addExpectation}
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
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add test case"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
