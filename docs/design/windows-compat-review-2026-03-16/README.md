# Windows Compatibility Review — 2026-03-16

Code review of the integration branch (`feature/vu-561-create-integration-branch-from-main-and-merge-jason_clone`) against `main`, focused exclusively on Windows compatibility. Standards defined in `.claude/rules/windows-compat.md`.

## Summary

| Area | Issues | Severity Breakdown |
|---|---|---|
| Rust backend | 7 | 2 High, 4 Medium, 1 Low |
| Sidecar / Frontend TS | 5 | 3 High, 1 Medium, 1 Low |
| E2E / Unit Tests | 6 | 1 High, 4 Medium, 1 Low |
| package.json scripts | 0 | Clean |

## HIGH Severity

### H-1: Unix signal handling in sidecar process management

**Files:** `app/src-tauri/src/agents/sidecar.rs`, `app/sidecar/run-agent.ts`

The Rust sidecar spawner and the sidecar's own shutdown logic rely on Unix signals (`SIGTERM`, `SIGKILL`) which do not exist on Windows.

**Rust side (`sidecar.rs`):** `child.kill().await?` in tokio is cross-platform, but any code that sends specific signals (SIGTERM for graceful shutdown before SIGKILL) has no Windows equivalent — Windows only has `TerminateProcess`.

**Sidecar side (`run-agent.ts`):**

```typescript
process.on('SIGTERM', () => { ... });
process.on('SIGINT', () => { ... });
```

`SIGTERM` is never emitted on Windows. The sidecar's graceful shutdown handler will never fire.

**Fix:** Add `'message'` or `'disconnect'` event handlers as a Windows-compatible shutdown signal. On the Rust side, consider using named pipes or stdin-close as the shutdown signal instead of relying on kill signals.

### H-2: Hardcoded `/tmp/` in Rust test code

**Files:** `app/src-tauri/src/commands/workflow/tests.rs`, `app/src-tauri/src/reconciliation/tests.rs`

```rust
let workspace = "/tmp/test-workspace";
let path = format!("/tmp/skill-builder-test/{}", uuid);
```

These tests will fail on Windows because `/tmp` does not exist.

**Fix:** Use `std::env::temp_dir()` to get the platform-appropriate temp directory:

```rust
let workspace = std::env::temp_dir().join("test-workspace");
```

### H-3: Hardcoded Unix paths in sidecar test assertions

**File:** `app/sidecar/__tests__/config.test.ts`

```typescript
expect(result.workspacePath).toBe("/tmp/skill-builder/workspace");
```

**Fix:**

```typescript
import path from "path";
import os from "os";
expect(result.workspacePath).toBe(path.join(os.tmpdir(), "skill-builder", "workspace"));
```

### H-4: `path.join` not used for path construction in sidecar

**Files:** `app/sidecar/run-agent.ts`, `app/sidecar/options.ts`

```typescript
const agentPath = `${agentsDir}/${agentName}.md`;
const workspaceDir = `${baseDir}/workspace`;
```

String template path construction breaks on Windows (produces mixed separators, wrong format).

**Fix:**

```typescript
const agentPath = path.join(agentsDir, `${agentName}.md`);
const workspaceDir = path.join(baseDir, "workspace");
```

### H-5: `tauri-e2e.ts` mock paths diverge from E2E helper paths

**File:** `app/src/test/mocks/tauri-e2e.ts` (lines 9-10, 74, 145)

```typescript
const E2E_SKILLS_PATH = "C:/skill-builder-test/skills";
const E2E_DEFAULT_SKILLS_PATH = "C:/skill-builder-test/default-skills";
// ...
package_skill: { file_path: "C:/skill-builder-test/package/my-skill.skill", size_bytes: 12345 },
export_skill: "C:/skill-builder-test/export/test-skill.zip",
```

The E2E helper paths in `app/e2e/helpers/test-paths.ts` were fixed in this branch to use `os.tmpdir()`, but the browser-side Tauri mock still hardcodes `C:/skill-builder-test`. Any E2E test that compares a path from `test-paths.ts` against a value returned by the tauri-e2e mock will see a mismatch on non-Windows platforms (and on Windows if tmpdir differs from `C:/`).

**Fix:** Derive these from `os.tmpdir()` using the same pattern as `test-paths.ts`, or define shared constants. Since this file runs in the browser context (no Node `path` module), the constants should be injected or shared with the E2E helpers.

### H-6: `.split("\n")` in production `eval-parser.ts`

**File:** `app/src/lib/eval-parser.ts` (lines 37, 44)

```typescript
lines: text.split("\n").map(parseEvalLine).filter((l) => l.text.length > 0),
lines: bulletSection.split("\n").map(parseEvalLine).filter((l) => l.text.length > 0),
```

This is **production code**, not test code. If eval output is read from a file with CRLF endings (common on Windows git defaults), the `\r` will be appended to line text, causing the direction-symbol detection regex to fail and display artifacts. The `parseEvalLine` function calls `.trim()` which strips `\r`, but this is fragile — the intermediate regex matching happens before trim.

