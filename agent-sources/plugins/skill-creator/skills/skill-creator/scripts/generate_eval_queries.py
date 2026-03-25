#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Generate initial eval queries for a skill based on its description.

Takes a skill directory and generates a balanced set of eval queries
(mix of should_trigger: true/false) by calling `claude -p` as a subprocess.
Uses the session's Claude Code auth, no separate ANTHROPIC_API_KEY needed.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def emit_json(payload: dict) -> None:
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")


def _resolve_claude_cmd() -> list[str]:
    """Resolve the claude CLI to a runnable command list.

    On Windows, 'claude' is installed as 'claude.cmd' (npm global). Calling
    node + cli.js directly avoids cmd /c stdin-piping issues where the batch
    file wrapper interferes with stdin reaching the node process.
    """
    path = shutil.which("claude")
    if path is None:
        raise RuntimeError(
            "The `claude` CLI is not available on PATH. Install it or run this "
            "script in an environment where `claude` is available."
        )
    if sys.platform == "win32" and path.lower().endswith(".cmd"):
        # claude.cmd is a thin node wrapper. Call node + cli.js directly.
        npm_bin = Path(path).parent
        cli_js = npm_bin / "node_modules" / "@anthropic-ai" / "claude-code" / "cli.js"
        if cli_js.exists():
            node = shutil.which("node") or "node"
            return [node, str(cli_js)]
        # Fallback: cmd /c (may have stdin issues on some systems)
        return ["cmd", "/c", path]
    return [path]


def log(message: str) -> None:
    print(message, file=sys.stderr)


def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    content = (skill_path / "SKILL.md").read_text(encoding="utf-8")
    lines = content.splitlines()

    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md is missing frontmatter (expected opening `---`).")

    end_idx = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = index
            break

    if end_idx is None:
        raise ValueError("SKILL.md is missing frontmatter (expected closing `---`).")

    name = ""
    description = ""
    frontmatter_lines = lines[1:end_idx]
    idx = 0
    while idx < len(frontmatter_lines):
        line = frontmatter_lines[idx]
        if line.startswith("name:"):
            name = line[len("name:") :].strip().strip('"').strip("'")
        elif line.startswith("description:"):
            value = line[len("description:") :].strip()
            if value in {">", "|", ">-", "|-"}:
                continuation_lines: list[str] = []
                idx += 1
                while idx < len(frontmatter_lines) and (
                    frontmatter_lines[idx].startswith("  ") or frontmatter_lines[idx].startswith("\t")
                ):
                    continuation_lines.append(frontmatter_lines[idx].strip())
                    idx += 1
                description = " ".join(continuation_lines)
                continue
            description = value.strip('"').strip("'")
        idx += 1

    return name, description, content


def ensure_claude_available() -> None:
    if shutil.which("claude") is None:
        raise RuntimeError(
            "The `claude` CLI is not available on PATH. Install it or run this script in an environment where `claude` is available."
        )


