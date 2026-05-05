import DatabaseConstructor from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  EvalHistoryEntry,
  EvalHistoryListItem,
  EvalHistoryListResult,
  EvalHistoryMetadata,
  EvalMode,
  ListEvalHistoryRequest,
  ReadEvalHistoryRequest,
  RunEvalRequest,
} from "./protocol.js";

const PROMPTFOO_DB_FILENAME = "promptfoo.db";
const DEFAULT_HISTORY_LIMIT = 20;
const HISTORY_SOURCE = "eval_workbench";

const TAG_NAMES = {
  source: "skill_builder_source",
  pluginSlug: "skill_builder_plugin_slug",
  skillName: "skill_builder_skill_name",
  scenarioName: "skill_builder_scenario_name",
  mode: "skill_builder_mode",
} as const;

type HistoryListRow = {
  evalId: string;
  createdAt: number;
  description: string | null;
  total: number;
  passed: number;
};

type HistoryTagRow = {
  evalId: string;
  name: string;
  value: string;
};

type HistoryEvalRow = {
  evalId: string;
  createdAt: number;
  description: string | null;
  config: string | null;
  total: number;
  passed: number;
};

type HistoryCaseRow = {
  testIdx: number;
  promptIdx: number;
  testCase: string;
  prompt: string;
  provider: string;
  success: number;
  score: number;
  response: string | null;
  error: string | null;
  latencyMs: number | null;
  cost: number | null;
  failureReason: string | number | null;
  gradingResult: string | null;
  metadata: string | null;
};

type SqliteDatabase = InstanceType<typeof DatabaseConstructor>;

export function buildEvalHistoryMetadata(
  request: Pick<RunEvalRequest, "pluginSlug" | "skillName" | "scenarioName" | "mode">,
): EvalHistoryMetadata {
  return {
    source: HISTORY_SOURCE,
    pluginSlug: request.pluginSlug,
    skillName: request.skillName,
    scenarioName: request.scenarioName,
    mode: request.mode,
  };
}

export function buildPromptfooHistoryTags(
  metadata: EvalHistoryMetadata,
): Record<string, string> {
  return {
    [TAG_NAMES.source]: metadata.source,
    [TAG_NAMES.pluginSlug]: metadata.pluginSlug,
    [TAG_NAMES.skillName]: metadata.skillName,
    [TAG_NAMES.scenarioName]: metadata.scenarioName,
    [TAG_NAMES.mode]: metadata.mode,
  };
}

export function listEvalHistory(
  filter: ListEvalHistoryRequest["filter"],
): EvalHistoryListResult {
  const dbPath = resolvePromptfooDbPath(filter.configDir);
  if (!existsSync(dbPath)) {
    return {
      items: [],
      limit: filter.limit ?? DEFAULT_HISTORY_LIMIT,
      offset: filter.offset ?? 0,
    };
  }

  const db = openDatabase(dbPath);
  try {
    const limit = filter.limit ?? DEFAULT_HISTORY_LIMIT;
    const offset = filter.offset ?? 0;
    const { clause, params } = buildEvalFilterClause(filter);
    const rows = db
      .prepare(
        `
          SELECT
            e.id AS evalId,
            e.created_at AS createdAt,
            e.description AS description,
            COUNT(r.id) AS total,
            COALESCE(SUM(CASE WHEN r.success = 1 THEN 1 ELSE 0 END), 0) AS passed
          FROM evals e
          LEFT JOIN eval_results r ON r.eval_id = e.id
          WHERE ${clause}
          GROUP BY e.id, e.created_at, e.description
          ORDER BY e.created_at DESC
          LIMIT ? OFFSET ?
        `,
      )
      .all(...params, limit, offset) as HistoryListRow[];

    const tagsByEvalId = readTagsForEvalIds(
      db,
      rows.map((row) => row.evalId),
    );

    return {
      items: rows.map((row) =>
        buildListItem(
          row,
          requireHistoryMetadata(tagsByEvalId.get(row.evalId), row.evalId),
        ),
      ),
      limit,
      offset,
    };
  } finally {
    db.close();
  }
}

