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
    # OpenHands package layout may vary across versions; try the most likely paths.
    try:
        from openhands.core.main import main as _openhands_main  # type: ignore[import]
    except ImportError:
        _openhands_main = None  # type: ignore[assignment]

    try:
        from openhands.llm.llm import LLM  # type: ignore[import]
    except ImportError:
        try:
            from openhands.llm import LLM  # type: ignore[import]
        except ImportError:
            LLM = None  # type: ignore[assignment]

    try:
        from openhands.core.config import AppConfig  # type: ignore[import]
    except ImportError:
        AppConfig = None  # type: ignore[assignment]

    if all(x is None for x in [_openhands_main, LLM]):
        _OPENHANDS_IMPORT_ERROR = (
            "OpenHands SDK not installed or no usable entry point found. "
            "Install dev dependencies from app/sidecar/openhands/requirements.txt"
        )

except ImportError as exc:
    _OPENHANDS_IMPORT_ERROR = (
        f"OpenHands SDK not installed ({exc}). "
        "Install dev dependencies from app/sidecar/openhands/requirements.txt"
    )
    _openhands_main = None  # type: ignore[assignment]
    LLM = None  # type: ignore[assignment]
    AppConfig = None  # type: ignore[assignment]


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


# ---------------------------------------------------------------------------
# OpenHands run via AppConfig / main
# ---------------------------------------------------------------------------


def run_via_openhands_main(request: dict[str, Any]) -> str:
    """
    Attempt to drive OpenHands through its `main()` entry point.

    The OpenHands `main()` function accepts an `AppConfig` and returns the
    final agent state.  This is the most stable public API surface.
    """
    if _openhands_main is None or AppConfig is None:
        raise RuntimeError("openhands.core.main.main or AppConfig not available")

    prompt: str = request["prompt"]
    model: str = request.get("model") or "claude-sonnet-4-6"
    api_key: str = request["apiKey"]
    workspace_root: str = request.get("workspaceRootDir", ".")

    print(
        f"[openhands-runner] starting run via openhands.core.main model={model}",
        file=sys.stderr,
    )

    config = AppConfig()
    config.default_agent = "CodeActAgent"

    # Set LLM config — attribute names differ across OpenHands versions.
    llm_cfg = getattr(config, "llm", None) or getattr(config, "get_llm_config", lambda: None)()
    if llm_cfg is not None:
        llm_cfg.model = model
        llm_cfg.api_key = api_key
    else:
        # Fallback: set on config directly
        config.model = model  # type: ignore[attr-defined]
        config.api_key = api_key  # type: ignore[attr-defined]

    config.workspace_base = workspace_root  # type: ignore[attr-defined]
    config.max_iterations = 10  # type: ignore[attr-defined]

    # Emit a synthetic progress event so callers see activity
    emit_openhands_event("message", text=f"Starting OpenHands agent with prompt: {prompt[:120]}")

    result_state = _openhands_main(config=config, task_str=prompt)

    # Extract last assistant message from the event stream
    final_text = _extract_final_text(result_state)
    return final_text


def _extract_final_text(state: Any) -> str:
    """Pull the final assistant message text from an OpenHands state object."""
    if state is None:
        return ""

    # State.history contains event objects
    history = getattr(state, "history", None)
    if history is None:
        return str(state)

    events = list(history)
    for event in reversed(events):
        # AgentFinishAction / MessageAction both have a .message attribute
        msg = getattr(event, "message", None) or getattr(event, "content", None)
        if msg and isinstance(msg, str) and msg.strip():
            return msg.strip()

    return ""


# ---------------------------------------------------------------------------
# Fallback: conversational run via LLM directly (no full agent loop)
# ---------------------------------------------------------------------------


def run_via_llm_direct(request: dict[str, Any]) -> str:
    """
    Fallback path when the OpenHands agent loop is not accessible.

    Uses the OpenHands LLM wrapper to send a single completion request.
    This does NOT use real tools or a sandbox — it's a plain completion call.
    """
    if LLM is None:
        raise RuntimeError("openhands.llm.LLM not available")

    prompt: str = request["prompt"]
    system_prompt: str | None = request.get("systemPrompt")
    model: str = request.get("model") or "claude-sonnet-4-6"
    api_key: str = request["apiKey"]

    print(
        f"[openhands-runner] using LLM direct path model={model}",
        file=sys.stderr,
    )

    # OpenHands LLM config uses either a dict or an LLMConfig object
    try:
        from openhands.core.config import LLMConfig  # type: ignore[import]

        llm_config = LLMConfig(model=model, api_key=api_key)
    except ImportError:
        llm_config = {"model": model, "api_key": api_key}  # type: ignore[assignment]

    llm = LLM(config=llm_config)

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    emit_openhands_event("message", text=f"Sending request to LLM (model={model})")

    response = llm.completion(messages=messages)

    # Different OpenHands versions expose the text differently
    if hasattr(response, "choices"):
        return response.choices[0].message.content or ""
    if hasattr(response, "content"):
        content = response.content
        if isinstance(content, list):
            return " ".join(getattr(c, "text", str(c)) for c in content)
        return str(content)
    return str(response)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run(request: dict[str, Any]) -> None:
    # Attempt the full agent path first, fall back to direct LLM call
    result_text: str = ""
    run_error: str | None = None

    if _openhands_main is not None and AppConfig is not None:
        try:
            result_text = run_via_openhands_main(request)
            emit_openhands_event(
                "tool_call",
                tool_name="OpenHandsAgent",
                summary="Agent run completed",
            )
        except Exception as exc:
            print(
                f"[openhands-runner] openhands main path failed: {exc}",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            run_error = _redact(str(exc), request.get("apiKey", ""))
    elif LLM is not None:
        try:
            result_text = run_via_llm_direct(request)
            emit_openhands_event(
                "tool_call",
                tool_name="LLMDirect",
                summary="LLM direct call completed",
            )
        except Exception as exc:
            print(
                f"[openhands-runner] LLM direct path failed: {exc}",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            run_error = _redact(str(exc), request.get("apiKey", ""))
    else:
        run_error = (
            _OPENHANDS_IMPORT_ERROR
            or "No usable OpenHands execution path found. "
            "Install dev dependencies from app/sidecar/openhands/requirements.txt"
        )

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
        print(
            f"[openhands-runner] unexpected error: {exc}",
            file=sys.stderr,
        )
        traceback.print_exc(file=sys.stderr)
        emit_result(status="error", error_message=_redact(str(exc), ""))


if __name__ == "__main__":
    main()
