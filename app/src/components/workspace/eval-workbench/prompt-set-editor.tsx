import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type SaveScenario } from "@/lib/eval-workbench";
import { formatElapsed } from "@/lib/utils";

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
  footerBar?: {
    tone: "idle" | "running" | "error";
    modelLabel?: string | null;
    startedAt?: number | null;
    message?: string | null;
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
  footerBar = null,
}: PromptSetEditorProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (footerBar?.tone !== "running" || !footerBar.startedAt) {
      return;
    }
    const id = window.setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(id);
  }, [footerBar?.startedAt, footerBar?.tone]);

  function updateExpectations(nextExpectations: string[]) {
    onChange({ ...draft, expectations: nextExpectations });
  }

  const footerBarElapsed =
    footerBar?.tone === "running" && footerBar.startedAt
      ? formatElapsed(Math.max(0, Date.now() - footerBar.startedAt))
      : null;

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
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Expectation {expectationIndex + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateExpectations(
                              draft.expectations.filter(
                                (_value, index) => index !== expectationIndex,
                              ),
                            )
                          }
                          aria-label={`Delete expectation ${expectationIndex + 1}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
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
                  No expectations yet. Add one or use Suggest.
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

      <div
        className="mt-4 flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4"
        data-testid="eval-suggest-status-bar"
      >
        <div className="flex items-center gap-1.5">
          <div
            className={
              footerBar?.tone === "running"
                ? "size-[5px] rounded-full animate-pulse"
                : footerBar?.tone === "error"
                  ? "size-[5px] rounded-full bg-destructive"
                  : "size-[5px] rounded-full bg-muted-foreground/40"
            }
            style={
              footerBar?.tone === "running"
                ? { background: "var(--color-pacific)" }
                : undefined
            }
          />
          <span className="text-xs text-muted-foreground/60">
            {footerBar?.tone === "running"
              ? "running…"
              : footerBar?.tone === "error"
                ? "error"
                : "ready"}
          </span>
        </div>

        {footerBar?.modelLabel ? (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground/60">
              {footerBar.modelLabel}
            </span>
          </>
        ) : null}

        {footerBarElapsed ? (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
              {footerBarElapsed}
            </span>
          </>
        ) : null}

        {footerBar?.tone === "error" && footerBar.message ? (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="truncate text-xs text-destructive/90">
              {footerBar.message}
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}
