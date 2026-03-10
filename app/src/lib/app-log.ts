import { debug, error, warn, type LogOptions } from "@tauri-apps/plugin-log";

type LogFields = Record<string, unknown>;

const REDACT_KEY_RE = /(token|password|secret|authorization|api_key)/i;

function sanitizeString(input: string): string {
  // Prevent log injection / multiline spam; keep it simple and deterministic.
  return input.replace(/[\r\n\t]/g, " ").slice(0, 8_000);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 8) return "[REDACTED]";
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return "[REDACTED]";
  return "[REDACTED]";
}

function sanitizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACT_KEY_RE.test(key)) {
      out[key] = redactValue(value);
      continue;
    }
    if (typeof value === "string") {
      out[key] = sanitizeString(value);
      continue;
    }
    if (value instanceof Error) {
      out[key] = {
        name: value.name,
        message: sanitizeString(value.message),
        stack: value.stack ? sanitizeString(value.stack) : undefined,
      };
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function formatCause(cause: unknown): LogFields | undefined {
  if (!cause) return undefined;
  if (cause instanceof Error) {
    return {
      kind: "Error",
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
    };
  }
  if (typeof cause === "string") return { kind: "string", message: cause };
  try {
    return { kind: typeof cause, value: safeStringify(cause) };
  } catch {
    return { kind: typeof cause, value: "[unstringifiable]" };
  }
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

