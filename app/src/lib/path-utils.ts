/**
 * Join path segments with forward slashes for Tauri IPC calls.
 * The Rust backend's Path::new() accepts forward slashes on all platforms,
 * so we normalize to '/' to avoid mixed-separator issues when the frontend
 * runs on Windows where base paths may contain backslashes.
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/[\\/]+$/, "").replace(/\\/g, "/"))
    .filter(Boolean)
    .join("/");
}

/**
 * Strip the first path segment from a diff path (e.g. "a/SKILL.md" → "SKILL.md").
 * Git diff paths typically include a prefix directory; this normalizes them
 * to the relative workspace path.
 */
export function normalizeDiffPath(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : path;
}
