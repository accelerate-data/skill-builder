//! Code-generation binary for shared data contracts.
//!
//! Reads the canonical Rust contract types and produces:
//! - TypeScript type definitions (via Specta) for frontend + sidecar
//! - JSON Schema constants (via Schemars) for SDK outputFormat
//!   Flat schemas for Anthropic API: top-level fields only, nested types
//!   collapsed to `{ "type": "object" }`. Deep validation is done by
//!   Rust's typed serde deserialization, not the SDK schema.

use std::fs;
use std::path::Path;

use schemars::generate::SchemaSettings;
use specta::TypeCollection;
use specta_typescript::{BigIntExportBehavior, Typescript};

/// Generate a flat, SDK-compatible JSON Schema from a Rust type.
///
/// 1. Generate the full schema via schemars (draft-07)
/// 2. Flatten: keep only root-level properties, collapse nested types to
///    `{ "type": "object" }` or `{ "type": "array" }`, drop `definitions`
/// 3. Add `additionalProperties: false`
fn flat_schema_for<T: schemars::JsonSchema>() -> serde_json::Value {
    let schema = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<T>();
    let deep = serde_json::to_value(schema).expect("schema must serialize");
    flatten_schema(&deep)
}

/// Flatten a deep JSON Schema to top-level properties only.
/// - `$ref` → `{ "type": "object" }`
/// - `anyOf` with `$ref` → `{ "type": "object" }` (or nullable variant)
/// - Array items with `$ref` → `{ "type": "array" }`
/// - Drop `definitions` block entirely
/// - Add `additionalProperties: false`
fn flatten_schema(schema: &serde_json::Value) -> serde_json::Value {
    let mut result = serde_json::Map::new();

    // Copy top-level metadata
    if let Some(s) = schema.get("$schema") {
        result.insert("$schema".to_string(), s.clone());
    }
    if let Some(t) = schema.get("title") {
        result.insert("title".to_string(), t.clone());
    }
    result.insert("type".to_string(), serde_json::json!("object"));
    result.insert("additionalProperties".to_string(), serde_json::json!(false));

    // Flatten each property
    if let Some(props) = schema.get("properties").and_then(|p| p.as_object()) {
        let mut flat_props = serde_json::Map::new();
        for (key, prop) in props {
            flat_props.insert(key.clone(), flatten_property(prop));
        }
        result.insert("properties".to_string(), serde_json::Value::Object(flat_props));
    }

    // Keep required array as-is
    if let Some(req) = schema.get("required") {
        result.insert("required".to_string(), req.clone());
    }

    serde_json::Value::Object(result)
}

/// Flatten a single property definition for SDK compatibility.
fn flatten_property(prop: &serde_json::Value) -> serde_json::Value {
    let obj = match prop.as_object() {
        Some(o) => o,
        None => return prop.clone(),
    };

    // $ref → { "type": "object" }
    if obj.contains_key("$ref") {
        return serde_json::json!({ "type": "object" });
    }

    // allOf with $ref (schemars wraps required nested types) → { "type": "object" }
    if let Some(all_of) = obj.get("allOf").and_then(|a| a.as_array()) {
        if all_of.iter().any(|v| v.get("$ref").is_some()) {
            return serde_json::json!({ "type": "object" });
        }
    }

    // anyOf (nullable $ref) → { "type": ["object", "null"] }
    if let Some(any_of) = obj.get("anyOf").and_then(|a| a.as_array()) {
        let has_ref = any_of.iter().any(|v| v.get("$ref").is_some());
        let has_null = any_of.iter().any(|v| v.get("type") == Some(&serde_json::json!("null")));
        if has_ref {
            if has_null {
                return serde_json::json!({ "type": ["object", "null"] });
            }
            return serde_json::json!({ "type": "object" });
        }
    }

    // Array with $ref items → { "type": "array" }
    if obj.get("type") == Some(&serde_json::json!("array")) {
        if let Some(items) = obj.get("items") {
            if items.get("$ref").is_some() {
                return serde_json::json!({ "type": "array" });
            }
        }
        // Array of primitives — keep as-is
        return prop.clone();
    }

    // Nullable array: type: ["array", "null"] with $ref items
    if let Some(type_val) = obj.get("type").and_then(|t| t.as_array()) {
        let types: Vec<&str> = type_val.iter().filter_map(|v| v.as_str()).collect();
        if types.contains(&"array") {
            if let Some(items) = obj.get("items") {
                if items.get("$ref").is_some() {
                    return serde_json::json!({ "type": ["array", "null"] });
                }
            }
        }
    }

    // Primitive types (string, integer, number, boolean, enum) — keep as-is
    prop.clone()
}