export function readEvalHistory(
  request: ReadEvalHistoryRequest,
): EvalHistoryEntry {
  const dbPath = resolvePromptfooDbPath(request.configDir);
  if (!existsSync(dbPath)) {
    throw new Error(`Promptfoo history database not found at ${dbPath}`);
  }

  const db = openDatabase(dbPath);
  try {
    const evalRow = db
      .prepare(
        `
          SELECT
            e.id AS evalId,
            e.created_at AS createdAt,
            e.description AS description,
            e.config AS config,
            COUNT(r.id) AS total,
            COALESCE(SUM(CASE WHEN r.success = 1 THEN 1 ELSE 0 END), 0) AS passed
          FROM evals e
          LEFT JOIN eval_results r ON r.eval_id = e.id
          WHERE e.id = ?
            AND ${existsTagClause(TAG_NAMES.source)}
          GROUP BY e.id, e.created_at, e.description, e.config
        `,
      )
      .get(request.evalId, HISTORY_SOURCE) as HistoryEvalRow | undefined;

    if (!evalRow) {
      throw new Error(`Promptfoo eval run not found: ${request.evalId}`);
    }

    const tagsByEvalId = readTagsForEvalIds(db, [request.evalId]);
    const metadata = requireHistoryMetadata(
      tagsByEvalId.get(request.evalId),
      request.evalId,
    );
    const caseRows = db
      .prepare(
        `
          SELECT
            test_idx AS testIdx,
            prompt_idx AS promptIdx,
            test_case AS testCase,
            prompt AS prompt,
            provider AS provider,
            success AS success,
            score AS score,
            response AS response,
            error AS error,
            latency_ms AS latencyMs,
            cost AS cost,
            failure_reason AS failureReason,
            grading_result AS gradingResult,
            metadata AS metadata
          FROM eval_results
          WHERE eval_id = ?
          ORDER BY test_idx ASC, prompt_idx ASC
        `,
      )
      .all(request.evalId) as HistoryCaseRow[];

    return {
      ...buildListItem(evalRow, metadata),
      config: parseJsonRecord(evalRow.config),
      cases: caseRows.map((row) => {
        const testCase = parseJsonRecord(row.testCase);
        const prompt = parseJsonRecord(row.prompt);
        const provider = parseJsonRecord(row.provider);
        const metadataRecord = parseJsonRecord(row.metadata);
        const testCaseVars = isRecord(testCase?.vars) ? testCase.vars : undefined;

        return {
          caseId: readOptionalString(testCaseVars?.caseId),
          candidateId:
            readOptionalString(provider?.id) ??
            readOptionalString(testCaseVars?.candidateId),
          prompt:
            readOptionalString(testCaseVars?.prompt) ??
            readOptionalString(prompt?.raw) ??
            readOptionalString(prompt?.label),
          testIdx: row.testIdx,
          promptIdx: row.promptIdx,
          success: row.success === 1,
          score: row.score,
          response: parseJsonUnknown(row.response),
          error: readOptionalString(row.error),
          latencyMs: row.latencyMs ?? undefined,
          cost: row.cost ?? undefined,
          failureReason:
            row.failureReason === null ? undefined : row.failureReason,
          gradingResult: parseJsonUnknown(row.gradingResult),
          metadata: metadataRecord ?? undefined,
          providerId: readOptionalString(provider?.id),
          providerLabel: readOptionalString(provider?.label),
        };
      }),
    };
  } finally {
    db.close();
  }
}

export function resolvePromptfooDbPath(configDir: string): string {
  return resolve(configDir, PROMPTFOO_DB_FILENAME);
}

function openDatabase(dbPath: string): SqliteDatabase {
  const db = new DatabaseConstructor(dbPath, { readonly: true });
  db.pragma("foreign_keys = ON");
  return db;
}

function buildEvalFilterClause(filter: ListEvalHistoryRequest["filter"]): {
  clause: string;
  params: Array<string | number>;
} {
  const clauses = [
    "e.is_redteam = 0",
    existsTagClause(TAG_NAMES.source),
    existsTagClause(TAG_NAMES.pluginSlug),
    existsTagClause(TAG_NAMES.skillName),
  ];
  const params: Array<string | number> = [
    HISTORY_SOURCE,
    filter.pluginSlug,
    filter.skillName,
  ];

  if (filter.scenarioName) {
    clauses.push(existsTagClause(TAG_NAMES.scenarioName));
    params.push(filter.scenarioName);
  }
  if (filter.mode) {
    clauses.push(existsTagClause(TAG_NAMES.mode));
    params.push(filter.mode);
  }

  return {
    clause: clauses.join(" AND "),
    params,
  };
}

function existsTagClause(tagName: string): string {
  return `
    EXISTS (
      SELECT 1
      FROM evals_to_tags ett
      JOIN tags t ON t.id = ett.tag_id
      WHERE ett.eval_id = e.id
        AND t.name = '${tagName}'
        AND t.value = ?
    )
  `;
}

function readTagsForEvalIds(
  db: SqliteDatabase,
  evalIds: string[],
): Map<string, Record<string, string>> {
  const tagsByEvalId = new Map<string, Record<string, string>>();
  if (evalIds.length === 0) {
    return tagsByEvalId;
  }

  const placeholders = evalIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT
          ett.eval_id AS evalId,
          t.name AS name,
          t.value AS value
        FROM evals_to_tags ett
        JOIN tags t ON t.id = ett.tag_id
        WHERE ett.eval_id IN (${placeholders})
      `,
    )
    .all(...evalIds) as HistoryTagRow[];

  for (const row of rows) {
    const current = tagsByEvalId.get(row.evalId) ?? {};
    current[row.name] = row.value;
    tagsByEvalId.set(row.evalId, current);
  }

  return tagsByEvalId;
}

function requireHistoryMetadata(
  tags: Record<string, string> | undefined,
  evalId: string,
): EvalHistoryMetadata {
  if (!tags) {
    throw new Error(`Promptfoo eval run is missing tags: ${evalId}`);
  }

  const mode = tags[TAG_NAMES.mode];
  if (mode !== "performance" && mode !== "trigger") {
    throw new Error(`Promptfoo eval run has invalid mode tag: ${evalId}`);
  }

  return {
    source: HISTORY_SOURCE,
    pluginSlug: requireTagValue(tags, TAG_NAMES.pluginSlug, evalId),
    skillName: requireTagValue(tags, TAG_NAMES.skillName, evalId),
    scenarioName: requireTagValue(tags, TAG_NAMES.scenarioName, evalId),
    mode,
  };
}

function buildListItem(
  row: Pick<HistoryListRow, "evalId" | "createdAt" | "description" | "total" | "passed">,
  metadata: EvalHistoryMetadata,
): EvalHistoryListItem {
  return {
    evalId: row.evalId,
    createdAt: row.createdAt,
    description: readOptionalString(row.description),
    total: row.total,
    passed: row.passed,
    failed: row.total - row.passed,
    metadata,
  };
}

function requireTagValue(
  tags: Record<string, string>,
  name: string,
  evalId: string,
): string {
  const value = tags[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`Promptfoo eval run is missing ${name}: ${evalId}`);
}

function parseJsonRecord(
  value: string | null,
): Record<string, unknown> | undefined {
  const parsed = parseJsonUnknown(value);
  if (isRecord(parsed)) {
    return parsed;
  }
  return undefined;
}

function parseJsonUnknown(value: string | null): unknown {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
