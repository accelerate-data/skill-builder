#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "PyYAML>=6.0",
# ]
# ///
"""Quickly validate a skill's SKILL.md frontmatter and naming conventions."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

ALLOWED_PROPERTIES = {
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
    "compatibility",
}


def emit_json(payload: dict) -> None:
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")


def log(message: str) -> None:
    print(message, file=sys.stderr)


def validate_skill(skill_path: Path) -> tuple[bool, str]:
    """Basic validation of a skill."""
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, f"SKILL.md not found in {skill_path}"

    content = skill_md.read_text(encoding="utf-8")
    if not content.startswith("---"):
        return False, "SKILL.md is missing YAML frontmatter opening markers (`---`)."

    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return False, "SKILL.md frontmatter is malformed. Check the opening and closing `---` markers."

    try:
        frontmatter = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        return False, f"Frontmatter YAML is invalid: {exc}"

    if not isinstance(frontmatter, dict):
        return False, "Frontmatter must parse to a YAML mapping."

    unexpected_keys = set(frontmatter.keys()) - ALLOWED_PROPERTIES
    if unexpected_keys:
        return False, (
            f"Unexpected frontmatter keys: {', '.join(sorted(unexpected_keys))}. "
            f"Allowed keys: {', '.join(sorted(ALLOWED_PROPERTIES))}."
        )

    if "name" not in frontmatter:
        return False, "Missing required `name` field in frontmatter."
    if "description" not in frontmatter:
        return False, "Missing required `description` field in frontmatter."

    name = frontmatter.get("name", "")
    if not isinstance(name, str):
        return False, f"`name` must be a string, got {type(name).__name__}."
    name = name.strip()
    if not re.match(r"^[a-z0-9-]+$", name):
        return False, f"`name` must be kebab-case. Found: {name!r}."
    if name.startswith("-") or name.endswith("-") or "--" in name:
        return False, f"`name` cannot start/end with `-` or contain `--`. Found: {name!r}."
    if len(name) > 64:
        return False, f"`name` is {len(name)} characters. Maximum length is 64."

    description = frontmatter.get("description", "")
    if not isinstance(description, str):
        return False, f"`description` must be a string, got {type(description).__name__}."
    description = description.strip()
    if "<" in description or ">" in description:
        return False, "`description` cannot contain angle brackets."
    if len(description) > 1024:
        return False, f"`description` is {len(description)} characters. Maximum length is 1024."

    compatibility = frontmatter.get("compatibility", "")
    if compatibility:
        if not isinstance(compatibility, str):
            return False, f"`compatibility` must be a string, got {type(compatibility).__name__}."
        if len(compatibility) > 500:
            return False, f"`compatibility` is {len(compatibility)} characters. Maximum length is 500."

    return True, "Skill is valid."


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a skill directory and return a JSON result.",
        epilog=(
            "Examples:\n"
            "  uv run scripts/quick_validate.py .\n"
            "  uv run scripts/quick_validate.py ../my-skill"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("skill_path", type=Path, help="Path to the skill directory that contains SKILL.md.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    skill_path = args.skill_path.resolve()

    if not skill_path.is_dir():
        message = f"Skill directory not found: {skill_path}"
        log(f"Error: {message}")
        emit_json({"ok": False, "skill_path": str(skill_path), "valid": False, "message": message})
        raise SystemExit(1)

    valid, message = validate_skill(skill_path)
    if valid:
        log(f"Validated {skill_path}")
    else:
        log(f"Validation failed for {skill_path}: {message}")

    emit_json(
        {
            "ok": valid,
            "skill_path": str(skill_path),
            "valid": valid,
            "message": message,
        }
    )
    raise SystemExit(0 if valid else 1)


if __name__ == "__main__":
    main()
