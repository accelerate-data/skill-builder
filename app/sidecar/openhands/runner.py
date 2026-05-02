"""
OpenHands Python runner spike.

Reads one JSON request object from stdin, runs the agent, emits JSONL events
on stdout, then exits.

stdout: JSONL protocol only (one JSON object per line)
stderr: debug/progress output

This is a dev-only spike — do not integrate into Tauri config or build scripts.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")

# ---------------------------------------------------------------------------
# Protocol helpers
# ---------------------------------------------------------------------------


def emit(obj: dict[str, Any]) -> None:
    """Emit one JSONL event to stdout. Never write anything else to stdout."""
    print(json.dumps(obj, separators=(",", ":")), flush=True)


def _redact(text: str, secrets: str | list[str]) -> str:
    """Replace secret occurrences in text with [REDACTED] to prevent leakage over stdout."""
    redacted = text
    values = [secrets] if isinstance(secrets, str) else secrets
    for secret in values:
        if secret and secret in redacted:
            redacted = redacted.replace(secret, "[REDACTED]")
    return redacted


def _print_redacted_exception(exc: Exception, secrets: list[str]) -> None:
    print(_redact(traceback.format_exc(), secrets), file=sys.stderr, end="")


def now_ms() -> int:
    return int(time.time() * 1000)


def emit_openhands_event(event_kind: str, **kwargs: Any) -> None:
    emit({"type": "openhands_event", "event_kind": event_kind, "timestamp": now_ms(), **kwargs})


def emit_result(
    status: str,
    result_text: str | None = None,
    structured_output: Any = None,
    error_message: str | None = None,
    error_subtype: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": "openhands_result",
        "status": status,
        "result_text": result_text,
        "structured_output": structured_output,
        "timestamp": now_ms(),
    }
    if error_message is not None:
        payload["error_message"] = error_message
    if error_subtype is not None:
        payload["error_subtype"] = error_subtype
    emit(payload)


# ---------------------------------------------------------------------------
# Optional OpenHands imports — guarded so callers get a clean error on missing
# deps rather than a traceback landing on stdout.
# ---------------------------------------------------------------------------

_OPENHANDS_IMPORT_ERROR: str | None = None

try:
    from openhands.sdk import Agent, AgentContext, Conversation, LLM, Tool  # type: ignore[import]
    from openhands.sdk.skills import load_project_skills, load_skills_from_dir  # type: ignore[import]
    from openhands.tools.file_editor import FileEditorTool  # type: ignore[import]
    from openhands.tools.task_tracker import TaskTrackerTool  # type: ignore[import]
    from openhands.tools.terminal import TerminalTool  # type: ignore[import]

except ImportError as exc:
    _OPENHANDS_IMPORT_ERROR = (
        f"OpenHands SDK not installed ({exc}). "
        "Install dev dependencies from app/sidecar/openhands/requirements.txt"
    )
    Agent = AgentContext = Conversation = LLM = Tool = None  # type: ignore[assignment]
    load_project_skills = load_skills_from_dir = None  # type: ignore[assignment]
    FileEditorTool = TaskTrackerTool = TerminalTool = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Request parsing
# ---------------------------------------------------------------------------


def parse_request(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON on stdin: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("Request must be a JSON object")
    for required in ("prompt",):
        if required not in data:
            raise ValueError(f"Missing required field: {required!r}")
    llm_config = data.get("llm")
    if not isinstance(llm_config, dict):
        raise ValueError("OpenHands runner request missing llm config")
    # Accept absent mode as "one-shot" — the Node adapter may not always set it explicitly.
    mode = data.get("mode", "one-shot")
    if mode != "one-shot":
        raise ValueError(f"Unsupported mode: {mode!r} (only 'one-shot' is supported)")
    return data


def parse_max_iterations(request: dict[str, Any]) -> int:
    raw_max_turns = request.get("maxTurns", 50)
    if not isinstance(raw_max_turns, int) or raw_max_turns <= 0:
        raise ValueError("maxTurns must be a positive integer")
    return raw_max_turns


def _redaction_secrets(request: dict[str, Any]) -> list[str]:
    llm_config = request.get("llm")
    if not isinstance(llm_config, dict):
        return []
    secrets: list[str] = []
    api_key = llm_config.get("apiKey")
    if isinstance(api_key, str):
        secrets.append(api_key)
    extra_headers = llm_config.get("extraHeaders")
    if isinstance(extra_headers, dict):
        secrets.extend(value for value in extra_headers.values() if isinstance(value, str))
    return secrets


# ---------------------------------------------------------------------------
# OpenHands SDK run
# ---------------------------------------------------------------------------


def _read_agent_file(workspace_skill_dir: str, agent_name: str | None) -> str:
    if not agent_name:
        return ""
    path = Path(workspace_skill_dir) / ".agents" / "agents" / f"{agent_name}.md"
    if not path.is_file():
        return ""
    content = path.read_text(encoding="utf-8")
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) == 3:
            return parts[2].strip()
    return content.strip()


def _load_agent_skills(workspace_skill_dir: str) -> list[Any]:
    skills: list[Any] = []
    if load_project_skills is not None:
        try:
            skills.extend(load_project_skills(workspace_dir=workspace_skill_dir))
        except Exception as exc:
            print(f"[openhands-runner] project skill load warning: {exc}", file=sys.stderr)
    skills_dir = Path(workspace_skill_dir) / ".agents" / "skills"
    if skills_dir.is_dir() and load_skills_from_dir is not None:
        try:
            _, _, agent_skills = load_skills_from_dir(str(skills_dir))
            skills.extend(agent_skills.values())
        except Exception as exc:
            print(f"[openhands-runner] AgentSkills load warning: {exc}", file=sys.stderr)
    return skills


def _normalize_tool_name(name: str) -> str:
    return name.strip().replace("-", "_").lower()


def _build_tools(request: dict[str, Any]) -> list[Any]:
    requested = {_normalize_tool_name(name) for name in request.get("allowedTools") or []}
    include_all = not requested
    tools: list[Any] = []
    if include_all or requested.intersection({"bash", "terminal", "terminaltool"}):
        tools.append(Tool(name=TerminalTool.name))
    if include_all or requested.intersection(
        {"read", "write", "edit", "glob", "grep", "file_editor", "fileeditortool"}
    ):
        tools.append(Tool(name=FileEditorTool.name))
    tools.append(Tool(name=TaskTrackerTool.name))
    return tools


def _build_llm_kwargs(request: dict[str, Any]) -> dict[str, Any]:
    llm_config = request.get("llm")
    if not isinstance(llm_config, dict):
        raise ValueError("OpenHands runner request missing llm config")
    if not isinstance(llm_config.get("model"), str) or not llm_config["model"]:
        raise ValueError("OpenHands runner llm.model must be a non-empty string")

    field_map = {
        "model": "model",
        "apiKey": "api_key",
        "baseUrl": "base_url",
        "apiVersion": "api_version",
        "temperature": "temperature",
        "maxOutputTokens": "max_output_tokens",
        "timeoutSeconds": "timeout",
        "numRetries": "num_retries",
        "reasoningEffort": "reasoning_effort",
        "extraHeaders": "extra_headers",
        "inputCostPerToken": "input_cost_per_token",
        "outputCostPerToken": "output_cost_per_token",
        "usageId": "usage_id",
    }

    kwargs = {
        kwarg: llm_config[field]
        for field, kwarg in field_map.items()
        if llm_config.get(field) is not None
    }
    if kwargs.get("reasoning_effort") == "auto":
        del kwargs["reasoning_effort"]
    return kwargs


def run_via_openhands_sdk(request: dict[str, Any]) -> str:
    if any(x is None for x in [Agent, AgentContext, Conversation, LLM, Tool]):
        raise RuntimeError(_OPENHANDS_IMPORT_ERROR or "OpenHands SDK not available")

    prompt: str = request["prompt"]
    agent_name: str | None = request.get("agentName")
    workspace_skill_dir: str = request.get("workspaceSkillDir") or request.get("workspaceRootDir") or "."
    llm_kwargs = _build_llm_kwargs(request)

    print(
        f"[openhands-runner] starting SDK conversation model={llm_kwargs['model']} agent={agent_name or 'default'}",
        file=sys.stderr,
    )

    llm = LLM(**llm_kwargs)

    agent_instructions = _read_agent_file(workspace_skill_dir, agent_name)
    skills = _load_agent_skills(workspace_skill_dir)
    agent_context = AgentContext(
        skills=skills,
        system_message_suffix=agent_instructions or None,
    )
    agent = Agent(
        llm=llm,
        tools=_build_tools(request),
        agent_context=agent_context,
    )
    conversation = Conversation(agent=agent, workspace=workspace_skill_dir)

    emit_openhands_event("message", text=f"Starting OpenHands agent: {agent_name or 'default'}")
    conversation.send_message(prompt)
    try:
        result = conversation.run(max_iterations=parse_max_iterations(request))
    except TypeError:
        result = conversation.run()

    return _extract_final_text(result) or _extract_final_text(conversation)


def _extract_final_text(source: Any) -> str:
    """Pull the final assistant message text from an OpenHands state/conversation object."""
    if source is None:
        return ""

    # Conversation objects expose their event log as conversation.state.events.
    state = getattr(source, "state", source)
    history = getattr(state, "history", None)
    events_attr = getattr(state, "events", None)
    events_source = history if history is not None else events_attr
    if events_source is None:
        return ""

    events = list(events_source)
    for event in reversed(events):
        # AgentFinishAction / MessageAction both have a .message attribute
        msg = getattr(event, "message", None) or getattr(event, "content", None)
        if msg and isinstance(msg, str) and msg.strip():
            return msg.strip()

    return ""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run(request: dict[str, Any]) -> None:
    result_text: str = ""
    run_error: str | None = None
    secrets = _redaction_secrets(request)

    try:
        result_text = run_via_openhands_sdk(request)
        emit_openhands_event(
            "tool_call",
            tool_name="OpenHandsSDK",
            summary="Agent run completed",
        )
    except Exception as exc:
        print(
            f"[openhands-runner] SDK run failed: {_redact(str(exc), secrets)}",
            file=sys.stderr,
        )
        _print_redacted_exception(exc, secrets)
        run_error = _redact(str(exc), secrets)

    if run_error is not None:
        emit_result(status="error", error_message=run_error)
        return

    emit_result(status="success", result_text=result_text, structured_output=None)


def main() -> None:
    print("[openhands-runner] reading request from stdin", file=sys.stderr)
    raw = sys.stdin.read()

    if _OPENHANDS_IMPORT_ERROR is not None:
        print(
            f"[openhands-runner] import error: {_OPENHANDS_IMPORT_ERROR}",
            file=sys.stderr,
        )
        emit_result(
            status="error",
            error_message=_OPENHANDS_IMPORT_ERROR,
        )
        return

    try:
        request = parse_request(raw)
    except ValueError as exc:
        emit_result(status="error", error_message=str(exc))
        return

    try:
        run(request)
    except Exception as exc:
        secrets = _redaction_secrets(request) if "request" in locals() else []
        print(
            f"[openhands-runner] unexpected error: {_redact(str(exc), secrets)}",
            file=sys.stderr,
        )
        _print_redacted_exception(exc, secrets)
        emit_result(
            status="error",
            error_message=_redact(
                str(exc),
                secrets,
            ),
        )


if __name__ == "__main__":
    main()