def _call_claude(prompt: str, model: str | None, timeout: int = 300) -> str:
    """Run `claude -p` with the prompt on stdin and return the text response.

    Prompt goes over stdin (not argv) because it embeds the full SKILL.md
    body and can easily exceed comfortable argv length.
    """
    cmd = _resolve_claude_cmd() + ["-p", "--output-format", "text"]
    if model:
        cmd.extend(["--model", model])

    # Remove CLAUDECODE env var to allow nesting claude -p inside a
    # Claude Code session. The guard is for interactive terminal conflicts;
    # programmatic subprocess usage is safe. Same pattern as run_eval.py.
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

    result = subprocess.run(
        cmd,
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"claude -p exited {result.returncode}\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )
    return result.stdout


def generate_queries(
    skill_name: str,
    skill_description: str,
    skill_content: str,
    count: int,
    model: str,
) -> list[dict]:
    """Call Claude to generate eval queries for the skill."""
    prompt = f"""You are generating eval queries for a Claude Code skill called "{skill_name}".

A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description.

Here's the skill description:
<skill_description>
"{skill_description}"
</skill_description>

Skill content (for context on what the skill does):
<skill_content>
{skill_content}
</skill_content>

Generate {count} eval queries to test whether this skill's description correctly identifies when to invoke it. The queries should be a balanced mix:
- About 50% should_trigger: true (queries a user WOULD ask when wanting this skill)
- About 50% should_trigger: false (queries a user would NOT use this skill for)

Make the queries realistic and representative of how users might actually ask for this skill. Consider:
- Different phrasings and contexts
- Edge cases and boundary conditions
- Common variations in how users express the same intent

Respond ONLY with a JSON array in <eval_queries> tags, with no additional text before or after. Each entry should have "query" (string) and "should_trigger" (boolean):

<eval_queries>
[{{"query": "...", "should_trigger": true}}, {{"query": "...", "should_trigger": false}}, ...]
</eval_queries>
"""

    text = _call_claude(prompt, model)

    # Extract the eval_queries tag content
    match = re.search(r"<eval_queries>(.*?)</eval_queries>", text, re.DOTALL)
    if not match:
        raise ValueError(
            "Claude response did not contain <eval_queries> tags.\n"
            f"Response was:\n{text}"
        )

    json_str = match.group(1).strip()

    try:
        queries = json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Failed to parse JSON from <eval_queries> tags: {exc}\n"
            f"JSON was:\n{json_str}"
        )

    if not isinstance(queries, list):
        raise ValueError(
            f"Expected JSON array in <eval_queries>, got {type(queries).__name__}"
        )

    # Validate structure
    for i, q in enumerate(queries):
        if not isinstance(q, dict):
            raise ValueError(f"Query {i} is not a dict: {q}")
        if "query" not in q or "should_trigger" not in q:
            raise ValueError(
                f"Query {i} missing required fields 'query' or 'should_trigger': {q}"
            )
        if not isinstance(q["query"], str):
            raise ValueError(f"Query {i} 'query' is not a string: {q['query']}")
        if not isinstance(q["should_trigger"], bool):
            raise ValueError(
                f"Query {i} 'should_trigger' is not a boolean: {q['should_trigger']}"
            )

    return queries


def main():
    parser = argparse.ArgumentParser(
        description="Generate eval queries for a skill.",
        epilog=(
            "Examples:\n"
            "  uv run scripts/generate_eval_queries.py --skill-path ./my-skill --model sonnet\n"
            "  uv run scripts/generate_eval_queries.py --skill-path ./my-skill --model sonnet --count 30"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--model", default=None, help="Model for Claude (default: user's configured model)")
    parser.add_argument(
        "--count", type=int, default=20, help="Number of queries to generate (default: 20)"
    )
    parser.add_argument("--verbose", action="store_true", help="Print thinking to stderr")
    args = parser.parse_args()

    skill_path = Path(args.skill_path).resolve()
    if not (skill_path / "SKILL.md").exists():
        log(f"Error: No SKILL.md found at {skill_path}")
        emit_json(
            {
                "ok": False,
                "skill_path": str(skill_path),
                "error": f"No SKILL.md found at {skill_path}",
                "hint": "Pass --skill-path pointing at the skill directory.",
            }
        )
        sys.exit(1)

    try:
        ensure_claude_available()
        skill_name, skill_description, skill_content = parse_skill_md(skill_path)
    except (RuntimeError, ValueError, OSError) as exc:
        log(f"Error: {exc}")
        emit_json(
            {
                "ok": False,
                "skill_path": str(skill_path),
                "error": str(exc),
                "hint": "Ensure SKILL.md exists with valid frontmatter and `claude` CLI is installed.",
            }
        )
        sys.exit(1)

    if args.verbose:
        log(f"Skill: {skill_name}")
        log(f"Description: {skill_description}")
        log(f"Generating {args.count} queries...")

    try:
        queries = generate_queries(
            skill_name=skill_name,
            skill_description=skill_description,
            skill_content=skill_content,
            count=args.count,
            model=args.model,
        )
    except (RuntimeError, ValueError) as exc:
        log(f"Error: {exc}")
        emit_json(
            {
                "ok": False,
                "skill_path": str(skill_path),
                "error": str(exc),
                "hint": "Confirm Claude CLI auth is working, model is valid, and retry.",
            }
        )
        sys.exit(1)

    if args.verbose:
        log(f"Generated {len(queries)} queries")

    emit_json({"ok": True, "queries": queries})


if __name__ == "__main__":
    main()
