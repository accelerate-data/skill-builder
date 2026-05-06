import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  EvalCaseResult,
  PersistedEvalRun,
  PersistedScenarioSnapshot,
} from "./protocol.js";

type EvalResultRow = {
  promptfooEvalId: string;
  createdAt: number;
  metadata: string | null;
  provider: string;
  response: string | null;
  error: string | null;
  success: number;
  score: number;
  gradingResult: string | null;
};

type HistoryMetadata = {
  pluginSlug: string;
  skillName: string;
  scenarioName: string;
  mode: "performance" | "trigger";
  runId: string;
  caseId: string;
  scenarioSnapshot?: PersistedScenarioSnapshot;
};

export type HistoryFilter = {
  promptfooConfigDir: string;
  pluginSlug: string;
  skillName: string;
  scenarioName?: string;
  mode: "performance" | "trigger";
  limit: number;
};

export function listCompletedRuns(filter: HistoryFilter): PersistedEvalRun[] {
  const dbPath = promptfooDbPath(filter.promptfooConfigDir);
  if (!existsSync(dbPath)) {
    return [];
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const evalIds = listMatchingEvalIds(db, filter);
    if (evalIds.length === 0) {
      return [];
    }

    const placeholders = evalIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT
           e.id AS promptfooEvalId,
           e.created_at AS createdAt,
           r.metadata AS metadata,
           r.provider AS provider,
           r.response AS response,
           r.error AS error,
           r.success AS success,
           r.score AS score,
           r.grading_result AS gradingResult
         FROM eval_results r
         INNER JOIN evals e ON e.id = r.eval_id
         WHERE e.id IN (${placeholders})
         ORDER BY e.created_at DESC, r.test_idx ASC, r.prompt_idx ASC`,
      )
      .all(...evalIds) as EvalResultRow[];

    return groupRows(rows);
  } finally {
    db.close();
  }
}

export function readCompletedRun(
  promptfooConfigDir: string,
  runId: string,
): PersistedEvalRun | null {
  const dbPath = promptfooDbPath(promptfooConfigDir);
  if (!existsSync(dbPath)) {
    return null;
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT
           e.id AS promptfooEvalId,
           e.created_at AS createdAt,
           r.metadata AS metadata,
           r.provider AS provider,
           r.response AS response,
           r.error AS error,
           r.success AS success,
           r.score AS score,
           r.grading_result AS gradingResult
         FROM eval_results r
         INNER JOIN evals e ON e.id = r.eval_id
         WHERE json_extract(r.metadata, '$.runId') = ?
         ORDER BY e.created_at DESC, r.test_idx ASC, r.prompt_idx ASC`,
      )
      .all(runId) as EvalResultRow[];

    return groupRows(rows).find((run) => run.id === runId) ?? null;
  } finally {
    db.close();
  }
}

function groupRows(rows: EvalResultRow[]): PersistedEvalRun[] {
  const runs = new Map<string, PersistedEvalRun>();

  for (const row of rows) {
    const metadata = parseJson<HistoryMetadata>(row.metadata);
    if (!metadata || !isHistoryMetadata(metadata)) {
      continue;
    }

    const existing = runs.get(metadata.runId);
    if (!existing) {
      runs.set(metadata.runId, {
        id: metadata.runId,
        promptfooEvalId: row.promptfooEvalId,
        pluginSlug: metadata.pluginSlug,
        skillName: metadata.skillName,
        scenarioName: metadata.scenarioName,
        mode: metadata.mode,
        status: "completed",
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          passRate: 0,
        },
        scenarioSnapshot: metadata.scenarioSnapshot,
        createdAt: new Date(row.createdAt).toISOString(),
        completedAt: new Date(row.createdAt).toISOString(),
        results: [],
      });
    }

    const run = runs.get(metadata.runId);
    if (!run) {
      continue;
    }
    if (run.promptfooEvalId !== row.promptfooEvalId) {
      continue;
    }

    const result = toCaseResult(row, metadata);
    run.results.push(result);
    run.summary.total += 1;
    if (result.passed) {
      run.summary.passed += 1;
    } else {
      run.summary.failed += 1;
    }
    run.summary.passRate =
      run.summary.total === 0 ? 0 : run.summary.passed / run.summary.total;
  }

  return Array.from(runs.values());
}

function toCaseResult(
  row: EvalResultRow,
  metadata: HistoryMetadata,
): EvalCaseResult {
  const provider = parseJson<{ id?: string }>(row.provider);
  const response = parseJson<{ output?: unknown }>(row.response);
  const gradingResult = parseJson<{ reason?: string }>(row.gradingResult);

  return {
    caseId: metadata.caseId,
    candidateId:
      typeof provider?.id === "string" && provider.id.length > 0
        ? provider.id
        : "unknown-candidate",
    passed: row.success !== 0,
    score: row.score,
    output: response?.output ?? null,
    reason: row.error ?? gradingResult?.reason,
  };
}

function promptfooDbPath(promptfooConfigDir: string): string {
  return join(promptfooConfigDir, "promptfoo.db");
}

function listMatchingEvalIds(
  db: InstanceType<typeof Database>,
  filter: HistoryFilter,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT
         e.id AS promptfooEvalId
       FROM evals e
       INNER JOIN eval_results r ON e.id = r.eval_id
       WHERE json_extract(r.metadata, '$.pluginSlug') = ?
         AND json_extract(r.metadata, '$.skillName') = ?
         AND (? = '' OR json_extract(r.metadata, '$.scenarioName') = ?)
         AND json_extract(r.metadata, '$.mode') = ?
       ORDER BY e.created_at DESC
       LIMIT ?`,
    )
    .all(
      filter.pluginSlug,
      filter.skillName,
      filter.scenarioName ?? "",
      filter.scenarioName ?? "",
      filter.mode,
      filter.limit,
    ) as Array<{ promptfooEvalId: string }>;

  return rows.map((row) => row.promptfooEvalId);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isHistoryMetadata(value: HistoryMetadata): boolean {
  return (
    typeof value.pluginSlug === "string" &&
    typeof value.skillName === "string" &&
    typeof value.scenarioName === "string" &&
    (value.mode === "performance" || value.mode === "trigger") &&
    typeof value.runId === "string" &&
    typeof value.caseId === "string"
  );
}
