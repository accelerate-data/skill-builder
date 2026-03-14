# Windows Compatibility Rules

Cross-platform code must avoid patterns that have caused Windows CI regressions in this repo. This file codifies the fixes from VU-453, VU-455, VU-477, VU-479, and VU-551.

## Path Handling

Always use `path.join()` or `path.normalize()` to construct and compare file paths. Never use hardcoded forward-slash strings or Unix-style literals (`/tmp/...`) in test assertions or path construction.

**Wrong:**

```ts
expect(result).toBe("/tmp/skill-builder/workspace");
const file = workspaceDir + "/output.json";
```

**Right:**

```ts
import path from "path";
expect(result).toBe(path.join(os.tmpdir(), "skill-builder", "workspace"));
const file = path.join(workspaceDir, "output.json");
```

This applies everywhere: test assertions, sidecar code, Rust string literals compared against paths, and Tauri command outputs.

## CRLF Safety

Regex patterns and frontmatter parsers must tolerate `\r\n` line endings. Windows git checkouts and cross-platform file reads may produce CRLF even when the repo uses LF.

**Pattern:**

- Replace `\n` anchors with `[\r\n]+` where line endings may vary.
- Strip `\r` before feeding content into parsers that only handle `\n`.
- Use `\r?\n` in regex literals that match end-of-line.

**Wrong:**

```ts
const lines = content.split("\n");
const match = content.match(/^---\n/m);
```

**Right:**

```ts
const lines = content.split(/\r?\n/);
const match = content.match(/^---\r?\n/m);
```

## Environment-Variable Injection

Do not use Unix prefix syntax (`VAR=value command`) in `package.json` scripts or shell invocations — `cmd.exe` does not recognise it. Use `cross-env` instead.

**Wrong (package.json):**

```json
"test:unit": "NODE_ENV=test vitest run"
```

**Right (package.json):**

```json
"test:unit": "cross-env NODE_ENV=test vitest run"
```

`cross-env` is already a dev dependency in `app/`. Add it to `app/sidecar/` if needed.

## Rust Toolchain

Do not set `RUSTUP_TOOLCHAIN` to a GNU target (`*-windows-gnu`) on Windows. GNU-compiled binaries crash at runtime with `STATUS_ENTRYPOINT_NOT_FOUND` because the MSVC C runtime is required on Windows. Always default to the MSVC toolchain for Windows test runs. Use `dtolnay/rust-toolchain@stable` without overriding the target unless explicitly required.
