/**
 * Tool summary helpers.
 *
 * Computes human-readable one-line summaries for SDK tool calls,
 * used as `toolSummary` on DisplayItem objects.
 *
 * @module tool-summaries
 */

/**
 * Truncate a string to `max` characters, appending "..." if truncated.
 */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/**
 * Compute a human-readable one-line summary for a tool call.
 *
 * Covers common SDK tools (Read, Write, Edit, Bash, Grep, Glob, etc.)
 * and falls back to `name: <first string value>` or just the tool name.
 */
export function computeToolSummary(
  name: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return name;

  if (name === "Read" && input.file_path) {
    const path = String(input.file_path).split(/[/\\]/).pop();
    return `Reading ${path}`;
  }
  if (name === "Write" && input.file_path) {
    const path = String(input.file_path).split(/[/\\]/).pop();
    return `Writing ${path}`;
  }
  if (name === "Edit" && input.file_path) {
    const path = String(input.file_path).split(/[/\\]/).pop();
    return `Editing ${path}`;
  }
  if (name === "Bash" && input.command) {
    return `Running: ${truncate(String(input.command), 80)}`;
  }
  if (name === "Grep" && input.pattern) {
    const pattern = truncate(String(input.pattern), 40);
    const p = input.path ? ` in ${String(input.path).split(/[/\\]/).pop()}` : "";
    return `Grep: "${pattern}"${p}`;
  }
  if (name === "Glob" && input.pattern) {
    return `Glob: ${truncate(String(input.pattern), 50)}`;
  }
  if (name === "WebSearch" && input.query) {
    return `Web search: "${truncate(String(input.query), 60)}"`;
  }
  if (name === "WebFetch" && input.url) {
    return `Fetching: ${truncate(String(input.url), 70)}`;
  }
  if ((name === "Task" || name === "Agent") && input.description) {
    return `Agent: ${truncate(String(input.description), 60)}`;
  }
  if (name === "NotebookEdit" && input.notebook_path) {
    const path = String(input.notebook_path).split(/[/\\]/).pop();
    return `Editing notebook ${path}`;
  }
  if (name === "LS" && input.path) {
    return `Listing ${truncate(String(input.path), 50)}`;
  }

  // Fallback: tool name + first string value
  for (const val of Object.values(input)) {
    if (typeof val === "string" && val.length > 0) {
      return `${name}: ${truncate(val, 60)}`;
    }
  }
  return name;
}
