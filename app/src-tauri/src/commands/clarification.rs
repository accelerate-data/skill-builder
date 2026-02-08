use crate::markdown::clarification::{
    self, ClarificationFile,
};
use std::fs;

#[tauri::command]
pub fn parse_clarifications(file_path: String) -> Result<ClarificationFile, String> {
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    Ok(clarification::parse_clarification_file(&content))
}

#[tauri::command]
pub fn save_clarification_answers(
    file_path: String,
    file: ClarificationFile,
) -> Result<(), String> {
    let content = clarification::serialize_clarification_file(&file);
    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_raw_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::markdown::clarification::{
        ClarificationChoice, ClarificationQuestion, ClarificationSection,
    };
    use tempfile::tempdir;

    #[test]
    fn test_parse_clarifications_file_not_found() {
        let result = parse_clarifications("/tmp/nonexistent-clarification-file-xyz.md".into());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("No such file") || err.contains("not found") || err.contains("os error"),
            "Expected file-not-found error, got: {}",
            err
        );
    }

    #[test]
    fn test_save_and_parse_roundtrip() {
        let dir = tempdir().unwrap();
        let file_path = dir
            .path()
            .join("clarifications.md")
            .to_str()
            .unwrap()
            .to_string();

        let original = ClarificationFile {
            sections: vec![ClarificationSection {
                heading: "Architecture".to_string(),
                questions: vec![ClarificationQuestion {
                    id: "Q1".to_string(),
                    title: "API design".to_string(),
                    question: "REST or GraphQL?".to_string(),
                    choices: vec![
                        ClarificationChoice {
                            letter: "a".to_string(),
                            text: "REST".to_string(),
                            rationale: "simpler to implement".to_string(),
                        },
                        ClarificationChoice {
                            letter: "b".to_string(),
                            text: "GraphQL".to_string(),
                            rationale: "flexible queries".to_string(),
                        },
                    ],
                    recommendation: Some("a — simplicity wins".to_string()),
                    answer: Some("b — we need flexible queries".to_string()),
                }],
            }],
        };

        // Save to file via the command
        save_clarification_answers(file_path.clone(), original).unwrap();

        // Parse back via the command
        let parsed = parse_clarifications(file_path).unwrap();

        assert_eq!(parsed.sections.len(), 1);
        assert_eq!(parsed.sections[0].heading, "Architecture");
        let q = &parsed.sections[0].questions[0];
        assert_eq!(q.id, "Q1");
        assert_eq!(q.title, "API design");
        assert_eq!(q.question, "REST or GraphQL?");
        assert_eq!(q.choices.len(), 2);
        assert_eq!(q.choices[0].letter, "a");
        assert_eq!(q.choices[0].text, "REST");
        assert_eq!(q.choices[1].text, "GraphQL");
        assert_eq!(
            q.recommendation.as_deref(),
            Some("a — simplicity wins")
        );
        assert_eq!(
            q.answer.as_deref(),
            Some("b — we need flexible queries")
        );
    }

    #[test]
    fn test_save_raw_file_and_read_back() {
        let dir = tempdir().unwrap();
        let file_path = dir
            .path()
            .join("test.md")
            .to_str()
            .unwrap()
            .to_string();

        save_raw_file(file_path.clone(), "# Hello\nWorld".into()).unwrap();
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "# Hello\nWorld");
    }
}
