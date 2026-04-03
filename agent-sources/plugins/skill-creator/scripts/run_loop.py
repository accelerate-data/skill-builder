#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Run the eval + improve loop until all pass or max iterations are reached."""

from __future__ import annotations

import argparse
import html
import json
import os
import queue
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import webbrowser
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path


def emit_json(payload: dict) -> None:
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")


def log(message: str) -> None:
    print(message, file=sys.stderr)


def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    content = (skill_path / "SKILL.md").read_text(encoding="utf-8")
    lines = content.split("\n")

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


def generate_html(data: dict, auto_refresh: bool = False, skill_name: str = "") -> str:
    """Generate HTML report from loop output data."""
    history = data.get("history", [])
    title_prefix = html.escape(skill_name + " - ") if skill_name else ""

    train_queries: list[dict] = []
    test_queries: list[dict] = []
    if history:
        for result in history[0].get("train_results", history[0].get("results", [])):
            train_queries.append({"query": result["query"], "should_trigger": result.get("should_trigger", True)})
        for result in history[0].get("test_results") or []:
            test_queries.append({"query": result["query"], "should_trigger": result.get("should_trigger", True)})

    refresh_tag = '    <meta http-equiv="refresh" content="5">\n' if auto_refresh else ""
    html_parts = [
        """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
"""
        + refresh_tag
        + """    <title>"""
        + title_prefix
        + """Skill Description Optimization</title>
    <style>
        body { font-family: Georgia, serif; margin: 0 auto; max-width: 100%; padding: 20px; background: #faf9f5; color: #141413; }
        h1 { font-family: sans-serif; }
        .summary, .explainer { background: white; border: 1px solid #e8e6dc; border-radius: 6px; margin-bottom: 20px; padding: 15px; }
        table { border-collapse: collapse; width: 100%; background: white; border: 1px solid #e8e6dc; }
        th, td { border: 1px solid #e8e6dc; padding: 8px; text-align: left; }
        th { background: #141413; color: #faf9f5; }
        th.test-col { background: #6a9bcc; }
        td.description { font-family: monospace; font-size: 11px; max-width: 400px; word-wrap: break-word; }
        td.result { text-align: center; min-width: 40px; }
        td.test-result { background: #f0f6fc; }
        .pass { color: #788c5d; }
        .fail { color: #c44; }
        .rate { display: block; font-size: 9px; color: #b0aea5; }
        .best-row { background: #f5f8f2; }
        .score { display: inline-block; border-radius: 4px; font-weight: bold; font-size: 11px; padding: 2px 6px; }
        .score-good { background: #eef2e8; color: #788c5d; }
        .score-ok { background: #fef3c7; color: #d97706; }
        .score-bad { background: #fceaea; color: #c44; }
    </style>
</head>
<body>
    <h1>"""
        + title_prefix
        + """Skill Description Optimization</h1>
    <div class="explainer">
        <strong>Optimizing your skill's description.</strong> Each row is an iteration, and each query column shows whether the skill triggered correctly.
    </div>
"""
    ]

    html_parts.append(
        f"""
    <div class="summary">
        <p><strong>Original:</strong> {html.escape(data.get('original_description', 'N/A'))}</p>
        <p><strong>Best:</strong> {html.escape(data.get('best_description', 'N/A'))}</p>
        <p><strong>Best Score:</strong> {data.get('best_score', 'N/A')}</p>
        <p><strong>Iterations:</strong> {data.get('iterations_run', 0)}</p>
    </div>
"""
    )

    html_parts.append(
        """
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th>Description</th>
"""
    )

    for qinfo in train_queries:
        html_parts.append(f"                <th>{html.escape(qinfo['query'])}</th>\n")
    for qinfo in test_queries:
        html_parts.append(f'                <th class="test-col">{html.escape(qinfo["query"])}</th>\n')

    html_parts.append(
        """            </tr>
        </thead>
        <tbody>
"""
    )

    if history:
        if test_queries:
            best_iter = max(history, key=lambda item: item.get("test_passed") or 0).get("iteration")
        else:
            best_iter = max(history, key=lambda item: item.get("train_passed", item.get("passed", 0))).get("iteration")
    else:
        best_iter = None

    for item in history:
        iteration = item.get("iteration", "?")
        train_passed = item.get("train_passed", item.get("passed", 0))
        train_total = item.get("train_total", item.get("total", 0))
        test_passed = item.get("test_passed")
        test_total = item.get("test_total")
        description = item.get("description", "")
        train_results = item.get("train_results", item.get("results", []))
        test_results = item.get("test_results", [])

        train_by_query = {result["query"]: result for result in train_results}
        test_by_query = {result["query"]: result for result in test_results}

        def score_class(passed: int | None, total: int | None) -> str:
            if not total:
                return "score-ok"
            ratio = passed / total
            if ratio >= 0.85:
                return "score-good"
            if ratio >= 0.5:
                return "score-ok"
            return "score-bad"

        row_class = ' class="best-row"' if iteration == best_iter else ""
        html_parts.append(f"            <tr{row_class}>\n")
        html_parts.append(f"                <td>{iteration}</td>\n")
        html_parts.append(
            f'                <td><span class="score {score_class(train_passed, train_total)}">{train_passed}/{train_total}</span></td>\n'
        )
        if test_total:
            html_parts.append(
                f'                <td><span class="score {score_class(test_passed, test_total)}">{test_passed}/{test_total}</span></td>\n'
            )
        else:
            html_parts.append("                <td>-</td>\n")
        html_parts.append(f'                <td class="description">{html.escape(description)}</td>\n')

        for qinfo in train_queries:
            result = train_by_query.get(qinfo["query"], {})
            did_pass = result.get("pass", False)
            triggers = result.get("triggers", 0)
            runs = result.get("runs", 0)
            icon = "✓" if did_pass else "✗"
            css_class = "pass" if did_pass else "fail"
            html_parts.append(f'                <td class="result {css_class}">{icon}<span class="rate">{triggers}/{runs}</span></td>\n')

        for qinfo in test_queries:
            result = test_by_query.get(qinfo["query"], {})
            did_pass = result.get("pass", False)
            triggers = result.get("triggers", 0)
            runs = result.get("runs", 0)
            icon = "✓" if did_pass else "✗"
            css_class = "pass" if did_pass else "fail"
            html_parts.append(
                f'                <td class="result test-result {css_class}">{icon}<span class="rate">{triggers}/{runs}</span></td>\n'
            )

        html_parts.append("            </tr>\n")

    html_parts.append(
        """        </tbody>
    </table>
</body>
</html>
"""
    )

    return "".join(html_parts)


