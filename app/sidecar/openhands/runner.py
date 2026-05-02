"""
OpenHands Python runner.

Reads one JSON request object from stdin, runs the agent, emits JSONL events
on stdout, then exits.

stdout: JSONL protocol only (one JSON object per line)
stderr: debug/progress output

Protocol records are OpenHands-native conversation records:
conversation_state and conversation_event.
"""

from __future__ import annotations

import contextlib
import json
import os
import signal
import sys
import time
import traceback
from pathlib import Path
from typing import Any, TextIO

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")

# ---------------------------------------------------------------------------
# Protocol helpers
# ---------------------------------------------------------------------------

_PROTOCOL_STDOUT: TextIO | None = None
_TERMINAL_STATUSES = {"completed", "error", "cancelled"}
_ACTIVE_CONVERSATION: Any | None = None


def _protocol_stream() -> TextIO:
    return _PROTOCOL_STDOUT or sys.stdout


@contextlib.contextmanager
def _capture_protocol_stdout():
    global _PROTOCOL_STDOUT
    previous = _PROTOCOL_STDOUT
    _PROTOCOL_STDOUT = sys.stdout
    try:
        yield
    finally:
        _PROTOCOL_STDOUT = previous


def emit(obj: dict[str, Any]) -> None:
    """Emit one JSONL event to stdout. Never write anything else to stdout."""
    print(json.dumps(obj, separators=(",", ":")), file=_protocol_stream(), flush=True)


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


class _RedactingStderr:
    def __init__(self, secrets: list[str]):
        self.secrets = secrets

    def write(self, text: str) -> int:
        sys.stderr.write(_redact(str(text), self.secrets))
        return len(text)

    def flush(self) -> None:
        sys.stderr.flush()


def _redact_value(value: Any, secrets: list[str]) -> Any:
    if isinstance(value, str):
        return _redact(value, secrets)
    if isinstance(value, list):
        return [_redact_value(item, secrets) for item in value]
    if isinstance(value, tuple):
        return [_redact_value(item, secrets) for item in value]
    if isinstance(value, dict):
        return {str(key): _redact_value(item, secrets) for key, item in value.items()}
    return value


def _json_serializable(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


def _serialize_sdk_event(event: Any) -> Any:
    if hasattr(event, "model_dump"):
        try:
            return _json_serializable(event.model_dump(mode="json"))
        except Exception:
            pass
    if hasattr(event, "dict"):
        try:
            return _json_serializable(event.dict())
        except Exception:
            pass
    return str(event)


def emit_conversation_event(event: Any, secrets: list[str]) -> None:
    emit(
        {
            "type": "conversation_event",
            "event_class": event.__class__.__name__,
            "timestamp": now_ms(),
            "event": _redact_value(_serialize_sdk_event(event), secrets),
        }
    )


def emit_conversation_state(status: str, secrets: list[str], **kwargs: Any) -> None:
    payload: dict[str, Any] = {
        "type": "conversation_state",
        "runtime": "openhands",
        "agent_id": "skill-creator",
        "status": status,
        "timestamp": now_ms(),
    }
    if status in _TERMINAL_STATUSES:
        payload["error_detail"] = None
    payload.update(_redact_value(kwargs, secrets))
    emit(payload)


# ---------------------------------------------------------------------------
# Optional OpenHands imports — guarded so callers get a clean error on missing
# deps rather than a traceback landing on stdout.
# ---------------------------------------------------------------------------

_OPENHANDS_IMPORT_ERROR: str | None = None

try:
    from openhands.sdk import Agent, AgentContext, Conversation, LLM, Tool  # type: ignore[import]
    from openhands.sdk.conversation.response_utils import get_agent_final_response  # type: ignore[import]
    from openhands.sdk.skills import load_skills_from_dir  # type: ignore[import]
    from openhands.sdk.workspace import LocalWorkspace  # type: ignore[import]
    from openhands.tools.browser_use import BrowserToolSet  # type: ignore[import]
    from openhands.tools.file_editor import FileEditorTool  # type: ignore[import]
    from openhands.tools.task_tracker import TaskTrackerTool  # type: ignore[import]
    from openhands.tools.terminal import TerminalTool  # type: ignore[import]

except ImportError as exc:
    _OPENHANDS_IMPORT_ERROR = (
        f"OpenHands SDK not installed ({exc}). "
        "Install dev dependencies from app/sidecar/openhands/requirements.txt"
    )
    Agent = AgentContext = Conversation = LLM = Tool = None  # type: ignore[assignment]
    get_agent_final_response = None  # type: ignore[assignment]
    LocalWorkspace = None  # type: ignore[assignment]
    load_skills_from_dir = None  # type: ignore[assignment]
    BrowserToolSet = FileEditorTool = TaskTrackerTool = TerminalTool = None  # type: ignore[assignment]


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
    agent_name = data.get("agentName", "skill-creator")
    if agent_name != "skill-creator":
        raise ValueError(
            f"Unsupported agentName: {agent_name!r} (only 'skill-creator' is supported)"
        )
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


def _strip_yaml_frontmatter(content: str) -> str:
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) == 3:
            return parts[2].strip()
    return content.strip()


