use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClarificationChoice {
    pub letter: String,
    pub text: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClarificationQuestion {
    pub id: String,
    pub title: String,
    pub question: String,
    pub choices: Vec<ClarificationChoice>,
    pub recommendation: Option<String>,
    pub answer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClarificationSection {
    pub heading: String,
    pub questions: Vec<ClarificationQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClarificationFile {
    pub sections: Vec<ClarificationSection>,
}

pub fn parse_clarification_file(content: &str) -> ClarificationFile {
    let section_re = Regex::new(r"^## (.+)$").unwrap();
    let question_re = Regex::new(r"^### (Q\d+):\s*(.+)$").unwrap();
    let question_body_re = Regex::new(r"^\*\*Question\*\*:\s*(.+)$").unwrap();
    let choice_re = Regex::new(r"^\s*([a-z])\)\s*(.+?)(?:\s*—\s*(.+))?$").unwrap();
    let recommendation_re = Regex::new(r"^\*\*Recommendation\*\*:\s*(.+)$").unwrap();
    let answer_re = Regex::new(r"^\*\*Answer\*\*:\s*(.*)$").unwrap();

    let mut sections: Vec<ClarificationSection> = Vec::new();

    for line in content.lines() {
        if let Some(caps) = section_re.captures(line) {
            sections.push(ClarificationSection {
                heading: caps[1].trim().to_string(),
                questions: Vec::new(),
            });
            continue;
        }

        if let Some(caps) = question_re.captures(line) {
            // Ensure there's a section to add to; create a default one if needed
            if sections.is_empty() {
                sections.push(ClarificationSection {
                    heading: String::new(),
                    questions: Vec::new(),
                });
            }
            let section = sections.last_mut().unwrap();
            section.questions.push(ClarificationQuestion {
                id: caps[1].to_string(),
                title: caps[2].trim().to_string(),
                question: String::new(),
                choices: Vec::new(),
                recommendation: None,
                answer: None,
            });
            continue;
        }

        // All remaining patterns require an active question
        let current_q = sections
            .last_mut()
            .and_then(|s| s.questions.last_mut());
        let Some(q) = current_q else { continue };

        if let Some(caps) = question_body_re.captures(line) {
            q.question = caps[1].trim().to_string();
            continue;
        }

        if let Some(caps) = choice_re.captures(line) {
            q.choices.push(ClarificationChoice {
                letter: caps[1].to_string(),
                text: caps[2].trim().to_string(),
                rationale: caps
                    .get(3)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default(),
            });
            continue;
        }

        if let Some(caps) = recommendation_re.captures(line) {
            q.recommendation = Some(caps[1].trim().to_string());
            continue;
        }

        if let Some(caps) = answer_re.captures(line) {
            let val = caps[1].trim().to_string();
            q.answer = if val.is_empty() { None } else { Some(val) };
        }
    }

    ClarificationFile { sections }
}

pub fn serialize_clarification_file(file: &ClarificationFile) -> String {
    let mut out = String::new();

    for (si, section) in file.sections.iter().enumerate() {
        if si > 0 {
            out.push('\n');
        }
        if !section.heading.is_empty() {
            out.push_str(&format!("## {}\n\n", section.heading));
        }

        for q in &section.questions {
            out.push_str(&format!("### {}: {}\n", q.id, q.title));
            out.push_str(&format!("**Question**: {}\n", q.question));
            out.push_str("**Choices**:\n");
            for c in &q.choices {
                if c.rationale.is_empty() {
                    out.push_str(&format!("  {}) {}\n", c.letter, c.text));
                } else {
                    out.push_str(&format!(
                        "  {}) {} — {}\n",
                        c.letter, c.text, c.rationale
                    ));
                }
            }
            if let Some(ref rec) = q.recommendation {
                out.push_str(&format!("**Recommendation**: {}\n", rec));
            }
            match &q.answer {
                Some(a) => out.push_str(&format!("**Answer**: {}\n", a)),
                None => out.push_str("**Answer**:\n"),
            }
            out.push('\n');
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_question() {
        let content = r#"## Domain Concepts

### Q1: Primary focus area
**Question**: What is the primary focus area for this skill?
**Choices**:
  a) Sales forecasting — predict future revenue
  b) Pipeline management — track deal progression
  c) Other (please specify)
**Recommendation**: b — most actionable for day-to-day work
**Answer**:
"#;
        let file = parse_clarification_file(content);
        assert_eq!(file.sections.len(), 1);
        assert_eq!(file.sections[0].heading, "Domain Concepts");
        assert_eq!(file.sections[0].questions.len(), 1);

        let q = &file.sections[0].questions[0];
        assert_eq!(q.id, "Q1");
        assert_eq!(q.title, "Primary focus area");
        assert_eq!(
            q.question,
            "What is the primary focus area for this skill?"
        );
        assert_eq!(q.choices.len(), 3);
        assert_eq!(q.choices[0].letter, "a");
        assert_eq!(q.choices[0].text, "Sales forecasting");
        assert_eq!(q.choices[0].rationale, "predict future revenue");
        assert_eq!(q.choices[2].text, "Other (please specify)");
        assert_eq!(q.choices[2].rationale, "");
        assert_eq!(
            q.recommendation.as_deref(),
            Some("b — most actionable for day-to-day work")
        );
        assert!(q.answer.is_none());
    }

    #[test]
    fn test_parse_multiple_sections() {
        let content = r#"## Section One

### Q1: First question
**Question**: What is first?
**Choices**:
  a) Option A — reason A
  b) Option B — reason B
**Recommendation**: a — best choice
**Answer**:

## Section Two

### Q2: Second question
**Question**: What is second?
**Choices**:
  a) Alpha — alpha reason
  b) Beta — beta reason
