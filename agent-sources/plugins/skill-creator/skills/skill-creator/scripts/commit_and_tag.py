#!/usr/bin/env python3
"""
Commit skill files and create a version tag in the skills git repo.

Stages all changes, commits, and creates an auto-incrementing lightweight
tag of the form ``<skill-name>/v<N>`` on HEAD.

Usage:
    python -m scripts.commit_and_tag <skills_path> --skill-name <name>
    python -m scripts.commit_and_tag <skills_path> --skill-name <name> --message "custom msg"

Output (stdout):
    {"commit_sha": "abc123...", "tag": "my-skill/v1", "version": 1}

Exits non-zero on error with a message on stderr.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    """Run a git command and return the result."""
    return subprocess.run(
        ["git"] + args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )


def get_latest_version(skills_path: Path, skill_name: str) -> int:
    """Find the highest existing version tag for a skill. Returns 0 if none."""
    result = run_git(["tag", "--list", f"{skill_name}/v*"], skills_path)
    if result.returncode != 0:
        return 0

    max_version = 0
    prefix = f"{skill_name}/v"
    for line in result.stdout.strip().splitlines():
        tag = line.strip()
        if tag.startswith(prefix):
            suffix = tag[len(prefix):]
            if re.fullmatch(r"\d+", suffix):
                max_version = max(max_version, int(suffix))
    return max_version


def commit_and_tag(skills_path: Path, skill_name: str, message: str) -> dict:
    """Commit all changes and create the next version tag."""
    # Stage all changes
    result = run_git(["add", "-A"], skills_path)
    if result.returncode != 0:
        raise RuntimeError(f"git add failed: {result.stderr.strip()}")

    # Commit (may be a no-op if nothing changed)
    commit_result = run_git(["commit", "-m", message], skills_path)
    if commit_result.returncode != 0 and "nothing to commit" not in commit_result.stdout:
        raise RuntimeError(f"git commit failed: {commit_result.stderr.strip()}")

    # Get HEAD SHA
    sha_result = run_git(["rev-parse", "HEAD"], skills_path)
    if sha_result.returncode != 0:
        raise RuntimeError(f"git rev-parse failed: {sha_result.stderr.strip()}")
    commit_sha = sha_result.stdout.strip()

    # Determine next version
    current = get_latest_version(skills_path, skill_name)
    next_version = current + 1
    tag_name = f"{skill_name}/v{next_version}"

    # Create lightweight tag
    tag_result = run_git(["tag", tag_name], skills_path)
    if tag_result.returncode != 0:
        raise RuntimeError(f"git tag failed: {tag_result.stderr.strip()}")

    return {
        "commit_sha": commit_sha,
        "tag": tag_name,
        "version": next_version,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Commit skill files and create a version tag.",
    )
    parser.add_argument(
        "skills_path",
        type=Path,
        help="Root of the skills git repository",
    )
    parser.add_argument(
        "--skill-name",
        required=True,
        help="Skill slug (e.g. my-skill)",
    )
    parser.add_argument(
        "--message",
        default=None,
        help="Custom commit message (default: '<skill-name>: generate skill')",
    )
    args = parser.parse_args()

    skills_path = args.skills_path.resolve()
    skill_name = args.skill_name

    # Validate
    if not skills_path.is_dir():
        print(f"Error: skills_path does not exist: {skills_path}", file=sys.stderr)
        sys.exit(1)

    skill_md = skills_path / skill_name / "SKILL.md"
    if not skill_md.is_file():
        print(f"Error: SKILL.md not found at {skill_md}", file=sys.stderr)
        sys.exit(1)

    message = args.message or f"{skill_name}: generate skill"

    try:
        result = commit_and_tag(skills_path, skill_name, message)
        print(json.dumps(result))
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
