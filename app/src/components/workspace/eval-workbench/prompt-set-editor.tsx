import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  scenarioSupportsMode,
  type EvalWorkbenchMode,
  type SaveScenario,
} from "@/lib/eval-workbench";

interface PromptSetEditorProps {
  draft: SaveScenario;
  mode: EvalWorkbenchMode;
  onChange: (draft: SaveScenario) => void;
  onNew: () => void;
  onSuggest?: () => void;
  onDelete?: () => void;
  suggestDisabled?: boolean;
  deleteDisabled?: boolean;
  showDelete?: boolean;
  showSuggest?: boolean;
  suggestBusy?: boolean;
}

function nextTags(
  draft: SaveScenario,
  tag: "performance" | "trigger",
  checked: boolean,
): SaveScenario["tags"] {
  const selected = new Set(
    draft.tags.includes("both") ? ["performance", "trigger"] : draft.tags,
  );
  if (checked) {
    selected.add(tag);
  } else {
    selected.delete(tag);
  }
  if (selected.has("performance") && selected.has("trigger")) {
    return ["both"];
  }
  return Array.from(selected) as SaveScenario["tags"];
}

export function PromptSetEditor({
  draft,
  mode,
  onChange,
  onNew,
  onSuggest,
  onDelete,
  suggestDisabled = false,
  deleteDisabled = false,
  showDelete = false,
  showSuggest = true,
  suggestBusy = false,
}: PromptSetEditorProps) {
  function updateExpectations(nextExpectations: string[]) {
    onChange({ ...draft, expectations: nextExpectations });
  }

  const triggerEnabled = scenarioSupportsMode(draft, "trigger");
  const performanceChecked =
    draft.tags.includes("both") || draft.tags.includes("performance");
  const triggerChecked =
    draft.tags.includes("both") || draft.tags.includes("trigger");

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Scenario</h2>
          <p className="text-xs text-muted-foreground">
            Git-backed eval cases for this skill.
          </p>
        </div>
        <div className="flex gap-2">
          {showDelete ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onDelete}
              disabled={deleteDisabled}
            >
              <Trash2 className="mr-1 size-3.5" />
              Delete scenario
            </Button>
          ) : null}
          {showSuggest ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onSuggest}
              disabled={suggestDisabled}
              className={suggestBusy ? "cursor-progress" : undefined}
            >
              <Sparkles className="mr-1 size-3.5" />
              {suggestBusy ? "Suggesting…" : "Suggest"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onNew}>
            New scenario
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`scenario-name-${mode}`}>Scenario name</Label>
          <Input
            id={`scenario-name-${mode}`}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder={mode === "performance" ? "Regression" : "Routing checks"}
          />
        </div>

        <div className="space-y-2">
          <Label>Scenario modes</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={performanceChecked} disabled />
              <span className="text-muted-foreground">Performance</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={triggerChecked}
                onCheckedChange={(checked) =>
                  onChange({
                    ...draft,
                    tags: nextTags(draft, "trigger", checked === true),
                  })
                }
              />
              <span>Trigger</span>
            </label>
          </div>
        </div>

        <div className="rounded-md border bg-background/70 p-3">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`scenario-prompt-${mode}`}>User prompt</Label>
              <Textarea
                id={`scenario-prompt-${mode}`}
                value={draft.prompt}
                onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
                placeholder="Describe the request to evaluate."
              />
            </div>

            {triggerEnabled ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={Boolean(draft.shouldTrigger)}
                  onCheckedChange={(checked) =>
                    onChange({ ...draft, shouldTrigger: checked === true })
                  }
                />
                <span>Should trigger</span>
              </label>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Expectations</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateExpectations([...draft.expectations, ""])
                  }
                >
                  <Plus className="mr-1 size-3.5" />
                  Add expectation
                </Button>
              </div>
              {draft.expectations.length > 0 ? (
                <div className="space-y-2">
                  {draft.expectations.map((expectation, expectationIndex) => (
                    <div
                      key={`${draft.id}-expectation-${expectationIndex}`}
                      className="rounded border p-2"
                    >
                      <Textarea
                        value={expectation}
                        onChange={(event) => {
                          const next = [...draft.expectations];
                          next[expectationIndex] = event.target.value;
                          updateExpectations(next);
                        }}
                        placeholder="Describe the business outcome the answer should satisfy."
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No expectations yet.
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
