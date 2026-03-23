#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "PyYAML>=6.0",
# ]
# ///
"""Package a skill directory into a distributable `.skill` archive."""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
import zipfile
from pathlib import Path

import yaml

# Patterns to exclude when packaging skills.
EXCLUDE_DIRS = {"__pycache__", "node_modules"}
EXCLUDE_GLOBS = {"*.pyc"}
EXCLUDE_FILES = {".DS_Store"}
# Directories excluded only at the skill root (not when nested deeper).
ROOT_EXCLUDE_DIRS = {"evals"}
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

    return True, "Skill is valid."


def should_exclude(rel_path: Path) -> bool:
    """Check if a path should be excluded from packaging."""
    parts = rel_path.parts
    if any(part in EXCLUDE_DIRS for part in parts):
        return True
    # rel_path is relative to skill_path.parent, so parts[0] is the skill
    # folder name and parts[1] (if present) is the first subdir.
    if len(parts) > 1 and parts[1] in ROOT_EXCLUDE_DIRS:
        return True
    name = rel_path.name
    if name in EXCLUDE_FILES:
        return True
    return any(fnmatch.fnmatch(name, pat) for pat in EXCLUDE_GLOBS)


def package_skill(skill_path: Path, output_dir: Path | None = None) -> dict:
    """
    Package a skill folder into a .skill file.

    Args:
        skill_path: Path to the skill folder
        output_dir: Optional output directory for the .skill file (defaults to current directory)

    Returns:
        Path to the created .skill file, or None if error
    """
    skill_path = Path(skill_path).resolve()

    # Validate skill folder exists
    if not skill_path.exists():
        raise FileNotFoundError(f"Skill directory not found: {skill_path}")

    if not skill_path.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {skill_path}")

    # Validate SKILL.md exists
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        raise FileNotFoundError(f"SKILL.md not found in {skill_path}")

    # Run validation before packaging
    log(f"Validating {skill_path}")
    valid, message = validate_skill(skill_path)
    if not valid:
        raise ValueError(f"{message} Fix the validation errors before packaging.")
    log(message)

    # Determine output location
    skill_name = skill_path.name
    if output_dir:
        output_path = Path(output_dir).resolve()
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        output_path = Path.cwd()

    skill_filename = output_path / f"{skill_name}.skill"
    added_files: list[str] = []
    skipped_files: list[str] = []

    # Create the .skill file (zip format)
    with zipfile.ZipFile(skill_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file_path in skill_path.rglob("*"):
            if not file_path.is_file():
                continue
            arcname = file_path.relative_to(skill_path.parent)
            if should_exclude(arcname):
                skipped_files.append(str(arcname))
                log(f"Skipped: {arcname}")
                continue
            zipf.write(file_path, arcname)
            added_files.append(str(arcname))
            log(f"Added: {arcname}")

    return {
        "ok": True,
        "skill_path": str(skill_path),
        "output_path": str(skill_filename),
        "files_added": added_files,
        "files_skipped": skipped_files,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Package a skill directory into a `.skill` archive and emit JSON metadata.",
        epilog=(
            "Examples:\n"
            "  uv run scripts/package_skill.py ./my-skill\n"
            "  uv run scripts/package_skill.py ./my-skill --output-dir ./dist"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("skill_path", type=Path, help="Path to the skill directory to package.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory where the `.skill` archive should be written. Defaults to the current working directory.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    skill_path = args.skill_path.resolve()
    output_dir = args.output_dir.resolve() if args.output_dir else None

    try:
        result = package_skill(skill_path, output_dir)
    except (FileNotFoundError, NotADirectoryError, ValueError, OSError, zipfile.BadZipFile) as exc:
        log(f"Error: {exc}")
        emit_json(
            {
                "ok": False,
                "skill_path": str(skill_path),
                "output_path": str(output_dir) if output_dir else None,
                "error": str(exc),
                "hint": "Pass a valid skill directory and run `uv run scripts/quick_validate.py <skill-path>` first.",
            }
        )
        raise SystemExit(1)

    emit_json(result)
    raise SystemExit(0)


if __name__ == "__main__":
    main()
