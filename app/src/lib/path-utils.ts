/**
 * Join path segments with forward slashes for Tauri IPC calls.
 * The Rust backend's Path::new() accepts forward slashes on all platforms,
 * so we normalize to '/' to avoid mixed-separator issues when the frontend
 * runs on Windows where base paths may contain backslashes.
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/[\\/]+$/, ""))
    .filter(Boolean)
    .join("/");
}