**Fix:**

```typescript
lines: text.split(/\r?\n/).map(parseEvalLine).filter((l) => l.text.length > 0),
```

## MEDIUM Severity

### M-1: CRLF-unsafe string splits in sidecar

**Files:** `app/sidecar/message-processor.ts`, `app/sidecar/tool-summaries.ts`

```typescript
const lines = content.split("\n");
```

Windows git checkouts may produce CRLF line endings, causing trailing `\r` in parsed values.

**Fix:**

```typescript
const lines = content.split(/\r?\n/);
```

### M-2: CRLF-unsafe regex in Rust frontmatter parsing

**File:** `app/src-tauri/src/commands/workflow/prompt.rs`

```rust
let re = Regex::new(r"^---\n").unwrap();
content.split('\n')
```

If agent `.md` files are checked out with CRLF on Windows, the frontmatter parser will fail to find boundaries.

**Fix:**

```rust
let re = Regex::new(r"^---\r?\n").unwrap();
// Use a CRLF-aware split
content.split(&['\n', '\r'][..])
```

### M-3: `HOME` env var without `USERPROFILE` fallback

**File:** `app/sidecar/options.ts`

```typescript
const home = process.env.HOME;
```

On Windows, `HOME` is not set by default; `USERPROFILE` is the equivalent.

**Fix:**

```typescript
const home = process.env.HOME || process.env.USERPROFILE;
```

### M-4: Forward-slash path separators in E2E test helpers

**File:** `app/e2e/helpers/test-paths.ts`

```typescript
export const FIXTURES_DIR = `${__dirname}/../fixtures`;
```

While Node.js tolerates `/` on Windows in many cases, path assertions comparing against these values will fail if the system under test returns `\`-separated paths.

**Fix:** Use `path.resolve(__dirname, '..', 'fixtures')` for consistent normalized paths.

### M-5: Hardcoded `/home/user/` paths in refine test assertions

**File:** `app/src-tauri/src/commands/refine/tests.rs`

```rust
"/home/user/.vibedata/skill-builder",
assert_eq!(config.cwd, "/home/user/.vibedata/skill-builder");
```

These paths are used as inputs to `build_refine_config` and then asserted against. On Windows, `Path::new("/home/user/.vibedata/skill-builder")` normalizes differently — the leading `/` becomes part of the current drive, potentially causing assertion mismatches when the path flows through `Path::new(...).join(...)`.

**Fix:** Use `std::env::temp_dir()` combined with test-specific suffixes:

```rust
let ws = std::env::temp_dir().join("vibedata").join("skill-builder");
```

### M-6: Node.js resolver has no Windows candidate paths

**File:** `app/src-tauri/src/agents/node_resolver.rs` (lines 82-89)

```rust
let candidates: Vec<std::path::PathBuf> = {
    let mut v = vec![std::path::PathBuf::from("node")];
    for p in &[
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/bin/node",
    ] {
        v.push(std::path::PathBuf::from(p));
    }
    v
};
```

On Windows, only the bare `"node"` candidate (PATH lookup) works. The three hardcoded Unix paths silently fail, leaving Windows with one candidate while macOS/Linux get four. If `node` is not on PATH but is installed at a standard Windows location, it won't be found.

**Fix:** Add Windows-specific candidates behind `#[cfg(target_os = "windows")]`:

```rust
#[cfg(target_os = "windows")]
{
    v.push(std::path::PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
    v.push(std::path::PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"));
}
```

### M-7: `skillContextPath` uses raw `/` concatenation instead of `path.join`

**File:** `app/e2e/helpers/test-paths.ts` (line 25)

```typescript
export function skillContextPath(basePath: string, skillName: string, fileName: string): string {
  return `${basePath}/${skillName}/context/${fileName}`;
}
```

Other helpers in this file use `path.join(...).replace(/\\/g, "/")` via `joinE2ePath`. This function is inconsistent — if `basePath` contains a trailing backslash from `os.tmpdir()` on Windows, the result will have mixed separators.

**Fix:** Use the same normalization pattern:

```typescript
export function skillContextPath(basePath: string, skillName: string, fileName: string): string {
  return [basePath, skillName, "context", fileName].join("/");
}
```

### M-8: Hardcoded `/tmp` in sidecar test helpers

**Files:** `app/sidecar/__tests__/mock-agent.test.ts` (line 19), `app/sidecar/__tests__/persistent-mode.test.ts` (lines ~431, ~440)

```typescript
// mock-agent.test.ts
cwd: "/tmp/test",

// persistent-mode.test.ts
config: { prompt: "first prompt", apiKey: "sk-test", cwd: "/tmp" },
```

New test code added by this branch uses hardcoded `/tmp` paths. Violates `windows-compat.md` even if only used as mock values.

**Fix:** `path.join(os.tmpdir(), "test")` or use clearly synthetic placeholders like `"__TEST_CWD__"`.

