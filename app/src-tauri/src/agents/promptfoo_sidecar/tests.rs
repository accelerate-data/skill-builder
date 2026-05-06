use serde_json::json;

use super::process::{
    extract_eval_result_from_stdout, extract_run_from_stdout, extract_runs_from_stdout,
    resolve_runner_from_dist_candidates, PromptfooSidecarPathError,
};
use super::protocol::{
    parse_sidecar_event, EvalCandidate, EvalCase, EvalExecution, EvalMode, RunEvalRequest,
    SidecarEvent, SidecarResultPayload,
};

#[test]
fn run_eval_request_serializes_sidecar_payload() {
    let request = RunEvalRequest::new(
        "run-1",
        EvalMode::Trigger,
        "warehouse-domain",
        "skills",
        "Routing checks",
        "/tmp/promptfoo",
        vec![EvalCandidate {
            id: "candidate-1".to_string(),
            label: "Candidate 1".to_string(),
            description: Some("Use for warehouse domain classification prompts.".to_string()),
        }],
        vec![EvalCase {
            id: "case-1".to_string(),
            prompt: "Classify these tables.".to_string(),
            expected: None,
            should_trigger: Some(true),
            expectations: vec!["Explains the warehouse-domain routing expectation.".to_string()],
        }],
        vec![EvalExecution {
            case_id: "case-1".to_string(),
            candidate_id: "candidate-1".to_string(),
            output: json!({ "invokedTargetSkill": true }),
        }],
    );

    let payload = serde_json::to_value(request).expect("serialize request");

    assert_eq!(payload["id"], "run-1");
    assert_eq!(payload["type"], "run_eval");
    assert_eq!(payload["mode"], "trigger");
    assert_eq!(payload["skillName"], "warehouse-domain");
    assert_eq!(payload["pluginSlug"], "skills");
    assert_eq!(payload["scenarioName"], "Routing checks");
    assert_eq!(payload["promptfooConfigDir"], "/tmp/promptfoo");
    assert_eq!(
        payload["candidates"][0]["description"],
        "Use for warehouse domain classification prompts."
    );
    assert_eq!(payload["cases"][0]["shouldTrigger"], true);
    assert_eq!(
        payload["cases"][0]["expectations"][0],
        "Explains the warehouse-domain routing expectation."
    );
    assert_eq!(payload["executions"][0]["candidateId"], "candidate-1");
}

#[test]
fn sidecar_progress_event_deserializes() {
    let event = parse_sidecar_event(
        r#"{"type":"progress","id":"run-1","completed":1,"total":3,"caseId":"case-1"}"#,
    )
    .expect("deserialize progress event");

    assert_eq!(
        event,
        SidecarEvent::Progress {
            id: "run-1".to_string(),
            completed: 1,
            total: 3,
            case_id: Some("case-1".to_string()),
            candidate_id: None,
        }
    );
}

#[test]
fn extracts_result_from_sidecar_stdout() {
    let stdout = r#"{"type":"progress","id":"run-1","completed":1,"total":1}
{"type":"result","id":"run-1","result":{"mode":"trigger","total":1,"passed":1,"failed":0,"results":[{"caseId":"case-1","candidateId":"candidate-1","passed":true,"score":1.0,"output":{"invokedTargetSkill":true}}]}}"#;

    let result = extract_eval_result_from_stdout(stdout, "run-1").expect("result event");

    assert_eq!(result.mode, EvalMode::Trigger);
    assert_eq!(result.total, 1);
    assert_eq!(result.passed, 1);
    assert_eq!(result.results[0].candidate_id, "candidate-1");
}

#[test]
fn sidecar_error_event_is_returned() {
    let stdout = r#"{"type":"error","id":"run-1","message":"boom"}"#;

    let error = extract_eval_result_from_stdout(stdout, "run-1").expect_err("error event");

    assert!(error.contains("boom"));
}

#[test]
fn parses_history_runs_result_event() {
    let stdout = r#"{"type":"result","id":"list-history","runs":[{"id":"run-1","promptfooEvalId":"eval-1","pluginSlug":"skills","skillName":"warehouse-domain","scenarioName":"Routing checks","mode":"trigger","status":"completed","summary":{"total":1,"passed":1,"failed":0,"passRate":1.0},"createdAt":"2026-05-05T00:00:00Z","completedAt":"2026-05-05T00:00:00Z","results":[]}]}"#;

    let runs = extract_runs_from_stdout(stdout, "list-history").expect("runs result");

    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, "run-1");
    assert_eq!(runs[0].scenario_name, "Routing checks");
}

#[test]
fn parses_single_history_run_result_event() {
    let stdout = r#"{"type":"result","id":"read-history","run":{"id":"run-1","promptfooEvalId":"eval-1","pluginSlug":"skills","skillName":"warehouse-domain","scenarioName":"Routing checks","mode":"trigger","status":"completed","summary":{"total":1,"passed":1,"failed":0,"passRate":1.0},"createdAt":"2026-05-05T00:00:00Z","completedAt":"2026-05-05T00:00:00Z","results":[{"caseId":"case-1","candidateId":"candidate-1","passed":true,"score":1.0,"output":{"invokedTargetSkill":true}}]}}"#;

    let run = extract_run_from_stdout(stdout, "read-history").expect("run result");

    assert_eq!(run.as_ref().map(|value| value.id.as_str()), Some("run-1"));
    assert_eq!(run.as_ref().map(|value| value.results.len()), Some(1));
}

#[test]
fn sidecar_result_event_deserializes_history_payload() {
    let event = parse_sidecar_event(
        r#"{"type":"result","id":"list-history","runs":[{"id":"run-1","promptfooEvalId":"eval-1","pluginSlug":"skills","skillName":"warehouse-domain","scenarioName":"Routing checks","mode":"trigger","status":"completed","summary":{"total":1,"passed":1,"failed":0,"passRate":1.0},"createdAt":"2026-05-05T00:00:00Z","completedAt":"2026-05-05T00:00:00Z","results":[]}]}"#,
    )
    .expect("deserialize history result event");

    match event {
        SidecarEvent::Result {
            id,
            payload: SidecarResultPayload::Runs { runs },
        } => {
            assert_eq!(id, "list-history");
            assert_eq!(runs.len(), 1);
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

#[test]
fn unknown_sidecar_event_is_rejected() {
    let error = parse_sidecar_event(r#"{"type":"heartbeat","id":"run-1"}"#)
        .expect_err("unknown event should fail");

    assert!(error.contains("unknown variant"));
}

#[test]
fn resolves_runner_from_existing_dist_candidate() {
    let tempdir = tempfile::tempdir().expect("create temp dir");
    let dist = tempdir.path().join("dist");
    std::fs::create_dir(&dist).expect("create dist dir");
    std::fs::write(dist.join("runner.js"), "console.log('ok');").expect("write runner");

    let resolved = resolve_runner_from_dist_candidates([tempdir.path().join("missing"), dist])
        .expect("resolve runner");

    assert!(resolved.ends_with("/dist/runner.js"));
}

#[test]
fn missing_runner_returns_missing_error() {
    let tempdir = tempfile::tempdir().expect("create temp dir");

    let error = resolve_runner_from_dist_candidates([tempdir.path().join("dist")])
        .expect_err("missing runner should fail");

    assert_eq!(error, PromptfooSidecarPathError::Missing);
}
