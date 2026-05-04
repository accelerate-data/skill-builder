import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  SaveEvalPromptCase,
  SaveEvalPromptSet,
} from "@/lib/eval-workbench";
import { createEmptyPromptCase } from "@/lib/eval-workbench";

interface PromptSetEditorProps {
  draft: SaveEvalPromptSet;
  onChange: (draft: SaveEvalPromptSet) => void;
  onSave: () => void;
  onNew: () => void;
  saveDisabled?: boolean;
}

export function PromptSetEditor({
  draft,
  onChange,
  onSave,
  onNew,
  saveDisabled = false,
}: PromptSetEditorProps) {
  const mode = draft.mode;

  function updateCase(
    index: number,
    updater: (caseItem: SaveEvalPromptCase) => SaveEvalPromptCase,
  ) {
    const cases = draft.cases.map((caseItem, caseIndex) =>
      caseIndex === index ? updater(caseItem) : caseItem,
    );
    onChange({ ...draft, cases });
  }

  function removeCase(index: number) {
    const nextCases =
      draft.cases.length === 1
        ? [createEmptyPromptCase(mode)]
        : draft.cases.filter((_, caseIndex) => caseIndex !== index);
    onChange({ ...draft, cases: nextCases });
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Prompt set</h2>
          <p className="text-xs text-muted-foreground">
            App-owned {mode} prompts for this skill.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onNew}>
          New prompt set
        </Button>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`prompt-set-name-${mode}`}>Prompt set name</Label>
          <Input
            id={`prompt-set-name-${mode}`}
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
            placeholder={
              mode === "performance" ? "Regression" : "Routing checks"
            }
          />
        </div>

        {draft.cases.map((caseItem, index) => (
          <div
            key={caseItem.id ?? `draft-case-${index}`}
            className="rounded-md border bg-background/70 p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Case {index + 1}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete case ${index + 1}`}
                onClick={() => removeCase(index)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`case-prompt-${mode}-${index}`}>Case prompt</Label>
                <Textarea
                  id={`case-prompt-${mode}-${index}`}
                  value={caseItem.prompt}
                  onChange={(event) =>
                    updateCase(index, (current) => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                  placeholder="Describe the request to evaluate."
                />
              </div>

              {mode === "performance" ? (
                <div className="space-y-2">
                  <Label htmlFor={`case-expected-${mode}-${index}`}>
                    Expected outcome
                  </Label>
                  <Textarea
                    id={`case-expected-${mode}-${index}`}
                    value={caseItem.expected ?? ""}
                    onChange={(event) =>
                      updateCase(index, (current) => ({
                        ...current,
                        expected: event.target.value,
                      }))
                    }
                    placeholder="Describe the expected response or behavior."
                  />
                </div>
              ) : (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={Boolean(caseItem.shouldTrigger)}
                    onCheckedChange={(checked) =>
                      updateCase(index, (current) => ({
                        ...current,
                        shouldTrigger: checked === true,
                      }))
                    }
                  />
                  <span>Should trigger</span>
                </label>
              )}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...draft,
                cases: [...draft.cases, createEmptyPromptCase(mode)],
              })
            }
          >
            <Plus className="mr-1 size-3.5" />
            Add case
          </Button>
          <Button size="sm" onClick={onSave} disabled={saveDisabled}>
            Save prompt set
          </Button>
        </div>
      </div>
    </section>
  );
}
