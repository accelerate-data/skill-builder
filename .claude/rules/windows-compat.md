# Windows Compatibility Rules

These repo rules come from prior Windows CI regressions. Read before writing
path assertions, path construction, regexes over file content, `package.json`
scripts, shell invocations, or Rust CI configuration.

## Path Handling

- Use `path.join()` or `path.normalize()` in TypeScript tests and sidecar code.
- Do not assert hardcoded Unix paths such as `/tmp/...`.
- Rust string assertions that include paths must tolerate platform separators.

## Line Endings

- Regexes and frontmatter parsers that read files must tolerate CRLF.
- Prefer `split(/\r?\n/)`, `\r?\n`, or `[\r\n]+` when matching line boundaries.

## Package Scripts

- Do not use Unix env-prefix syntax in `package.json` scripts.
- Use `cross-env`; it is already available in `app/`.

## Rust Toolchain

- Do not set `RUSTUP_TOOLCHAIN` to a GNU target on Windows.
- Let Windows CI use the MSVC toolchain unless a task explicitly requires
  otherwise.
