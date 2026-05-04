use serde_json::json;

use super::process::{
    extract_result_from_stdout, resolve_runner_from_dist_candidates, PromptfooSidecarPathError,
};
use super::protocol::{
    parse_sidecar_event, EvalAssertion, EvalAssertionType, EvalCandidate, EvalCase, EvalExecution,
    EvalMode, RunEvalRequest, SidecarEvent,
};

#[test]
fn run_eval_request_serializes_sidecar_payload() {
    let request = RunEvalRequest::new(
        "run-1",
        EvalMode::Trigger,
        "warehouse-domain",
        "skills",
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
            assertions: vec![EvalAssertion {
                assertion_type: EvalAssertionType::Contains,
                value: json!("warehouse-domain"),
            }],
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
    assert_eq!(payload["candidates"][0]["description"], "Use for warehouse domain classification prompts.");
    assert_eq!(payload["cases"][0]["shouldTrigger"], true);
    assert_eq!(payload["cases"][0]["assertions"][0]["type"], "contains");
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

    let result = extract_result_from_stdout(stdout, "run-1").expect("result event");

    assert_eq!(result.mode, EvalMode::Trigger);
    assert_eq!(result.total, 1);
    assert_eq!(result.passed, 1);
    assert_eq!(result.results[0].candidate_id, "candidate-1");
}

#[test]
fn sidecar_error_event_is_returned() {
    let stdout = r#"{"type":"error","id":"run-1","message":"boom"}"#;

    let error = extract_result_from_stdout(stdout, "run-1").expect_err("error event");

    assert!(error.contains("boom"));
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
