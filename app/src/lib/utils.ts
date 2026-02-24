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

/** Derive a human-readable label from a model ID string. */
export function deriveModelLabel(modelId: string): string {
  if (modelId.includes("haiku")) return "Haiku";
  if (modelId.includes("opus")) return "Opus";
  return "Sonnet";
}
