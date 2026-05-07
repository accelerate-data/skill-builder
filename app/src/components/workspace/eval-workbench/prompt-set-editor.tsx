import { AlertTriangle, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type SaveScenario } from "@/lib/eval-workbench";

interface PromptSetEditorProps {
  draft: SaveScenario;
  onChange: (draft: SaveScenario) => void;
  onNew?: () => void;
  onSuggest?: () => void;
  onDelete?: () => void;
  suggestDisabled?: boolean;
  deleteDisabled?: boolean;
  showDelete?: boolean;
  showSuggest?: boolean;
  suggestBusy?: boolean;
  showNew?: boolean;
  footerStatus?: {
    tone: "running" | "error";
    message: string;
  } | null;
}

export function PromptSetEditor({
  draft,
  onChange,
  onNew,
  onSuggest,
  onDelete,
  suggestDisabled = false,
  deleteDisabled = false,
  showDelete = false,
  showSuggest = true,
  suggestBusy = false,
  showNew = true,
  footerStatus = null,
}: PromptSetEditorProps) {
  function updateAssertions(nextAssertions: string[]) {
    onChange({ ...draft, assertions: nextAssertions });
  }

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
          {showNew && onNew ? (
            <Button size="sm" variant="outline" onClick={onNew}>
              New scenario
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="scenario-name">Scenario name</Label>
          <Input
            id="scenario-name"
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="Regression"
          />
        </div>

        <div className="rounded-md border bg-background/70 p-3">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="scenario-prompt">User prompt</Label>
              <Textarea
                id="scenario-prompt"
                value={draft.prompt}
                onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
                placeholder="Describe the request to evaluate."
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Assertions</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateAssertions([...draft.assertions, ""])
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
                      className="rounded border p-2"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Assertion {assertionIndex + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateAssertions(
                              draft.assertions.filter(
                                (_value, index) => index !== assertionIndex,
                              ),
                            )
                          }
                          aria-label={`Delete assertion ${assertionIndex + 1}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      <Textarea
                        value={assertion}
                        onChange={(event) => {
                          const next = [...draft.assertions];
                          next[assertionIndex] = event.target.value;
                          updateAssertions(next);
                        }}
                        placeholder="Describe the assertion the answer should satisfy."
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No assertions yet. Add one or use Suggest.
                </p>
              )}
            </div>
          </div>
        </div>

      </div>

      {footerStatus ? (
        <div
          role={footerStatus.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            footerStatus.tone === "error"
              ? "mt-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              : "mt-4 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          }
        >
          {footerStatus.tone === "error" ? (
            <AlertTriangle className="size-3.5 shrink-0" />
          ) : (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          )}
          <span>{footerStatus.message}</span>
        </div>
      ) : null}

    </section>
  );
}