**Recommendation**: b — better
**Answer**:
"#;
        let file = parse_clarification_file(content);
        assert_eq!(file.sections.len(), 2);
        assert_eq!(file.sections[0].heading, "Section One");
        assert_eq!(file.sections[0].questions.len(), 1);
        assert_eq!(file.sections[0].questions[0].id, "Q1");
        assert_eq!(file.sections[1].heading, "Section Two");
        assert_eq!(file.sections[1].questions.len(), 1);
        assert_eq!(file.sections[1].questions[0].id, "Q2");
    }

    #[test]
    fn test_parse_answered_question() {
        let content = r#"## Review

### Q1: Data model
**Question**: Which data model should we use?
**Choices**:
  a) Relational — traditional SQL
  b) Document — flexible schema
**Recommendation**: a — better for structured data
**Answer**: b — we need schema flexibility for evolving requirements
"#;
        let file = parse_clarification_file(content);
        let q = &file.sections[0].questions[0];
        assert_eq!(
            q.answer.as_deref(),
            Some("b — we need schema flexibility for evolving requirements")
        );
    }

    #[test]
    fn test_parse_empty_answer() {
        let content = r#"## Review

### Q1: Topic
**Question**: A question?
**Choices**:
  a) Yes — reason
  b) No — reason
**Answer**:
"#;
        let file = parse_clarification_file(content);
        assert!(file.sections[0].questions[0].answer.is_none());
    }

    #[test]
    fn test_parse_no_recommendation() {
        let content = r#"## Review

### Q1: Simple question
**Question**: Pick one
**Choices**:
  a) First — reason
  b) Second — reason
**Answer**: a
"#;
        let file = parse_clarification_file(content);
        let q = &file.sections[0].questions[0];
        assert!(q.recommendation.is_none());
        assert_eq!(q.answer.as_deref(), Some("a"));
    }

    #[test]
    fn test_roundtrip() {
        let original = ClarificationFile {
            sections: vec![ClarificationSection {
                heading: "Domain Concepts".to_string(),
                questions: vec![ClarificationQuestion {
                    id: "Q1".to_string(),
                    title: "Focus area".to_string(),
                    question: "What is the focus?".to_string(),
                    choices: vec![
                        ClarificationChoice {
                            letter: "a".to_string(),
                            text: "Option A".to_string(),
                            rationale: "reason A".to_string(),
                        },
                        ClarificationChoice {
                            letter: "b".to_string(),
                            text: "Option B".to_string(),
                            rationale: "reason B".to_string(),
                        },
                    ],
                    recommendation: Some("a — best choice".to_string()),
                    answer: Some("b — user preference".to_string()),
                }],
            }],
        };

        let serialized = serialize_clarification_file(&original);
        let parsed = parse_clarification_file(&serialized);

        assert_eq!(parsed.sections.len(), 1);
        assert_eq!(parsed.sections[0].heading, "Domain Concepts");
        let q = &parsed.sections[0].questions[0];
        assert_eq!(q.id, "Q1");
        assert_eq!(q.title, "Focus area");
        assert_eq!(q.question, "What is the focus?");
        assert_eq!(q.choices.len(), 2);
        assert_eq!(q.choices[0].letter, "a");
        assert_eq!(q.choices[0].text, "Option A");
        assert_eq!(q.choices[0].rationale, "reason A");
        assert_eq!(q.recommendation.as_deref(), Some("a — best choice"));
        assert_eq!(q.answer.as_deref(), Some("b — user preference"));
    }

    #[test]
    fn test_parse_empty_file() {
        let file = parse_clarification_file("");
        assert!(file.sections.is_empty());
    }
}