def find_project_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).resolve()
    for parent in [current, *current.parents]:
        if (parent / ".claude").is_dir():
            return parent
    return current


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
) -> bool:
    unique_id = uuid.uuid4().hex[:8]
    clean_name = f"{skill_name}-skill-{unique_id}"
    project_commands_dir = Path(project_root) / ".claude" / "commands"
    command_file = project_commands_dir / f"{clean_name}.md"

    try:
        project_commands_dir.mkdir(parents=True, exist_ok=True)
        indented_desc = "\n  ".join(skill_description.split("\n"))
        command_content = (
            f"---\n"
            f"description: |\n"
            f"  {indented_desc}\n"
            f"---\n\n"
            f"# {skill_name}\n\n"
            f"This skill handles: {skill_description}\n"
        )
        command_file.write_text(command_content, encoding="utf-8")

        cmd = [
            "claude",
            "-p",
            query,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if model:
            cmd.extend(["--model", model])

        env = {key: value for key, value in os.environ.items() if key != "CLAUDECODE"}
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=project_root,
            env=env,
        )

        triggered = False
        start_time = time.time()
        buffer = ""
        pending_tool_name = None
        accumulated_json = ""

        try:
            # Use a background thread to read stdout — select.select()
            # does not work with pipes on Windows ([WinError 10038]).
            read_queue: queue.Queue[bytes | None] = queue.Queue()

            def _reader() -> None:
                try:
                    while True:
                        chunk = process.stdout.read(8192)
                        if not chunk:
                            break
                        read_queue.put(chunk)
                except Exception:
                    pass
                finally:
                    read_queue.put(None)

            reader_thread = threading.Thread(target=_reader, daemon=True)
            reader_thread.start()

            while time.time() - start_time < timeout:
                if process.poll() is not None:
                    # Drain remaining chunks from the reader thread
                    while True:
                        try:
                            chunk = read_queue.get_nowait()
                        except queue.Empty:
                            break
                        if chunk is None:
                            break
                        buffer += chunk.decode("utf-8", errors="replace")
                    break

                try:
                    chunk = read_queue.get(timeout=1.0)
                except queue.Empty:
                    continue
                if chunk is None:
                    break
                buffer += chunk.decode("utf-8", errors="replace")

                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if event.get("type") == "stream_event":
                        stream_event = event.get("event", {})
                        stream_type = stream_event.get("type", "")
                        if stream_type == "content_block_start":
                            content_block = stream_event.get("content_block", {})
                            if content_block.get("type") == "tool_use":
                                tool_name = content_block.get("name", "")
                                if tool_name in {"Skill", "Read"}:
                                    pending_tool_name = tool_name
                                    accumulated_json = ""
                                else:
                                    return False
                        elif stream_type == "content_block_delta" and pending_tool_name:
                            delta = stream_event.get("delta", {})
                            if delta.get("type") == "input_json_delta":
                                accumulated_json += delta.get("partial_json", "")
                                if clean_name in accumulated_json:
                                    return True
                        elif stream_type in {"content_block_stop", "message_stop"}:
                            if pending_tool_name:
                                return clean_name in accumulated_json
                            if stream_type == "message_stop":
                                return False
                    elif event.get("type") == "assistant":
                        message = event.get("message", {})
                        for content_item in message.get("content", []):
                            if content_item.get("type") != "tool_use":
                                continue
                            tool_name = content_item.get("name", "")
                            tool_input = content_item.get("input", {})
                            if tool_name == "Skill" and clean_name in tool_input.get("skill", ""):
                                triggered = True
                            elif tool_name == "Read" and clean_name in tool_input.get("file_path", ""):
                                triggered = True
                            return triggered
                    elif event.get("type") == "result":
                        return triggered
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

        return triggered
    finally:
        if command_file.exists():
            command_file.unlink()


