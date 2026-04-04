export interface EvalQuery {
  id: string;
  query: string;
  should_trigger: boolean;
}

export interface OptimizationIteration {
  iteration: number;
  description: string;
  train_passed: number;
  train_total: number;
  test_passed: number | null;
  test_total: number | null;
}

export interface OptimizationResult {
  ok: boolean;
  best_description: string;
  original_description: string;
  best_score: string;
  best_train_score: string;
  best_test_score: string | null;
  iterations_run: number;
  history: OptimizationIteration[];
}

/**
 * Parse a description:progress event payload from the Tauri event system.
 * Returns null if the payload is not a valid progress event.
 */
export function parseProgressEvent(raw: unknown): OptimizationIteration | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Validate required fields
  if (
    typeof obj.iteration !== 'number' ||
    typeof obj.description !== 'string' ||
    typeof obj.train_passed !== 'number' ||
    typeof obj.train_total !== 'number'
  ) {
    return null;
  }

  // Validate test_passed and test_total (must be number or null)
  const testPassed = obj.test_passed;
  const testTotal = obj.test_total;

  if (
    (testPassed !== null && typeof testPassed !== 'number') ||
    (testTotal !== null && typeof testTotal !== 'number')
  ) {
    return null;
  }

  return {
    iteration: obj.iteration,
    description: obj.description,
    train_passed: obj.train_passed,
    train_total: obj.train_total,
    test_passed: (testPassed as number | null) ?? null,
    test_total: (testTotal as number | null) ?? null,
  };
}

/**
 * Returns new array with a blank query appended (immutable).
 * Generates a unique ID using crypto.randomUUID().
 */
export function addQuery(queries: EvalQuery[], shouldTrigger = true): EvalQuery[] {
  const newQuery: EvalQuery = {
    id: crypto.randomUUID(),
    query: '',
    should_trigger: shouldTrigger,
  };
  return [...queries, newQuery];
}

/**
 * Returns new array with the query matching id removed (immutable).
 * Returns the same array (by reference) if id is not found.
 */
export function removeQuery(queries: EvalQuery[], id: string): EvalQuery[] {
  const filtered = queries.filter((q) => q.id !== id);
  // Return same array reference if nothing was removed (immutable semantics)
  return filtered.length === queries.length ? queries : filtered;
}

/**
 * Returns new array with the query matching id updated (immutable).
 * Returns the same array if id is not found.
 */
export function updateQuery(
  queries: EvalQuery[],
  id: string,
  patch: Partial<Omit<EvalQuery, 'id'>>
): EvalQuery[] {
  const index = queries.findIndex((q) => q.id === id);
  if (index === -1) {
    return queries;
  }

  const updated = [...queries];
  updated[index] = {
    ...updated[index],
    ...patch,
  };
  return updated;
}

/** Compute score as a decimal (e.g. 3/8 → 0.38). Returns 0 when total is 0. */
export function scoreRate(passed: number, total: number): number {
  return total === 0 ? 0 : passed / total;
}

/** Format score rate as "0.XX" string. */
export function formatRate(passed: number, total: number): string {
  return scoreRate(passed, total).toFixed(2);
}

/**
 * Compute the delta between two iterations' test scores (or train if no test).
 * Returns null for the first iteration.
 */
export function scoreDelta(
  current: OptimizationIteration,
  previous: OptimizationIteration | null,
): number | null {
  if (!previous) return null;
  const curRate =
    current.test_passed !== null && current.test_total !== null
      ? scoreRate(current.test_passed, current.test_total)
      : scoreRate(current.train_passed, current.train_total);
  const prevRate =
    previous.test_passed !== null && previous.test_total !== null
      ? scoreRate(previous.test_passed, previous.test_total)
      : scoreRate(previous.train_passed, previous.train_total);
  return curRate - prevRate;
}

/** Format delta as "+0.12" or "−0.03". Returns "—" for null. */
export function formatDelta(delta: number | null): string {
  if (delta === null) return "—";
  const sign = delta >= 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(delta).toFixed(2)}`;
}

/** Find the index of the best iteration (highest test score, or train if no test). */
export function findBestIteration(history: OptimizationIteration[]): number {
  if (history.length === 0) return -1;
  let bestIdx = 0;
  let bestRate = -1;
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const rate =
      h.test_passed !== null && h.test_total !== null
        ? scoreRate(h.test_passed, h.test_total)
        : scoreRate(h.train_passed, h.train_total);
    if (rate > bestRate) {
      bestRate = rate;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Returns a Tailwind CSS color class for a score (0.0-1.0 or as passed/total).
 * High (>=80%): text-[var(--color-seafoam)] (brand seafoam via CSS variable)
 * Medium (>=60%): text-amber-600 dark:text-amber-400 (approved warning pattern)
 * Low (<60%): text-destructive (shadcn semantic destructive color)
 * Zero total edge case: text-muted-foreground (muted text for undefined)
 */
export function scoreColor(passed: number, total: number): string {
  if (total === 0) {
    return 'text-muted-foreground';
  }

  const percentage = (passed / total) * 100;

  if (percentage >= 80) {
    return 'text-[var(--color-seafoam)]';
  }

  if (percentage >= 60) {
    return 'text-amber-600 dark:text-amber-400';
  }

  return 'text-destructive';
}
