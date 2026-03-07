use rusqlite::Connection;
use std::path::Path;

const MAX_WORKFLOW_STEP_ID: u32 = 3;

pub fn start_session(
    conn: &Connection,
    session_id: &str,
    skill_name: &str,
    pid: u32,
) -> Result<(), String> {
    validate_session_start(session_id, skill_name, pid)?;
    crate::db::create_workflow_session(conn, session_id, skill_name, pid)
}

pub fn cancel_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("Session ID is required".to_string());
    }
    crate::db::end_workflow_session(conn, session_id)
}

#[allow(dead_code)]
pub fn resume_session(
    conn: &Connection,
    session_id: &str,
    skill_name: &str,
    pid: u32,
) -> Result<(), String> {
    validate_session_start(session_id, skill_name, pid)?;
    crate::db::create_workflow_session(conn, session_id, skill_name, pid)
}

pub fn shutdown_sessions_for_pid(conn: &Connection, pid: u32) -> Result<u32, String> {
    if pid == 0 {
        return Err("PID must be greater than zero".to_string());
    }
    crate::db::end_all_sessions_for_pid(conn, pid)
}

pub fn validate_run_request(
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
) -> Result<(), String> {
    if skill_name.trim().is_empty() {
        return Err("Skill name is required".to_string());
    }
    if workspace_path.trim().is_empty() {
        return Err("Workspace path is required".to_string());
    }
    if step_id > MAX_WORKFLOW_STEP_ID {
        return Err(format!(
            "Unknown step_id {}. Valid steps are 0-{}.",
            step_id, MAX_WORKFLOW_STEP_ID
        ));
    }
    if !Path::new(workspace_path).exists() {
        return Err(format!("Workspace path does not exist: {}", workspace_path));
    }
    Ok(())
}

fn validate_session_start(session_id: &str, skill_name: &str, pid: u32) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("Session ID is required".to_string());
    }
    if skill_name.trim().is_empty() {
        return Err("Skill name is required".to_string());
    }
    if pid == 0 {
        return Err("PID must be greater than zero".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_utils::create_test_db;

    #[test]
    fn test_start_session_happy_path() {
        let conn = create_test_db();
        let result = start_session(&conn, "session-start", "my-skill", 1234);
        assert!(result.is_ok());
    }

    #[test]
    fn test_start_session_failure_path_requires_inputs() {
        let conn = create_test_db();
        let err = start_session(&conn, "", "my-skill", 1234).unwrap_err();
        assert!(err.contains("Session ID is required"));
    }

    #[test]
    fn test_run_request_happy_path() {
        let tmp = tempfile::tempdir().unwrap();
        let result = validate_run_request("my-skill", 2, &tmp.path().to_string_lossy());
        assert!(result.is_ok());
    }

    #[test]
    fn test_run_request_failure_path_rejects_unknown_step() {
        let tmp = tempfile::tempdir().unwrap();
        let err = validate_run_request("my-skill", 99, &tmp.path().to_string_lossy()).unwrap_err();
        assert!(err.contains("Unknown step_id"));
    }

    #[test]
    fn test_cancel_session_happy_path() {
        let conn = create_test_db();
        start_session(&conn, "session-cancel", "my-skill", 4321).unwrap();
        let result = cancel_session(&conn, "session-cancel");
        assert!(result.is_ok());
    }

    #[test]
    fn test_cancel_session_failure_path_requires_session_id() {
        let conn = create_test_db();
        let err = cancel_session(&conn, "").unwrap_err();
        assert!(err.contains("Session ID is required"));
    }

    #[test]
    fn test_resume_session_happy_path() {
        let conn = create_test_db();
        start_session(&conn, "session-initial", "my-skill", 4000).unwrap();
        cancel_session(&conn, "session-initial").unwrap();
        let result = resume_session(&conn, "session-resume", "my-skill", 4000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_resume_session_failure_path_requires_skill_name() {
        let conn = create_test_db();
        let err = resume_session(&conn, "session-resume", "", 4000).unwrap_err();
        assert!(err.contains("Skill name is required"));
    }

    #[test]
    fn test_shutdown_happy_path() {
        let conn = create_test_db();
        start_session(&conn, "session-a", "skill-a", 5555).unwrap();
        start_session(&conn, "session-b", "skill-b", 5555).unwrap();
        let ended = shutdown_sessions_for_pid(&conn, 5555).unwrap();
        assert_eq!(ended, 2);
    }

    #[test]
    fn test_shutdown_failure_path_rejects_zero_pid() {
        let conn = create_test_db();
        let err = shutdown_sessions_for_pid(&conn, 0).unwrap_err();
        assert!(err.contains("PID must be greater than zero"));
    }
}