### M-9: Hardcoded Unix paths across frontend unit tests

**Files:**

- `app/src/__tests__/hooks/use-test-orchestration.test.ts` — 11+ instances of `/tmp/test`, `/tmp/workspace`, `/tmp/with`, `/tmp/baseline`, `/tmp/logs`
- `app/src/__tests__/pages/workflow.test.tsx` — `/test/workspace`, `/test/skills` in mock readFile keys and settings
- `app/src/__tests__/pages/settings.test.tsx` — `/Users/test/Library/Application Support/...` (macOS-specific) and `/tmp/com.vibedata.skill-builder/skill-builder.log`

These are mock values that don't touch the filesystem today, but violate the project standard and will break if any code path starts normalizing or comparing these against OS-derived paths.

**Fix:** Define cross-platform test constants at the top of each file using `path.join(os.tmpdir(), ...)`, or use synthetic non-path placeholders.

### M-10: Rust `PathBuf` constructed from string with `/`

**File:** `app/src-tauri/src/commands/files.rs`

```rust
let target = base_dir.join(format!("skills/{}/SKILL.md", skill_name));
```

`PathBuf::join` handles this correctly on all platforms when given a relative path with `/`. However, if the resulting path is compared as a string or displayed to the user, it will show mixed separators on Windows. Normalize to chained joins:

```rust
let target = base_dir.join("skills").join(skill_name).join("SKILL.md");
```

## LOW Severity

### L-1: `chmod`-style file permissions in Rust (informational)

**File:** `app/src-tauri/src/commands/workflow/packaging.rs`

```rust
#[cfg(unix)]
std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;
```

Already gated with `#[cfg(unix)]` — correct. No Windows equivalent is provided. If the packaged output needs to be executable on Windows, a `.cmd`/`.bat` wrapper would be needed.

### L-2: CRLF byte-offset issue in `guards.rs` frontmatter parser

**File:** `app/src-tauri/src/commands/workflow/guards.rs` (lines 11-16)

```rust
let after_start = &content[3..];
let end = after_start.find("---")?;
let frontmatter = &after_start[..end];
for line in frontmatter.lines() {
```

`content[3..]` slices right after `---` and assumes the next character is `\n`. With CRLF endings, `after_start` starts with `\r\n...`. The subsequent `find("---")` still works and `.lines()` handles CRLF correctly, so this is benign in practice. For defense-in-depth:

```rust
let after_start = content[3..].trim_start_matches(['\r', '\n']);
```

### L-3: Unused `path` import in E2E specs

**Files:** `app/e2e/workflow/workflow-smoke.spec.ts`, `app/e2e/workflow/workflow-gate.spec.ts`

Both files import `path` from `node:path` but never use it, suggesting the author intended to use `path.join` but fell back to string concatenation. Dead import — not a compat issue itself, but a code smell indicating incomplete path normalization work.

## Already Compliant

- `package.json` scripts all use `cross-env` for env var injection
- `path-utils.ts` frontend helper uses `path` module correctly and normalizes backslashes to forward slashes
- `mock-agent.ts` correctly uses `.split(/\r?\n/)` (fixed in this branch)
- `options.ts` added `USERPROFILE` to the env allowlist (fixed in this branch)
- `sidecar_path.rs` correctly strips Windows UNC prefix (`\\?\`) and normalizes backslashes to forward slashes for Node.js consumption
- `sidecar_pool.rs` uses `creation_flags(0x08000000)` behind `#[cfg(target_os = "windows")]` for headless process spawning
- `node_resolver.rs` `find_git_bash()` properly gated with `#[cfg(target_os = "windows")]`, uses `where` command and standard Windows install paths
- `skill/tests.rs` gates `PermissionsExt` test with `#[cfg(unix)]`
- Production code in `prompt.rs` applies `.replace('\\', "/")` normalization after `Path::new(...).join(...)`, preventing backslash leakage into agent prompts
- `guards.rs` frontmatter parser uses Rust's `.lines()` which handles both `\n` and `\r\n` (low risk only from the byte-offset slicing, see L-2)
- Rust `PathBuf::join()` used in most production code paths

## Recommended Fix Priority

1. **H-1** (signal handling) — blocks sidecar graceful shutdown on Windows entirely
2. **H-6** (eval-parser CRLF) — production code, silent data corruption on Windows
3. **H-2 + H-3** (hardcoded `/tmp` in Rust/sidecar tests) — blocks test suite on Windows
4. **H-4** (template literal paths in sidecar) — breaks sidecar runtime on Windows
5. **H-5** (tauri-e2e mock path divergence) — breaks E2E tests on non-Windows platforms
6. **M-1 + M-2** (CRLF in sidecar/Rust parsers) — silent data corruption on Windows git checkouts
7. **M-3** (HOME fallback) — breaks workspace resolution on Windows
8. **M-6** (Node.js resolver candidates) — reduces Node.js discoverability on Windows
9. **M-7 through M-9** (test path hardcoding) — standards compliance debt, blocks future Windows CI
