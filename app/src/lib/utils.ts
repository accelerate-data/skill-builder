import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Validate kebab-case: lowercase alphanumeric segments separated by single hyphens */
export function isValidKebab(str: string): boolean {
  if (!str) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str);
}

/** Force input to kebab-case characters only (lowercase, digits, hyphens) */
export function toKebabChars(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-/, "");
}

/** Build intake JSON from optional form fields. Returns null if all fields are empty. */
export function buildIntakeJson(fields: Record<string, string>): string | null {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim();
    if (trimmed) data[key] = trimmed;
  }
  return Object.keys(data).length > 0 ? JSON.stringify(data) : null;
}

/** Format milliseconds as a human-readable elapsed string (e.g. "5s", "1m 23s"). */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/** Derive a human-readable label from a model ID string. */
export function deriveModelLabel(modelId: string): string {
  if (modelId.includes("haiku")) return "Haiku";
  if (modelId.includes("opus")) return "Opus";
  return "Sonnet";
}

/** Normalize a directory path returned by the file picker across macOS/Windows. */
export function normalizeDirectoryPickerPath(raw: string): string {
  const trimmed = raw.replace(/[\\/]+$/, "");
  if (!trimmed) return trimmed;

  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSep <= 0) return trimmed;

  const prevSep = Math.max(
    trimmed.lastIndexOf("/", lastSep - 1),
    trimmed.lastIndexOf("\\", lastSep - 1),
  );
  const previousSegment = trimmed.slice(prevSep + 1, lastSep);
  const lastSegment = trimmed.slice(lastSep + 1);

  if (previousSegment !== "" && previousSegment.toLowerCase() === lastSegment.toLowerCase()) {
    return trimmed.slice(0, lastSep);
  }

  return trimmed;
}