// Re-use the contract types from the main library crate.
use app_lib::contracts::agent_events::{
    AgentEvent, AgentEventEnvelope, CompactionEvent, ContextWindowEvent, InitProgressEvent,
    InitProgressStage, ModelUsageEntry, RunConfigEvent, RunInitEvent, RunResultEvent,
    RunResultStatus, RunSource, SessionExhaustedEvent, TurnCompleteEvent, TurnUsageEvent,
};
use app_lib::contracts::clarifications::{
    Choice, ClarificationsError, ClarificationsFile, ClarificationsMetadata,
    ClarificationsResearchPlan, ClarificationsWarning, DimensionScore, Note, Question,
    Section, SelectedDimension,
};
use app_lib::contracts::decisions::{
    ContradictoryInputs, Decision, DecisionStatus, DecisionsMetadata,
};
use app_lib::contracts::workflow_outputs::{
    AnswerEvaluationOutput, DecisionsOutput, DetailedResearchOutput, GenerateSkillOutput,
    PerQuestionEntry, ResearchStepOutput,
};

/// Resolve the `app/` directory regardless of how the binary is invoked.
fn project_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // ── 1. Register all contract types with Specta ──────────────────────────

    let mut types = TypeCollection::default();

    // Clarifications
    types.register::<ClarificationsFile>();
    types.register::<ClarificationsMetadata>();
    types.register::<ClarificationsWarning>();
    types.register::<ClarificationsError>();
    types.register::<ClarificationsResearchPlan>();
    types.register::<DimensionScore>();
    types.register::<SelectedDimension>();
    types.register::<Section>();
    types.register::<Question>();
    types.register::<Choice>();
    types.register::<Note>();

    // Decisions
    types.register::<ContradictoryInputs>();
    types.register::<DecisionStatus>();
    types.register::<DecisionsMetadata>();
    types.register::<Decision>();

    // Agent events
    types.register::<ModelUsageEntry>();
    types.register::<RunConfigEvent>();
    types.register::<RunInitEvent>();
    types.register::<TurnUsageEvent>();
    types.register::<CompactionEvent>();
    types.register::<ContextWindowEvent>();
    types.register::<SessionExhaustedEvent>();
    types.register::<InitProgressStage>();
    types.register::<InitProgressEvent>();
    types.register::<TurnCompleteEvent>();
    types.register::<RunResultStatus>();
    types.register::<RunSource>();
    types.register::<RunResultEvent>();
    types.register::<AgentEvent>();
    types.register::<AgentEventEnvelope>();

    // Workflow outputs
    types.register::<ResearchStepOutput>();
    types.register::<DetailedResearchOutput>();
    types.register::<DecisionsOutput>();
    types.register::<GenerateSkillOutput>();
    types.register::<PerQuestionEntry>();
    types.register::<AnswerEvaluationOutput>();

    // ── 2. Export TypeScript types ──────────────────────────────────────────

    let ts_config = Typescript::default()
        .header("// AUTO-GENERATED by codegen \u{2014} do not edit manually\n// Run `cd app/src-tauri && cargo run --bin codegen` to regenerate")
        .bigint(BigIntExportBehavior::Number);

    let ts_output = ts_config.export(&types)?;

    let frontend_path = project_root().join("src/generated/contracts.ts");
    let sidecar_path = project_root().join("sidecar/generated/contracts.ts");

    write_with_dirs(&frontend_path, &ts_output)?;
    write_with_dirs(&sidecar_path, &ts_output)?;

    println!("  wrote {}", frontend_path.display());
    println!("  wrote {}", sidecar_path.display());

    // ── 3. Export flat JSON Schema constants for SDK outputFormat ───────────
    //
    // Flat schemas: top-level fields + types only, nested objects as
    // { "type": "object" }. The SDK's constrained decoding enforces the
    // envelope; Rust typed deserialization validates the full payload.

    let schemas: Vec<(&str, serde_json::Value)> = vec![
        ("RESEARCH_STEP", flat_schema_for::<ResearchStepOutput>()),
        ("DETAILED_RESEARCH", flat_schema_for::<DetailedResearchOutput>()),
        ("DECISIONS", flat_schema_for::<DecisionsOutput>()),
        ("GENERATE_SKILL", flat_schema_for::<GenerateSkillOutput>()),
        ("ANSWER_EVALUATION", flat_schema_for::<AnswerEvaluationOutput>()),
        ("CLARIFICATIONS", flat_schema_for::<ClarificationsFile>()),
    ];

    let mut consts = String::from(
        "// AUTO-GENERATED by codegen \u{2014} do not edit manually\n\
         // Run `cd app/src-tauri && cargo run --bin codegen` to regenerate\n\
         //\n\
         // Flat SDK schemas: top-level fields only, nested types as { \"type\": \"object\" }.\n\
         // Deep validation is done by Rust typed deserialization, not the SDK schema.\n\n",
    );

    for (name, schema) in &schemas {
        let pretty = serde_json::to_string_pretty(schema)?;
        consts.push_str(&format!(
            "pub const {name}_SCHEMA: &str = r###\"{pretty}\"###;\n\n"
        ));
    }

    let schemas_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/generated/schemas.rs");
    write_with_dirs(&schemas_path, &consts)?;
    println!("  wrote {}", schemas_path.display());

    println!("codegen: done");
    Ok(())
}

/// Write `content` to `path`, creating parent directories as needed.
fn write_with_dirs(path: &Path, content: &str) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}
