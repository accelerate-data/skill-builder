import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  deleteTestCase,
  discardPendingEval,
  listIterations,
  listTestCases,
  readPendingEval,
  readSkillContextForEvalGen,
  saveTestCase,
  startAgent,
} from "@/lib/tauri";
import type { IterationMeta, PendingEval, SkillEvalContext, SkillSummary, ImportedSkill, TestCase } from "@/lib/types";
import {
  buildEvalGenPrompt,
  buildRegenPrompt,
  iterationLabel,
  suggestEvalPlaceholder,
  truncatePrompt,
} from "@/lib/evals";
import { useAgentStore } from "@/stores/agent-store";
import { EvalForm } from "./eval-form";
import { EvalIntentDialog } from "./eval-intent-dialog";

const EVAL_GEN_MODEL = "claude-sonnet-4-6";

interface WorkspaceEvalsProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
}

export function WorkspaceEvals({ skill, workspacePath }: WorkspaceEvalsProps) {
  const skillName = "name" in skill ? skill.name : skill.skill_name;

  const [evals, setEvals] = useState<TestCase[]>([]);
  const [iterations, setIterations] = useState<IterationMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TestCase | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<TestCase | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Eval generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationAgentId, setGenerationAgentId] = useState<string | null>(null);
  const [generatedEval, setGeneratedEval] = useState<TestCase | undefined>(undefined);
  const [draftIntent, setDraftIntent] = useState("");

  // Intent dialog state
  const [intentOpen, setIntentOpen] = useState(false);
  const [evalPlaceholder, setEvalPlaceholder] = useState("e.g. a user runs a typical workflow end-to-end");
  const [skillCtx, setSkillCtx] = useState<SkillEvalContext | null>(null);

  // Re-generation state
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenAgentId, setRegenAgentId] = useState<string | null>(null);

  // Queue state
  const [evalQueue, setEvalQueue] = useState<TestCase[]>([]);
  const [queueSelected, setQueueSelected] = useState<Set<string>>(new Set());

  const runs = useAgentStore((s) => s.runs);

  // --- Actions ---

  const load = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const [cases, iters] = await Promise.all([
        listTestCases(skillName, workspacePath),
        listIterations(skillName, workspacePath),
      ]);
      setEvals(cases);
      setIterations(iters);
    } catch (err) {
      console.error("event=load_evals status=failure skill=%s error=%s", skillName, err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [skillName, workspacePath]);

  useEffect(() => { void load(); }, [load]);

  // Watch primary generation agent for completion / error
  useEffect(() => {
    if (!generationAgentId) return;
    const run = runs[generationAgentId];
    if (!run) return;

    if (run.status === "completed") {
      void handleGenerationComplete();
    } else if (run.status === "error" || run.status === "shutdown") {
      console.error(
        "event=generate_eval status=failure skill=%s agent_id=%s",
        skillName,
        generationAgentId,
      );
      setIsGenerating(false);
      setGenerationAgentId(null);
      setError("Eval generation failed. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, generationAgentId]);

  // Watch re-generation agent for completion / error
  useEffect(() => {
    if (!regenAgentId) return;
    const run = runs[regenAgentId];
    if (!run) return;

    if (run.status === "completed") {
      void handleRegenComplete();
    } else if (run.status === "error" || run.status === "shutdown") {
      console.error(
        "event=regen_eval status=failure skill=%s agent_id=%s",
        skillName,
        regenAgentId,
      );
      setIsRegenerating(false);
      setRegenAgentId(null);
      setError("Re-generation failed. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, regenAgentId]);

  async function handleOpenIntentDialog() {
    if (!workspacePath || isGenerating || isRegenerating) return;
    try {
      const ctx = await readSkillContextForEvalGen(skillName, workspacePath);
      setSkillCtx(ctx);
      setEvalPlaceholder(suggestEvalPlaceholder(ctx.skill_content));
    } catch {
      // Open with default placeholder if context read fails
    }
    setIntentOpen(true);
  }

  async function handleGenerateEval(userIntent: string) {
    if (!workspacePath || !skillCtx) return;
    setIsGenerating(true);
    setDraftIntent(userIntent);
    setError(null);
    try {
      // Include queued evals in existing context to avoid duplication
      const ctxWithQueue: SkillEvalContext = {
        ...skillCtx,
        existing_evals: [...skillCtx.existing_evals, ...evalQueue],
      };
      const prompt = buildEvalGenPrompt(ctxWithQueue, skillName, workspacePath, userIntent);
      const agentId = crypto.randomUUID();
      const cwd = `${workspacePath}/${skillName}`;

      await startAgent(
        agentId,
        prompt,
        EVAL_GEN_MODEL,
        cwd,
        ["Write"],
        10,
        undefined,
        undefined,
        "skill-evals-generator",
        "generate-eval",
        undefined,
        undefined,
        undefined,
        undefined,
        `synthetic:evals:${skillName}`,
        "test",
      );

      useAgentStore.getState().registerRun(
        agentId,
        EVAL_GEN_MODEL,
        skillName,
        "test",
        `synthetic:evals:${skillName}`,
      );

      setGenerationAgentId(agentId);
      console.log(
        "event=generate_eval status=started skill=%s agent_id=%s intent=%s",
        skillName,
        agentId,
        userIntent,
      );
    } catch (err) {
      console.error("event=generate_eval status=failure skill=%s error=%s", skillName, err);
      setIsGenerating(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleGenerationComplete() {
    if (!workspacePath) return;
    try {
      const pending: PendingEval = await readPendingEval(skillName, workspacePath);
      const asTestCase: TestCase = { id: 0, files: [], ...pending };
      setGeneratedEval(asTestCase);
      setFormOpen(true);
      console.log(
        "event=generate_eval status=completed skill=%s eval_name=%s",
        skillName,
        pending.eval_name,
      );
    } catch (err) {
      console.error(
        "event=generate_eval status=read_failure skill=%s error=%s",
        skillName,
        err,
      );
      setError("Generation succeeded but could not read the result. Please try again.");
    } finally {
      setIsGenerating(false);
      setGenerationAgentId(null);
    }
  }

  async function handleRegenerate(newIntent: string) {
    if (!workspacePath || !skillCtx || isRegenerating) return;
    setIsRegenerating(true);
    setDraftIntent(newIntent);
    setError(null);
    try {
      // Discard existing pending-eval.json so the agent can create it fresh
      // (Write tool requires the file not to exist, or to have been read first in the same session)
      await discardPendingEval(skillName, workspacePath);
      const prompt = buildRegenPrompt(newIntent, skillCtx.skill_content, skillName, workspacePath);
      const agentId = crypto.randomUUID();
      const cwd = `${workspacePath}/${skillName}`;

      await startAgent(
        agentId,
        prompt,
        EVAL_GEN_MODEL,
        cwd,
        ["Write"],
        10,
        undefined,
        undefined,
        "skill-evals-generator",
        "regen-eval",
        undefined,
        undefined,
        undefined,
        undefined,
        `synthetic:evals:${skillName}`,
        "test",
      );

      useAgentStore.getState().registerRun(
        agentId,
        EVAL_GEN_MODEL,
        skillName,
        "test",
        `synthetic:evals:${skillName}`,
      );

      setRegenAgentId(agentId);
      console.log(
        "event=regen_eval status=started skill=%s agent_id=%s intent=%s",
        skillName,
        agentId,
        newIntent,
      );
    } catch (err) {
      console.error("event=regen_eval status=failure skill=%s error=%s", skillName, err);
      setIsRegenerating(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRegenComplete() {
    if (!workspacePath) return;
    try {
      const pending: PendingEval = await readPendingEval(skillName, workspacePath);
      const asTestCase: TestCase = { id: 0, files: [], ...pending };
      setGeneratedEval(asTestCase);
      console.log(
        "event=regen_eval status=completed skill=%s eval_name=%s",
        skillName,
        pending.eval_name,
      );
    } catch (err) {
      console.error(
        "event=regen_eval status=read_failure skill=%s error=%s",
        skillName,
        err,
      );
      setError("Re-generation succeeded but could not read the result. Please try again.");
    } finally {
      setIsRegenerating(false);
      setRegenAgentId(null);
    }
  }

  function handleQueue() {
    if (!generatedEval || !workspacePath) return;
    // Add to queue with unique temp slug key
    const queued = { ...generatedEval };
    setEvalQueue((prev) => [...prev, queued]);
    setQueueSelected((prev) => new Set([...prev, queued.slug]));
    void discardPendingEval(skillName, workspacePath).catch(() => {});
    setGeneratedEval(undefined);
    setFormOpen(false);
    // Re-open intent dialog for next eval
    void handleOpenIntentDialog();
    console.log(
      "event=queue_eval status=queued skill=%s eval_name=%s queue_size=%d",
      skillName,
      queued.eval_name,
      evalQueue.length + 1,
    );
  }

  async function handleAddSelected() {
    if (!workspacePath) return;
    const toAdd = evalQueue.filter((q) => queueSelected.has(q.slug));
    for (const tc of toAdd) {
      await saveTestCase(skillName, workspacePath, { ...tc, id: 0 });
      console.log("event=save_eval status=success skill=%s eval_name=%s", skillName, tc.eval_name);
    }
    setEvalQueue([]);
    setQueueSelected(new Set());
    await load();
  }

  function handleDiscardQueue() {
    setEvalQueue([]);
    setQueueSelected(new Set());
  }

  function toggleQueueItem(slug: string) {
    setQueueSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function openEdit(tc: TestCase) {
    setEditTarget(tc);
    setGeneratedEval(undefined);
    setFormOpen(true);
  }

  function handleFormClose() {
    setFormOpen(false);
    if (generatedEval && workspacePath) {
      void discardPendingEval(skillName, workspacePath).catch(() => {});
    }
    setGeneratedEval(undefined);
    setEditTarget(undefined);
  }

  async function handleSave(tc: TestCase) {
    if (!workspacePath) return;
    await saveTestCase(skillName, workspacePath, tc);
    if (generatedEval && tc.id === 0) {
      await discardPendingEval(skillName, workspacePath).catch(() => {});
    }
    console.log("event=save_eval status=success skill=%s id=%s", skillName, tc.id);
    await load();
  }

  async function handleDelete() {
    if (!deleteTarget || !workspacePath) return;
    setDeleting(true);
    try {
      await deleteTestCase(skillName, workspacePath, deleteTarget.id);
      console.log("event=delete_eval status=success skill=%s id=%s", skillName, deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      console.error(
        "event=delete_eval status=failure skill=%s id=%s error=%s",
        skillName,
        deleteTarget.id,
        err,
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading evals…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={load}>Retry</Button>
      </div>
    );
  }

  const latestIteration = iterations[0]?.iteration ?? 0;
  const selectedCount = queueSelected.size;

  return (
    <div className="flex flex-col gap-6">
      {/* Evals section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Evals</h2>
            <p className="text-xs text-muted-foreground">
              Managed in <span className="font-mono">{skillName}/evals/evals.json</span>
            </p>
          </div>
          <Button size="sm" onClick={handleOpenIntentDialog} disabled={isGenerating || isRegenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 size-3.5" />
                Generate eval
              </>
            )}
          </Button>
        </div>

        {/* Generation banner */}
        {isGenerating && (
          <div
            className="mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "color-mix(in oklch, var(--color-pacific), transparent 70%)", background: "color-mix(in oklch, var(--color-pacific), transparent 92%)" }}
          >
            <Sparkles
              className="mt-0.5 size-4 shrink-0"
              style={{ color: "var(--color-pacific)" }}
            />
            <div>
              <p className="font-medium" style={{ color: "var(--color-pacific)" }}>
                Generating eval for &ldquo;{draftIntent || skillName}&rdquo;…
              </p>
              <p className="text-xs text-muted-foreground">
                Reading skill definition and crafting a test scenario.
              </p>
            </div>
          </div>
        )}

        {/* Queue banner */}
        {evalQueue.length > 0 && (
          <div className="mb-4 rounded-lg border" style={{ borderColor: "color-mix(in oklch, var(--color-pacific), transparent 72%)" }}>
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ background: "color-mix(in oklch, var(--color-pacific), transparent 92%)" }}
            >
              <Badge
                className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ background: "var(--color-pacific)" }}
              >
                {evalQueue.length}
              </Badge>
              <span className="text-sm font-medium" style={{ color: "var(--color-pacific)" }}>
                Pending evals — ready to add
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-destructive border-destructive hover:bg-destructive/10"
                  onClick={handleDiscardQueue}
                >
                  Discard all
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={selectedCount === 0}
                  onClick={() => void handleAddSelected()}
                >
                  Add selected ({selectedCount})
                </Button>
              </div>
            </div>
            <div className="divide-y">
              {evalQueue.map((q) => (
                <div key={q.slug} className="flex items-start gap-3 bg-card px-3 py-2">
                  <Checkbox
                    checked={queueSelected.has(q.slug)}
                    onCheckedChange={() => toggleQueueItem(q.slug)}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{q.eval_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      ↳ {q.expectations[0] ?? "—"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {evals.length === 0 && !isGenerating ? (
          <EmptyState onGenerate={handleOpenIntentDialog} isGenerating={isGenerating} />
        ) : (
          <div className="flex flex-col gap-2">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_2fr_auto_auto] items-center gap-4 px-3 pb-1">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <span className="text-xs font-medium text-muted-foreground">Prompt</span>
              <span className="text-xs font-medium text-muted-foreground">Assertions</span>
              <span className="sr-only">Actions</span>
            </div>
            <Separator />
            {evals.map((tc) => (
              <EvalRow
                key={tc.id}
                tc={tc}
                expanded={expandedId === tc.id}
                onToggle={() => setExpandedId(expandedId === tc.id ? null : tc.id)}
                onEdit={() => openEdit(tc)}
                onDelete={() => setDeleteTarget(tc)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Iteration History section */}
      {iterations.length > 0 && (
        <>
          <Separator />
          <section>
            <h2 className="mb-3 text-base font-semibold tracking-tight">Iteration History</h2>
            <div className="flex flex-col gap-1">
              {iterations.map((iter) => (
                <div
                  key={iter.iteration}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    iteration-{iter.iteration}
                  </span>
                  <Badge
                    variant="secondary"
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                  >
                    {iterationLabel(iter.iteration, latestIteration)}
                  </Badge>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Intent dialog */}
      <EvalIntentDialog
        open={intentOpen}
        placeholder={evalPlaceholder}
        onGenerate={(userIntent) => {
          setIntentOpen(false);
          void handleGenerateEval(userIntent);
        }}
        onCancel={() => setIntentOpen(false)}
      />

      {/* Add/edit/review form */}
      <EvalForm
        open={formOpen}
        initial={editTarget ?? generatedEval}
        intent={generatedEval ? draftIntent : undefined}
        isRegenerating={isRegenerating}
        onClose={handleFormClose}
        onSave={handleSave}
        onRegenerate={(newIntent) => void handleRegenerate(newIntent)}
        onQueue={generatedEval ? handleQueue : undefined}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete eval?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.eval_name}&rdquo; will be permanently removed from evals.json.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Sub-components ---

function EmptyState({ onGenerate, isGenerating }: { onGenerate: () => void; isGenerating: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <Sparkles className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium text-muted-foreground">No evals yet</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Generate your first eval to define what &ldquo;success&rdquo; looks like for this skill.
      </p>
      <Button size="sm" variant="outline" onClick={onGenerate} disabled={isGenerating}>
        <Sparkles className="mr-1.5 size-3.5" />
        Generate your first eval
      </Button>
    </div>
  );
}

interface EvalRowProps {
  tc: TestCase;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function EvalRow({ tc, expanded, onToggle, onEdit, onDelete }: EvalRowProps) {
  return (
    <div className="rounded-lg border bg-card transition-shadow duration-150 hover:shadow-sm">
      {/* Summary row */}
      <div className="grid grid-cols-[1fr_2fr_auto_auto] items-center gap-4 px-3 py-2.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">{tc.eval_name}</span>
        </button>
        <span className="truncate text-sm text-muted-foreground">
          {truncatePrompt(tc.prompt) || "—"}
        </span>
        <Badge
          variant="secondary"
          className="rounded-full px-2 py-0.5 text-xs font-medium"
        >
          {tc.expectations.length} assertion{tc.expectations.length !== 1 ? "s" : ""}
        </Badge>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onEdit}
            title="Edit eval"
            aria-label="Edit eval"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete eval"
            aria-label="Delete eval"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-4 py-3">
          <div className="flex flex-col gap-3">
            {tc.slug && (
              <div>
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">Slug</p>
                <p className="font-mono text-xs">{tc.slug}</p>
              </div>
            )}
            {tc.prompt && (
              <div>
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">Prompt</p>
                <p className="whitespace-pre-wrap text-sm">{tc.prompt}</p>
              </div>
            )}
            {tc.expectations.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Expectations</p>
                <ul className="flex flex-col gap-1">
                  {tc.expectations.map((exp, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span>{exp}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
