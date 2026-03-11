Fixes VU-473

## Summary

- **Call sites**: All agent invocations (workflow steps, refine, answer-evaluator) now send only **skill name** and **workspace directory** in the prompt. The app writes `workspace_dir/.skill_output_dir` before each run with the skill output path; agents read it and derive `context_dir` as `workspace_dir/context`.
- **Agents**: Every agent doc states the SDK protocol (read user-context.md and .skill_output_dir first), derives paths, and uses consistent **scope guard** and **contradictory_inputs guard** wording.
- **Workspace CLAUDE.md**: Removed workflow-specific "Workflow Guard" and "Output Paths" sections; kept Identity, Domain Focus, User Context protocol, Execution Defaults, Delegation Policy.
- **Mock agent**: `parsePromptPaths` supports both legacy (explicit paths) and new (workspace only) formats; `resolvePromptPathsAsync` reads `.skill_output_dir` when needed.
- **Docs**: `docs/design/agent-specs/storage.md` updated to describe the SDK protocol and `.skill_output_dir`.

## Test notes

- `cargo test` (679 tests) and `cd app/sidecar && npx vitest run` (112 tests) pass.
- `npm run test:agents:structural`: 81 pass; 2 fail on plugin manifest (manifest.skills undefined), unrelated to this issue.
- Manual: run one workflow end-to-end with the new protocol; confirm agents receive correct context and produce valid output.