def _read_skill_creator_agent_file(workspace_skill_dir: str) -> str:
    path = Path(workspace_skill_dir) / ".agents" / "agents" / "skill-creator.md"
    if not path.is_file():
        raise FileNotFoundError(f"Missing OpenHands agent file: {path}")
    content = path.read_text(encoding="utf-8")
    return _strip_yaml_frontmatter(content)


def _load_agent_skills(workspace_skill_dir: str) -> list[Any]:
    skills_dir = Path(workspace_skill_dir) / ".agents" / "skills"
    if load_skills_from_dir is None:
        return []
    try:
        _, _, agent_skills = load_skills_from_dir(str(skills_dir))
        return list(agent_skills.values())
    except Exception as exc:
        print(f"[openhands-runner] AgentSkills load warning: {exc}", file=sys.stderr)
        return []


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
    if BrowserToolSet is not None and (
        include_all
        or requested.intersection(
            {"browser", "browser_tool_set", "browsertoolset", "browser_use"}
        )
    ):
        tools.append(Tool(name=BrowserToolSet.name))
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
    kwargs["model"] = _normalize_model_for_litellm(kwargs["model"], kwargs.get("base_url"))
    if kwargs.get("reasoning_effort") == "auto":
        del kwargs["reasoning_effort"]
    return kwargs


def _normalize_model_for_litellm(model: str, base_url: Any) -> str:
    """Map app catalog provider ids to LiteLLM provider ids."""
    if model.startswith("opencode-go/") and isinstance(base_url, str) and base_url.strip():
        return f"openai/{model.removeprefix('opencode-go/')}"
    return model


def run_via_openhands_sdk(request: dict[str, Any]) -> str:
    global _ACTIVE_CONVERSATION
    if any(x is None for x in [Agent, AgentContext, Conversation, LLM, Tool, LocalWorkspace]):
        raise RuntimeError(_OPENHANDS_IMPORT_ERROR or "OpenHands SDK not available")

    prompt: str = request["prompt"]
    agent_name = "skill-creator"
    workspace_skill_dir: str = request.get("workspaceSkillDir") or request.get("workspaceRootDir") or "."
    llm_kwargs = _build_llm_kwargs(request)
    secrets = _redaction_secrets(request)

    print(
        f"[openhands-runner] starting SDK conversation model={llm_kwargs['model']} agent={agent_name or 'default'}",
        file=sys.stderr,
    )

    with contextlib.redirect_stdout(_RedactingStderr(secrets)):
        llm = LLM(**llm_kwargs)

        agent_instructions = _read_skill_creator_agent_file(workspace_skill_dir)
        skills = _load_agent_skills(workspace_skill_dir)
        agent_context = AgentContext(
            skills=skills,
            system_message_suffix=agent_instructions or None,
            user_message_suffix=request.get("userMessageSuffix") or "",
            load_public_skills=False,
        )
        agent = Agent(
            llm=llm,
            tools=_build_tools(request),
            agent_context=agent_context,
        )
        workspace = LocalWorkspace(working_dir=workspace_skill_dir)
        conversation = Conversation(
            agent=agent,
            workspace=workspace,
            callbacks=[lambda event: emit_conversation_event(event, secrets)],
            max_iteration_per_run=parse_max_iterations(request),
            visualizer=None,
            delete_on_close=False,
        )

    with contextlib.redirect_stdout(_RedactingStderr(secrets)):
        _ACTIVE_CONVERSATION = conversation
        try:
            conversation.send_message(prompt)
            result = conversation.run()
        finally:
            _ACTIVE_CONVERSATION = None

        return _extract_final_text(result) or _extract_final_text(conversation)


