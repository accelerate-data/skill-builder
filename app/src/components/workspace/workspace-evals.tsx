import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
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
import { deleteTestCase, listIterations, listTestCases, saveTestCase } from "@/lib/tauri";
import type { IterationMeta, SkillSummary, ImportedSkill, TestCase } from "@/lib/types";
import { iterationLabel, truncatePrompt } from "@/lib/evals";
import { TestCaseForm } from "./test-case-form";

interface WorkspaceEvalsProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
}

export function WorkspaceEvals({ skill, workspacePath }: WorkspaceEvalsProps) {
  const skillName = "name" in skill ? skill.name : skill.skill_name;

  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [iterations, setIterations] = useState<IterationMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TestCase | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<TestCase | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      setTestCases(cases);
      setIterations(iters);
    } catch (err) {
      console.error("event=load_evals status=failure skill=%s error=%s", skillName, err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [skillName, workspacePath]);

  useEffect(() => { void load(); }, [load]);

  function openAdd() {
    setEditTarget(undefined);
    setFormOpen(true);
  }

  function openEdit(tc: TestCase) {
    setEditTarget(tc);
    setFormOpen(true);
  }

  async function handleSave(tc: TestCase) {
    if (!workspacePath) return;
    await saveTestCase(skillName, workspacePath, tc);
    console.log("event=save_test_case status=success skill=%s id=%s", skillName, tc.id);
    await load();
  }

  async function handleDelete() {
    if (!deleteTarget || !workspacePath) return;
    setDeleting(true);
    try {
      await deleteTestCase(skillName, workspacePath, deleteTarget.id);
      console.log("event=delete_test_case status=success skill=%s id=%s", skillName, deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      console.error("event=delete_test_case status=failure skill=%s id=%s error=%s", skillName, deleteTarget.id, err);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading test cases…
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
      {/* Test Cases section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Test Cases</h2>
            <p className="text-xs text-muted-foreground">
              Managed in <span className="font-mono">{skillName}/evals/evals.json</span>
            </p>
          </div>
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1.5 size-3.5" />
            Add test case
          </Button>
        </div>

        {testCases.length === 0 ? (
          <EmptyState onAdd={openAdd} />
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
            {testCases.map((tc) => (
              <TestCaseRow
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

      {/* Add/edit form */}
      <TestCaseForm
        open={formOpen}
        initial={editTarget}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete test case?</AlertDialogTitle>
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <p className="text-sm font-medium text-muted-foreground">No test cases yet</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Add test cases to define what your skill should do and how its output will be graded.
      </p>
      <Button size="sm" variant="outline" onClick={onAdd}>
        <Plus className="mr-1.5 size-3.5" />
        Add your first test case
      </Button>
    </div>
  );
}

interface TestCaseRowProps {
  tc: TestCase;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TestCaseRow({ tc, expanded, onToggle, onEdit, onDelete }: TestCaseRowProps) {
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
            title="Edit test case"
            aria-label="Edit test case"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete test case"
            aria-label="Delete test case"
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
            {tc.expected_output && (
              <div>
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">Expected Output</p>
                <p className="whitespace-pre-wrap text-sm">{tc.expected_output}</p>
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
