use serde_json::json;

use super::process::{resolve_runner_from_dist_candidates, PromptfooSidecarPathError};
use super::protocol::{
    EvalAssertion, EvalAssertionType, EvalCandidate, EvalCase, EvalMode, RunEvalRequest,
    SidecarEvent,
};

#[test]
fn run_eval_request_serializes_camel_case_payload() {
    let request = RunEvalRequest::new(
        "run-1",
        EvalMode::Trigger,
        "warehouse-domain",
        vec![EvalCandidate {
            id: "candidate-1".to_string(),
            label: "Candidate 1".to_string(),
            description: "Use for warehouse domain classification prompts.".to_string(),
        }],
        vec![EvalCase {
            id: "case-1".to_string(),
            prompt: "Classify these tables.".to_string(),
            assertions: vec![EvalAssertion {
                assertion_type: EvalAssertionType::Contains,
                value: json!("warehouse-domain"),
            }],
        }],
    );

    let payload = serde_json::to_value(request).expect("serialize request");

    assert_eq!(payload["runId"], "run-1");
    assert_eq!(payload["mode"], "trigger");
    assert_eq!(payload["targetSkillName"], "warehouse-domain");
    assert_eq!(
        payload["candidates"][0]["description"],
        "Use for warehouse domain classification prompts."
    );
    assert_eq!(payload["cases"][0]["assertions"][0]["type"], "contains");
}

#[test]
fn sidecar_progress_event_deserializes() {
    let event: SidecarEvent = serde_json::from_value(json!({
        "type": "progress",
        "run_id": "run-1",
        "completed": 1,
        "total": 3,
        "message": "Running promptfoo"
    }))
    .expect("deserialize progress event");

    assert_eq!(
        event,
        SidecarEvent::Progress {
            run_id: "run-1".to_string(),
            completed: 1,
            total: 3,
            message: "Running promptfoo".to_string(),
        }
    );
}

#[test]
fn sidecar_result_event_deserializes() {
    let event: SidecarEvent = serde_json::from_value(json!({
        "type": "result",
        "result": {
            "runId": "run-1",
            "mode": "trigger",
            "results": [
                {
                    "caseId": "case-1",
                    "candidateId": "candidate-1",
                    "passed": true,
                    "score": 1.0,
                    "reason": "Skill triggered"
                }
            ]
        }
    }))
    .expect("deserialize result event");

    match event {
        SidecarEvent::Result { result } => {
            assert_eq!(result.run_id, "run-1");
            assert_eq!(result.mode, EvalMode::Trigger);
            assert_eq!(result.results[0].case_id, "case-1");
            assert!(result.results[0].passed);
        }
        other => panic!("expected result event, got {other:?}"),
    }
}

#[test]
fn unknown_sidecar_event_is_rejected() {
    let error = serde_json::from_value::<SidecarEvent>(json!({
        "type": "heartbeat",
        "run_id": "run-1"
    }))
    .expect_err("unknown event should fail");

    assert!(error.to_string().contains("unknown variant"));
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
