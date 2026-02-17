## Protocols

### Sub-agent Spawning
Use the Task tool. Launch ALL Task calls in the **same turn** so they run in parallel. Standard sub-agent config: `model: "sonnet"`, `mode: "bypassPermissions"`. Name sub-agents descriptively (e.g., `"writer-<topic>"`, `"reviewer"`, `"tester-N"`).

Sub-agents return their complete output as text — they do not write files. The **orchestrator** is responsible for writing all output files to disk. Include this directive in every sub-agent prompt:
> Do not provide progress updates. Return your complete output as text. Do not write files.

Exception: sub-agents that use the **Edit tool** to update an existing file in-place (e.g., inserting refinements into `clarifications.md`) may edit files directly since the orchestrator cannot relay Edit operations.