def run_eval(
    eval_set: list[dict],
    skill_name: str,
    description: str,
    num_workers: int,
    timeout: int,
    project_root: Path,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
) -> dict:
    results = []
    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        future_to_info = {}
        for item in eval_set:
            for run_idx in range(runs_per_query):
                future = executor.submit(
                    run_single_query,
                    item["query"],
                    skill_name,
                    description,
                    timeout,
                    str(project_root),
                    model,
                )
                future_to_info[future] = (item, run_idx)

        query_triggers: dict[str, list[bool]] = {}
        query_items: dict[str, dict] = {}
        for future in as_completed(future_to_info):
            item, _ = future_to_info[future]
            query = item["query"]
            query_items[query] = item
            query_triggers.setdefault(query, [])
            try:
                query_triggers[query].append(future.result())
            except Exception as exc:  # pragma: no cover - defensive worker failure handling
                log(f"Warning: query failed: {exc}")
                query_triggers[query].append(False)

    for query, triggers in query_triggers.items():
        item = query_items[query]
        trigger_rate = sum(triggers) / len(triggers)
        should_trigger = item["should_trigger"]
        did_pass = trigger_rate >= trigger_threshold if should_trigger else trigger_rate < trigger_threshold
        results.append(
            {
                "query": query,
                "should_trigger": should_trigger,
                "trigger_rate": trigger_rate,
                "triggers": sum(triggers),
                "runs": len(triggers),
                "pass": did_pass,
            }
        )

    passed = sum(1 for result in results if result["pass"])
    total = len(results)
    return {
        "skill_name": skill_name,
        "description": description,
        "results": results,
        "summary": {"total": total, "passed": passed, "failed": total - passed},
    }


