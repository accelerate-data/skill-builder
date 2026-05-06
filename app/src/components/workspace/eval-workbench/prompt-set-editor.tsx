import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  scenarioSupportsMode,
  type EvalWorkbenchMode,
  type SaveScenario,
  type ScenarioAssertion,
} from "@/lib/eval-workbench";

interface PromptSetEditorProps {
  draft: SaveScenario;
  mode: EvalWorkbenchMode;
  onChange: (draft: SaveScenario) => void;
  onSave: () => void;
  onNew: () => void;
  saveDisabled?: boolean;
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
  onSave,
  onNew,
  saveDisabled = false,
}: PromptSetEditorProps) {
  function updateAssertions(nextAssertions: ScenarioAssertion[]) {
    onChange({ ...draft, assertions: nextAssertions });
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
        <Button size="sm" variant="outline" onClick={onNew}>
          New scenario
        </Button>
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
                <Label>Assertions</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateAssertions([
                      ...draft.assertions,
                      { type: "", value: "" },
                    ])
                  }
                >
                  <Plus className="mr-1 size-3.5" />
                  Add assertion
                </Button>
              </div>
              {draft.assertions.length > 0 ? (
                <div className="space-y-2">
                  {draft.assertions.map((assertion, assertionIndex) => (
                    <div
                      key={`${draft.id}-assertion-${assertionIndex}`}
                      className="grid gap-2 rounded border p-2 md:grid-cols-[140px_1fr]"
                    >
                      <Input
                        value={assertion.type}
                        onChange={(event) => {
                          const next = [...draft.assertions];
                          next[assertionIndex] = {
                            ...assertion,
                            type: event.target.value,
                          };
                          updateAssertions(next);
                        }}
                        placeholder="contains"
                      />
                      <Input
                        value={assertion.value}
                        onChange={(event) => {
                          const next = [...draft.assertions];
                          next[assertionIndex] = {
                            ...assertion,
                            value: event.target.value,
                          };
                          updateAssertions(next);
                        }}
                        placeholder="Expected phrase or expression"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No assertions yet.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button size="sm" onClick={onSave} disabled={saveDisabled}>
            Save scenario
          </Button>
        </div>
      </div>
    </section>
  );
}
