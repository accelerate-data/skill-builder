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
import sys
import time
import traceback
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Protocol helpers
# ---------------------------------------------------------------------------


def emit(obj: dict[str, Any]) -> None:
    """Emit one JSONL event to stdout. Never write anything else to stdout."""
    print(json.dumps(obj, separators=(",", ":")), flush=True)


def _redact(text: str, api_key: str) -> str:
    """Replace api_key occurrences in text with [REDACTED] to prevent key leakage over stdout."""
    if api_key and api_key in text:
        return text.replace(api_key, "[REDACTED]")
    return text


def _print_redacted_exception(exc: Exception, api_key: str) -> None:
    print(_redact(traceback.format_exc(), api_key), file=sys.stderr, end="")


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
    from openhands.sdk.context.skills import load_project_skills, load_skills_from_dir  # type: ignore[import]
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
    for required in ("prompt", "apiKey"):
        if required not in data:
            raise ValueError(f"Missing required field: {required!r}")
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


def run_via_openhands_sdk(request: dict[str, Any]) -> str:
    if any(x is None for x in [Agent, AgentContext, Conversation, LLM, Tool]):
        raise RuntimeError(_OPENHANDS_IMPORT_ERROR or "OpenHands SDK not available")

    prompt: str = request["prompt"]
    model: str = request.get("model") or "anthropic/claude-sonnet-4-6"
    model_base_url: str | None = request.get("modelBaseUrl")
    agent_name: str | None = request.get("agentName")
    api_key: str = request["apiKey"]
    workspace_skill_dir: str = request.get("workspaceSkillDir") or request.get("workspaceRootDir") or "."

    print(
        f"[openhands-runner] starting SDK conversation model={model} agent={agent_name or 'default'}",
        file=sys.stderr,
    )

    llm_kwargs: dict[str, Any] = {"model": model, "api_key": api_key}
    if model_base_url:
        llm_kwargs["base_url"] = model_base_url
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
    api_key = request.get("apiKey", "")

    try:
        result_text = run_via_openhands_sdk(request)
        emit_openhands_event(
            "tool_call",
            tool_name="OpenHandsSDK",
            summary="Agent run completed",
        )
    except Exception as exc:
        print(
            f"[openhands-runner] SDK run failed: {_redact(str(exc), api_key)}",
            file=sys.stderr,
        )
        _print_redacted_exception(exc, api_key)
        run_error = _redact(str(exc), api_key)

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
        api_key = request.get("apiKey", "") if "request" in locals() else ""
        print(
            f"[openhands-runner] unexpected error: {_redact(str(exc), api_key)}",
            file=sys.stderr,
        )
        _print_redacted_exception(exc, api_key)
        emit_result(
            status="error",
            error_message=_redact(
                str(exc),
                api_key,
            ),
        )


if __name__ == "__main__":
    main()
