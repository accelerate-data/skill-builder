import { debug, error, warn, type LogOptions } from "@tauri-apps/plugin-log";

type LogFields = Record<string, unknown>;

// Include common JS/TS variants (apiKey, api-key, apikey) in addition to api_key.
const REDACT_KEY_RE = /(token|password|secret|authorization|api[_-]?key|apikey)/i;

function sanitizeString(input: string): string {
  // Prevent log injection / multiline spam; keep it simple and deterministic.
  // Replace ASCII control chars (incl. newlines/tabs/esc) with spaces.
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 8_000);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 8) return "[REDACTED]";
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return "[REDACTED]";
  return "[REDACTED]";
}

function sanitizeUnknown(value: unknown, keyHint?: string, depth = 0, seen?: WeakSet<object>): unknown {
  const nextSeen = seen ?? new WeakSet<object>();

  if (keyHint && REDACT_KEY_RE.test(keyHint)) return redactValue(value);
  if (value == null) return value;

  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (value instanceof Error) {
    return {
      kind: "Error",
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (depth >= 6) return "[truncated]";

  if (typeof value === "object") {
    if (nextSeen.has(value as object)) return "[circular]";
    nextSeen.add(value as object);

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((v) => sanitizeUnknown(v, undefined, depth + 1, nextSeen));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeUnknown(v, k, depth + 1, nextSeen);
    }
    return out;
  }

  // symbol/function/unknown
  return sanitizeString(String(value));
}

function sanitizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = sanitizeUnknown(value, key, 0);
  }
  return out;
}

export function formatCause(cause: unknown): LogFields | undefined {
  if (!cause) return undefined;
  // Return the raw cause; emit() sanitization will handle Error/string/object safely (incl. redaction).
  return { cause };
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[circular]";
      seen.add(v);
    }
    if (typeof v === "bigint") return v.toString();
    return v;
  });
}

function emit(level: "debug" | "warn" | "error", message: string, fields?: LogFields, options?: LogOptions) {
  const payload = fields ? sanitizeFields(fields) : undefined;
  const line = payload
    ? `${sanitizeString(message)} ${sanitizeString(safeStringify(payload))}`
    : sanitizeString(message);

  // Fire-and-forget: logging must never block UX paths.
  if (level === "debug") void debug(line, options);
  else if (level === "warn") void warn(line, options);
  else void error(line, options);
}

export function logDebug(message: string, fields?: LogFields, options?: LogOptions) {
  emit("debug", message, fields, options);
}

export function logWarn(message: string, fields?: LogFields, options?: LogOptions) {
  emit("warn", message, fields, options);
}

export function logError(message: string, fields?: LogFields, options?: LogOptions) {
  emit("error", message, fields, options);
}

