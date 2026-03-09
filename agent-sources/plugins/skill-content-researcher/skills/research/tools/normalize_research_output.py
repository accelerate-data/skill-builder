#!/usr/bin/env python3
"""
Deterministic normalization + minimal validation for research_output.

This tool exists to ensure all JSON handling is performed by Python, not the model:
- Parse JSON from stdin
- Validate key invariants required by the app/orchestrator boundary
- Derive envelope counts deterministically
- Emit a normalized result (or a deterministic invalid-output payload)

Input (stdin): JSON object with at least:
  { "research_output": <object> }

Output (stdout): JSON object:
  {
    "research_output": <canonical clarifications object>,
    "dimensions_selected": <int>,
    "question_count": <int>
  }
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional, Tuple


JsonObject = Dict[str, Any]


def _fail(reason: str) -> JsonObject:
    return {
        "research_output": {
            "version": "1",
            "metadata": {
                "question_count": 0,
                "section_count": 0,
                "must_answer_count": 0,
                "priority_questions": [],
                "scope_recommendation": False,
                "scope_reason": reason,
                "warning": None,
                "error": {"code": "invalid_research_output", "message": reason},
                "research_plan": {
                    "purpose": "",
                    "domain": "",
                    "topic_relevance": "not_relevant",
                    "dimensions_evaluated": 0,
                    "dimensions_selected": 0,
                    "dimension_scores": [],
                    "selected_dimensions": [],
                },
            },
            "sections": [],
            "notes": [],
            "answer_evaluator_notes": [],
        },
        "dimensions_selected": 0,
        "question_count": 0,
    }


def _as_object(value: Any, label: str) -> JsonObject:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _as_int(value: Any, label: str) -> int:
    if not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    return value


def _as_list(value: Any, label: str) -> List[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def _derive_counts(research_output: JsonObject) -> Tuple[int, int]:
    metadata = _as_object(research_output.get("metadata"), "research_output.metadata")
    question_count = _as_int(metadata.get("question_count"), "research_output.metadata.question_count")
    research_plan = _as_object(
        metadata.get("research_plan"), "research_output.metadata.research_plan"
    )
    dimensions_selected = _as_int(
        research_plan.get("dimensions_selected"),
        "research_output.metadata.research_plan.dimensions_selected",
    )
    return question_count, dimensions_selected


def _minimal_shape_validate(research_output: JsonObject) -> None:
    # Version is required (string "1" currently).
    version = research_output.get("version")
    if version != "1":
        raise ValueError("research_output.version must be '1'")

    metadata = _as_object(research_output.get("metadata"), "research_output.metadata")
    _as_int(metadata.get("question_count"), "research_output.metadata.question_count")
    _as_int(metadata.get("section_count"), "research_output.metadata.section_count")
    _as_int(metadata.get("must_answer_count"), "research_output.metadata.must_answer_count")
    _as_list(metadata.get("priority_questions"), "research_output.metadata.priority_questions")

    # warning/error are nullable objects
    for k in ["warning", "error"]:
        v = metadata.get(k)
        if v is not None:
            _as_object(v, f"research_output.metadata.{k}")

    research_plan = _as_object(metadata.get("research_plan"), "research_output.metadata.research_plan")
    _as_int(research_plan.get("dimensions_selected"), "research_output.metadata.research_plan.dimensions_selected")
    _as_list(research_plan.get("dimension_scores"), "research_output.metadata.research_plan.dimension_scores")
    _as_list(research_plan.get("selected_dimensions"), "research_output.metadata.research_plan.selected_dimensions")

    _as_list(research_output.get("sections"), "research_output.sections")
    _as_list(research_output.get("notes"), "research_output.notes")
    _as_list(research_output.get("answer_evaluator_notes"), "research_output.answer_evaluator_notes")


def main() -> None:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else None
        if not isinstance(payload, dict):
            raise ValueError("input must be a JSON object")

        research_output = _as_object(payload.get("research_output"), "research_output")
        _minimal_shape_validate(research_output)
        question_count, dimensions_selected = _derive_counts(research_output)

        out = {
            "research_output": research_output,
            "dimensions_selected": dimensions_selected,
            "question_count": question_count,
        }
        sys.stdout.write(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        sys.stdout.write(json.dumps(_fail(str(e)), ensure_ascii=False))


if __name__ == "__main__":
    main()