def _call_claude(prompt: str, model: str | None, timeout: int = 300) -> str:
    import tempfile

    # Write prompt to a temp file and feed it via stdin.
    # On Windows, capture_output=True creates extra pipes that conflict with
    # Claude CLI's async networking ([WinError 10038]). Match run_eval.py's
    # working pattern: stdout=PIPE, stderr=DEVNULL, no captured stderr.
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", encoding="utf-8", delete=False
    ) as tmp:
        tmp.write(prompt)
        tmp_path = tmp.name

    stderr_path = tmp_path + ".stderr"
    try:
        cmd = ["claude", "-p", "--output-format", "text"]
        if model:
            cmd.extend(["--model", model])

        env = {key: value for key, value in os.environ.items() if key != "CLAUDECODE"}
        with open(tmp_path, "r", encoding="utf-8") as stdin_file, \
             open(stderr_path, "w", encoding="utf-8") as stderr_file:
            process = subprocess.Popen(
                cmd,
                stdin=stdin_file,
                stdout=subprocess.PIPE,
                stderr=stderr_file,
                env=env,
            )
            stdout, _ = process.communicate(timeout=timeout)
        if process.returncode != 0:
            stderr_content = Path(stderr_path).read_text(encoding="utf-8", errors="replace").strip()
            raise RuntimeError(f"claude -p exited {process.returncode}\nstderr: {stderr_content}")
        return stdout.decode("utf-8")
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        Path(stderr_path).unlink(missing_ok=True)


def improve_description(
    skill_name: str,
    skill_content: str,
    current_description: str,
    eval_results: dict,
    history: list[dict],
    model: str,
    test_results: dict | None = None,
    log_dir: Path | None = None,
    iteration: int | None = None,
) -> str:
    failed_triggers = [result for result in eval_results["results"] if result["should_trigger"] and not result["pass"]]
    false_triggers = [result for result in eval_results["results"] if not result["should_trigger"] and not result["pass"]]

    train_score = f"{eval_results['summary']['passed']}/{eval_results['summary']['total']}"
    scores_summary = f"Train: {train_score}"
    if test_results:
        test_score = f"{test_results['summary']['passed']}/{test_results['summary']['total']}"
        scores_summary = f"{scores_summary}, Test: {test_score}"

    prompt = f"""You are optimizing a skill description for a Claude Code skill called "{skill_name}".

Here's the current description:
<current_description>
"{current_description}"
</current_description>

Current scores ({scores_summary}):
<scores_summary>
"""
    if failed_triggers:
        prompt += "FAILED TO TRIGGER (should have triggered but didn't):\n"
        for result in failed_triggers:
            prompt += f'  - "{result["query"]}" (triggered {result["triggers"]}/{result["runs"]} times)\n'
        prompt += "\n"

    if false_triggers:
        prompt += "FALSE TRIGGERS (triggered but shouldn't have):\n"
        for result in false_triggers:
            prompt += f'  - "{result["query"]}" (triggered {result["triggers"]}/{result["runs"]} times)\n'
        prompt += "\n"

    if history:
        prompt += "PREVIOUS ATTEMPTS (do NOT repeat these - try something structurally different):\n\n"
        for item in history:
            train_s = f"{item.get('train_passed', item.get('passed', 0))}/{item.get('train_total', item.get('total', 0))}"
            test_s = (
                f"{item.get('test_passed', '?')}/{item.get('test_total', '?')}"
                if item.get("test_passed") is not None
                else None
            )
            score_str = f"train={train_s}" + (f", test={test_s}" if test_s else "")
            prompt += f'<attempt {score_str}>\nDescription: "{item["description"]}"\n'
            for result in item.get("results", []):
                status = "PASS" if result["pass"] else "FAIL"
                prompt += f'  [{status}] "{result["query"][:80]}" (triggered {result["triggers"]}/{result["runs"]})\n'
            prompt += "</attempt>\n\n"

    prompt += f"""</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
{skill_content}
</skill_content>

Write a new description that generalizes from the failures rather than listing specific prompts. Keep it under 1024 characters and ideally around 100-200 words. Respond with only the new description text in <new_description> tags."""

    text = _call_claude(prompt, model)
    match = re.search(r"<new_description>(.*?)</new_description>", text, re.DOTALL)
    description = match.group(1).strip().strip('"') if match else text.strip().strip('"')

    transcript = {
        "iteration": iteration,
        "prompt": prompt,
        "response": text,
        "parsed_description": description,
        "char_count": len(description),
        "over_limit": len(description) > 1024,
    }

    if len(description) > 1024:
        shorten_prompt = (
            f"{prompt}\n\n---\n\n"
            f'A previous attempt produced this description, which at {len(description)} characters is over the 1024-character hard limit:\n\n"{description}"\n\n'
            "Rewrite it to be under 1024 characters while keeping the most important trigger words and intent coverage. "
            "Respond with only the new description in <new_description> tags."
        )
        shorten_text = _call_claude(shorten_prompt, model)
        match = re.search(r"<new_description>(.*?)</new_description>", shorten_text, re.DOTALL)
        description = match.group(1).strip().strip('"') if match else shorten_text.strip().strip('"')
        transcript["rewrite_prompt"] = shorten_prompt
        transcript["rewrite_response"] = shorten_text
        transcript["rewrite_description"] = description
        transcript["rewrite_char_count"] = len(description)

    transcript["final_description"] = description
    if log_dir:
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / f"improve_iter_{iteration or 'unknown'}.json").write_text(json.dumps(transcript, indent=2), encoding="utf-8")

    return description


