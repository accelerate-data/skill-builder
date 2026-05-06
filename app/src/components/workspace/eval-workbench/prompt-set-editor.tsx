import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createEmptyScenarioCase,
  scenarioSupportsMode,
  type EvalWorkbenchMode,
  type SaveScenario,
  type SaveScenarioCase,
  type ScenarioAssertion,
} from "@/lib/eval-workbench";

interface PromptSetEditorProps {
  draft: SaveScenario;
  mode: EvalWorkbenchMode;
  onChange: (draft: SaveScenario) => void;
  onSave: () => void;
  onNew: () => void;
  onSuggestAssertions?: (caseIndex: number) => void;
  suggestingAssertionsCaseIndex?: number | null;
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
  onSuggestAssertions,
  suggestingAssertionsCaseIndex = null,
  saveDisabled = false,
}: PromptSetEditorProps) {
  function updateCase(
    index: number,
    updater: (caseItem: SaveScenarioCase) => SaveScenarioCase,
  ) {
    const cases = draft.cases.map((caseItem, caseIndex) =>
      caseIndex === index ? updater(caseItem) : caseItem,
    );
    onChange({ ...draft, cases });
  }

  function removeCase(index: number) {
    const nextCases =
      draft.cases.length === 1
        ? [createEmptyScenarioCase(mode)]
        : draft.cases.filter((_, caseIndex) => caseIndex !== index);
    onChange({ ...draft, cases: nextCases });
  }

  function updateAssertions(index: number, nextAssertions: ScenarioAssertion[]) {
    updateCase(index, (current) => ({ ...current, assertions: nextAssertions }));
  }

  const performanceEnabled = scenarioSupportsMode(draft, "performance");
  const triggerEnabled = scenarioSupportsMode(draft, "trigger");
  const performanceChecked = draft.tags.includes("both") || draft.tags.includes("performance");
  const triggerChecked = draft.tags.includes("both") || draft.tags.includes("trigger");

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
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
            placeholder={mode === "performance" ? "Regression" : "Routing checks"}
          />
        </div>

        <div className="space-y-2">
          <Label>Scenario modes</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={performanceChecked}
                onCheckedChange={(checked) =>
                  onChange({
                    ...draft,
                    tags: nextTags(draft, "performance", checked === true),
                  })
                }
              />
              <span>Performance</span>
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

        {draft.cases.map((caseItem, index) => (
          <div
            key={caseItem.id || `draft-case-${index}`}
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
                <Label htmlFor={`case-prompt-${mode}-${index}`}>User prompt</Label>
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

              {performanceEnabled ? (
                <div className="space-y-2">
                  <Label htmlFor={`case-expected-${mode}-${index}`}>
                    Expected outcome
                  </Label>
                  <Textarea
                    id={`case-expected-${mode}-${index}`}
                    value={caseItem.expectedOutcome ?? ""}
                    onChange={(event) =>
                      updateCase(index, (current) => ({
                        ...current,
                        expectedOutcome: event.target.value,
                      }))
                    }
                    placeholder="Describe the expected response or behavior."
                  />
                </div>
              ) : null}

              {triggerEnabled ? (
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
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Assertions</Label>
                  {performanceEnabled && onSuggestAssertions ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onSuggestAssertions(index)}
                      disabled={suggestingAssertionsCaseIndex === index}
                    >
                      <Sparkles className="mr-1 size-3.5" />
                      {suggestingAssertionsCaseIndex === index ? "Suggesting…" : "Suggest"}
                    </Button>
                  ) : null}
                </div>
                {caseItem.assertions.length > 0 ? (
                  <div className="space-y-2">
                    {caseItem.assertions.map((assertion, assertionIndex) => (
                      <div
                        key={`${caseItem.id}-assertion-${assertionIndex}`}
                        className="grid gap-2 rounded border p-2 md:grid-cols-[140px_1fr]"
                      >
                        <Input
                          value={assertion.type}
                          onChange={(event) => {
                            const next = [...caseItem.assertions];
                            next[assertionIndex] = {
                              ...assertion,
                              type: event.target.value,
                            };
                            updateAssertions(index, next);
                          }}
                          placeholder="contains"
                        />
                        <Input
                          value={assertion.value}
                          onChange={(event) => {
                            const next = [...caseItem.assertions];
                            next[assertionIndex] = {
                              ...assertion,
                              value: event.target.value,
                            };
                            updateAssertions(index, next);
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
        ))}

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...draft,
                cases: [...draft.cases, createEmptyScenarioCase(mode)],
              })
            }
          >
            <Plus className="mr-1 size-3.5" />
            Add case
          </Button>
          <Button size="sm" onClick={onSave} disabled={saveDisabled}>
            Save scenario
          </Button>
        </div>
      </div>
    </section>
  );
}