def _extract_final_text(source: Any) -> str:
    """Pull the final assistant message text from the OpenHands typed event log."""
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
    if get_agent_final_response is None:
        final_response = ""
    else:
        final_response = (get_agent_final_response(events) or "").strip()
    if final_response:
        return final_response

    for event in reversed(events):
        msg = getattr(event, "message", None) or getattr(event, "content", None)
        if isinstance(msg, str) and msg.strip():
            return msg.strip()
    return ""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run(request: dict[str, Any]) -> None:
    secrets = _redaction_secrets(request)
    terminal_emitted = False

    def emit_terminal(state: str, **kwargs: Any) -> None:
        nonlocal terminal_emitted
        if terminal_emitted:
            return
        terminal_emitted = True
        emit_conversation_state(state, secrets, **kwargs)

    with _capture_protocol_stdout():
        emit_conversation_state("starting", secrets)
        try:
            emit_conversation_state("running", secrets)
            result_text = run_via_openhands_sdk(request)
        except KeyboardInterrupt:
            print("[openhands-runner] SDK run cancelled", file=sys.stderr)
            emit_terminal("cancelled", error_detail="Run cancelled")
            return
        except Exception as exc:
            print(
                f"[openhands-runner] SDK run failed: {_redact(str(exc), secrets)}",
                file=sys.stderr,
            )
            _print_redacted_exception(exc, secrets)
            emit_terminal("error", error_detail=str(exc))
            return

        emit_terminal("completed", result_text=result_text, structured_output=None)


def _emit_startup_error(error_message: str, secrets: list[str] | None = None) -> None:
    redaction_secrets = secrets or []
    terminal_emitted = False

    def emit_terminal(state: str, **kwargs: Any) -> None:
        nonlocal terminal_emitted
        if terminal_emitted:
            return
        terminal_emitted = True
        emit_conversation_state(state, redaction_secrets, **kwargs)

    with _capture_protocol_stdout():
        emit_conversation_state("starting", redaction_secrets)
        emit_terminal("error", error_detail=error_message)


def _raise_keyboard_interrupt(_signum: int, _frame: Any) -> None:
    if _ACTIVE_CONVERSATION is not None:
        try:
            _ACTIVE_CONVERSATION.pause()
        except Exception as exc:
            print(
                f"[openhands-runner] SDK pause failed during cancellation: {exc}",
                file=sys.stderr,
            )
    raise KeyboardInterrupt


def main() -> None:
    print("[openhands-runner] reading request from stdin", file=sys.stderr)
    raw = sys.stdin.read()

    try:
        request = parse_request(raw)
    except ValueError as exc:
        _emit_startup_error(str(exc))
        return

    if _OPENHANDS_IMPORT_ERROR is not None:
        secrets = _redaction_secrets(request)
        print(
            f"[openhands-runner] import error: {_redact(_OPENHANDS_IMPORT_ERROR, secrets)}",
            file=sys.stderr,
        )
        _emit_startup_error(_OPENHANDS_IMPORT_ERROR, secrets)
        return

    try:
        previous_sigterm = signal.getsignal(signal.SIGTERM)
        signal.signal(signal.SIGTERM, _raise_keyboard_interrupt)
        run(request)
    except Exception as exc:
        secrets = _redaction_secrets(request) if "request" in locals() else []
        print(
            f"[openhands-runner] unexpected error: {_redact(str(exc), secrets)}",
            file=sys.stderr,
        )
        _print_redacted_exception(exc, secrets)
        _emit_startup_error(str(exc), secrets)
    finally:
        if "previous_sigterm" in locals():
            signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    main()