def split_eval_set(eval_set: list[dict], holdout: float, seed: int = 42) -> tuple[list[dict], list[dict]]:
    random.seed(seed)
    trigger = [item for item in eval_set if item["should_trigger"]]
    no_trigger = [item for item in eval_set if not item["should_trigger"]]
    random.shuffle(trigger)
    random.shuffle(no_trigger)
    n_trigger_test = max(1, int(len(trigger) * holdout))
    n_no_trigger_test = max(1, int(len(no_trigger) * holdout))
    test_set = trigger[:n_trigger_test] + no_trigger[:n_no_trigger_test]
    train_set = trigger[n_trigger_test:] + no_trigger[n_no_trigger_test:]
    return train_set, test_set


def run_loop(
    eval_set: list[dict],
    skill_path: Path,
    project_root: Path,
    description_override: str | None,
    num_workers: int,
    timeout: int,
    max_iterations: int,
    runs_per_query: int,
    trigger_threshold: float,
    holdout: float,
    model: str,
    verbose: bool,
    live_report_path: Path | None = None,
    log_dir: Path | None = None,
) -> dict:
    name, original_description, content = parse_skill_md(skill_path)
    current_description = description_override or original_description

    if holdout > 0:
        train_set, test_set = split_eval_set(eval_set, holdout)
        if verbose:
            log(f"Split: {len(train_set)} train, {len(test_set)} test (holdout={holdout})")
    else:
        train_set = eval_set
        test_set = []

    history = []
    exit_reason = "unknown"

    for iteration in range(1, max_iterations + 1):
        if verbose:
            log("=" * 60)
            log(f"Iteration {iteration}/{max_iterations}")
            log(f"Description: {current_description}")
            log("=" * 60)

        all_queries = train_set + test_set
        eval_start = time.time()
        all_results = run_eval(
            eval_set=all_queries,
            skill_name=name,
            description=current_description,
            num_workers=num_workers,
            timeout=timeout,
            project_root=project_root,
            runs_per_query=runs_per_query,
            trigger_threshold=trigger_threshold,
            model=model,
        )
        eval_elapsed = time.time() - eval_start

        train_queries_set = {query["query"] for query in train_set}
        train_result_list = [result for result in all_results["results"] if result["query"] in train_queries_set]
        test_result_list = [result for result in all_results["results"] if result["query"] not in train_queries_set]

        train_passed = sum(1 for result in train_result_list if result["pass"])
        train_total = len(train_result_list)
        train_summary = {"passed": train_passed, "failed": train_total - train_passed, "total": train_total}
        train_results = {"results": train_result_list, "summary": train_summary}

        if test_set:
            test_passed = sum(1 for result in test_result_list if result["pass"])
            test_total = len(test_result_list)
            test_summary = {"passed": test_passed, "failed": test_total - test_passed, "total": test_total}
            test_results = {"results": test_result_list, "summary": test_summary}
        else:
            test_results = None
            test_summary = None

        history.append(
            {
                "iteration": iteration,
                "description": current_description,
                "train_passed": train_summary["passed"],
                "train_failed": train_summary["failed"],
                "train_total": train_summary["total"],
                "train_results": train_results["results"],
                "test_passed": test_summary["passed"] if test_summary else None,
                "test_failed": test_summary["failed"] if test_summary else None,
                "test_total": test_summary["total"] if test_summary else None,
                "test_results": test_results["results"] if test_results else None,
                "passed": train_summary["passed"],
                "failed": train_summary["failed"],
                "total": train_summary["total"],
                "results": train_results["results"],
            }
        )

        if live_report_path:
            partial_output = {
                "original_description": original_description,
                "best_description": current_description,
                "best_score": "in progress",
                "iterations_run": len(history),
                "holdout": holdout,
                "train_size": len(train_set),
                "test_size": len(test_set),
                "history": history,
            }
            live_report_path.write_text(generate_html(partial_output, auto_refresh=True, skill_name=name), encoding="utf-8")

        if verbose:
            def print_eval_stats(label: str, results: list[dict], elapsed: float) -> None:
                positive = [result for result in results if result["should_trigger"]]
                negative = [result for result in results if not result["should_trigger"]]
                true_positive = sum(result["triggers"] for result in positive)
                positive_runs = sum(result["runs"] for result in positive)
                false_negative = positive_runs - true_positive
                false_positive = sum(result["triggers"] for result in negative)
                negative_runs = sum(result["runs"] for result in negative)
                true_negative = negative_runs - false_positive
                total_runs = true_positive + true_negative + false_positive + false_negative
                precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) > 0 else 1.0
                recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) > 0 else 1.0
                accuracy = (true_positive + true_negative) / total_runs if total_runs > 0 else 0.0
                log(
                    f"{label}: {true_positive + true_negative}/{total_runs} correct, precision={precision:.0%} "
                    f"recall={recall:.0%} accuracy={accuracy:.0%} ({elapsed:.1f}s)"
                )
                for result in results:
                    status = "PASS" if result["pass"] else "FAIL"
                    log(
                        f'  [{status}] rate={result["triggers"]}/{result["runs"]} expected={result["should_trigger"]}: {result["query"][:60]}'
                    )

            print_eval_stats("Train", train_results["results"], eval_elapsed)
            if test_summary:
                print_eval_stats("Test", test_results["results"], 0)

        if train_summary["failed"] == 0:
            exit_reason = f"all_passed (iteration {iteration})"
            if verbose:
                log(f"All train queries passed on iteration {iteration}.")
            break

        if iteration == max_iterations:
            exit_reason = f"max_iterations ({max_iterations})"
            if verbose:
                log(f"Max iterations reached ({max_iterations}).")
            break

        if verbose:
            log("Improving description...")

        improve_start = time.time()
        blinded_history = [{key: value for key, value in item.items() if not key.startswith("test_")} for item in history]
        current_description = improve_description(
            skill_name=name,
            skill_content=content,
            current_description=current_description,
            eval_results=train_results,
            history=blinded_history,
            model=model,
            log_dir=log_dir,
            iteration=iteration,
        )
        if verbose:
            log(f"Proposed ({time.time() - improve_start:.1f}s): {current_description}")

    if test_set:
        best = max(history, key=lambda item: item["test_passed"] or 0)
        best_score = f"{best['test_passed']}/{best['test_total']}"
    else:
        best = max(history, key=lambda item: item["train_passed"])
        best_score = f"{best['train_passed']}/{best['train_total']}"

    if verbose:
        log(f"Exit reason: {exit_reason}")
        log(f"Best score: {best_score} (iteration {best['iteration']})")

    return {
        "exit_reason": exit_reason,
        "original_description": original_description,
        "best_description": best["description"],
        "best_score": best_score,
        "best_train_score": f"{best['train_passed']}/{best['train_total']}",
        "best_test_score": f"{best['test_passed']}/{best['test_total']}" if test_set else None,
        "final_description": current_description,
        "iterations_run": len(history),
        "holdout": holdout,
        "train_size": len(train_set),
        "test_size": len(test_set),
        "history": history,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the eval/improve loop and emit machine-readable JSON.",
        epilog=(
            "Examples:\n"
            "  uv run scripts/run_loop.py --skill-path ./my-skill --eval-set ./evals.json --project-root /repo --model sonnet\n"
            "  uv run scripts/run_loop.py --skill-path ./my-skill --eval-set ./evals.json --report ./report.html --open-report --model sonnet"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--eval-set", required=True, help="Path to the eval set JSON file.")
    parser.add_argument("--skill-path", required=True, help="Path to the skill directory.")
    parser.add_argument(
        "--project-root",
        required=True,
        help="Project root that contains `.claude/`.",
    )
    parser.add_argument("--description", default=None, help="Override the starting description.")
    parser.add_argument("--num-workers", type=int, default=10, help="Number of parallel workers.")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds.")
    parser.add_argument("--max-iterations", type=int, default=5, help="Maximum number of improvement iterations.")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Number of runs per query.")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold.")
    parser.add_argument("--holdout", type=float, default=0.4, help="Fraction of the eval set to hold out for testing.")
    parser.add_argument("--model", required=True, help="Claude model to use for improvement.")
    parser.add_argument("--verbose", action="store_true", help="Print progress diagnostics to stderr.")
    parser.add_argument(
        "--report",
        default="auto",
        help="Report path. Use `auto` for a temp file, or `none` to disable HTML report generation.",
    )
    parser.add_argument("--open-report", action="store_true", help="Open the generated HTML report in a browser.")
    parser.add_argument(
        "--results-dir",
        default=None,
        help="Save outputs (results.json, report.html, logs/) to a timestamped subdirectory here.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    skill_path = Path(args.skill_path).resolve()
    project_root = Path(args.project_root).resolve()

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
        raise SystemExit(1)

    try:
        ensure_claude_available()
        eval_set = json.loads(Path(args.eval_set).read_text(encoding="utf-8"))
    except (RuntimeError, OSError, json.JSONDecodeError) as exc:
        log(f"Error: {exc}")
        emit_json(
            {
                "ok": False,
                "skill_path": str(skill_path),
                "eval_set_path": args.eval_set,
                "error": str(exc),
                "hint": "Provide a valid eval JSON file and ensure the `claude` CLI is installed.",
            }
        )
        raise SystemExit(1)

    name, _, _ = parse_skill_md(skill_path)

    if args.report != "none":
        if args.report == "auto":
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            live_report_path = Path(tempfile.gettempdir()) / f"skill_description_report_{skill_path.name}_{timestamp}.html"
        else:
            live_report_path = Path(args.report).resolve()
        live_report_path.write_text(
            "<html><body><h1>Starting optimization loop...</h1><meta http-equiv='refresh' content='5'></body></html>",
            encoding="utf-8",
        )
        if args.open_report:
            webbrowser.open(str(live_report_path))
    else:
        live_report_path = None

    if args.results_dir:
        timestamp = time.strftime("%Y-%m-%d_%H%M%S")
        results_dir = Path(args.results_dir).resolve() / timestamp
        results_dir.mkdir(parents=True, exist_ok=True)
    else:
        results_dir = None

    log_dir = results_dir / "logs" if results_dir else None

    try:
        output = run_loop(
            eval_set=eval_set,
            skill_path=skill_path,
            project_root=project_root,
            description_override=args.description,
            num_workers=args.num_workers,
            timeout=args.timeout,
            max_iterations=args.max_iterations,
            runs_per_query=args.runs_per_query,
            trigger_threshold=args.trigger_threshold,
            holdout=args.holdout,
            model=args.model,
            verbose=args.verbose,
            live_report_path=live_report_path,
            log_dir=log_dir,
        )
    except RuntimeError as exc:
        log(f"Error: {exc}")
        emit_json(
            {
                "ok": False,
                "skill_path": str(skill_path),
                "project_root": str(project_root),
                "error": str(exc),
                "hint": "Confirm Claude CLI auth is working and that the project root contains `.claude/`.",
            }
        )
        raise SystemExit(1)

    if results_dir:
        (results_dir / "results.json").write_text(json.dumps(output, indent=2), encoding="utf-8")

    if live_report_path:
        live_report_path.write_text(generate_html(output, auto_refresh=False, skill_name=name), encoding="utf-8")
        if results_dir:
            (results_dir / "report.html").write_text(generate_html(output, auto_refresh=False, skill_name=name), encoding="utf-8")
        log(f"Report: {live_report_path}")

    if results_dir:
        log(f"Results saved to: {results_dir}")

    emit_json(
        {
            "ok": True,
            "project_root": str(project_root),
            "report_path": str(live_report_path) if live_report_path else None,
            "results_dir": str(results_dir) if results_dir else None,
            **output,
        }
    )


if __name__ == "__main__":
    main()
