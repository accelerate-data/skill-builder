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
import type { IterationMeta, PendingEval, SkillSummary, ImportedSkill, TestCase } from "@/lib/types";
import { buildEvalGenPrompt, iterationLabel, truncatePrompt } from "@/lib/evals";
import { useAgentStore } from "@/stores/agent-store";
import { EvalForm } from "./eval-form";

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

  // Watch generation agent for completion / error
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

  async function handleGenerateEval() {
    if (!workspacePath || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const ctx = await readSkillContextForEvalGen(skillName, workspacePath);
      const prompt = buildEvalGenPrompt(ctx, skillName, workspacePath);
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
        "event=generate_eval status=started skill=%s agent_id=%s",
        skillName,
        agentId,
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
      // Convert PendingEval → TestCase (id=0, files=[]) for the form
      const asTestCase: TestCase = {
        id: 0,
        files: [],
        ...pending,
      };
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

  function openEdit(tc: TestCase) {
    setEditTarget(tc);
    setGeneratedEval(undefined);
    setFormOpen(true);
  }

  function handleFormClose() {
    setFormOpen(false);
    // Clean up pending file on discard (new eval only)
    if (generatedEval && workspacePath) {
      void discardPendingEval(skillName, workspacePath).catch(() => {
        // best-effort cleanup
      });
    }
    setGeneratedEval(undefined);
    setEditTarget(undefined);
  }

  async function handleSave(tc: TestCase) {
    if (!workspacePath) return;
    await saveTestCase(skillName, workspacePath, tc);
    // Clean up pending file after saving a generated eval
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
          <Button size="sm" onClick={handleGenerateEval} disabled={isGenerating}>
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
                Generating a new eval for &ldquo;{skillName}&rdquo;…
              </p>
              <p className="text-xs text-muted-foreground">
                Reading skill definition and crafting a test scenario.
              </p>
            </div>
          </div>
        )}

        {evals.length === 0 && !isGenerating ? (
          <EmptyState onGenerate={handleGenerateEval} isGenerating={isGenerating} />
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

      {/* Add/edit/review form */}
      <EvalForm
        open={formOpen}
        initial={editTarget ?? generatedEval}
        onClose={handleFormClose}
        onSave={handleSave}
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
