//! Code-generation binary for shared data contracts.
//!
//! Reads the canonical Rust contract types and produces:
//! - TypeScript type definitions (via Specta) for frontend + sidecar
//! - JSON Schema constants (via Schemars) for SDK outputFormat
//!   Post-processed for Anthropic API compatibility:
//!   - JSON Schema draft-07 (API rejects draft-2020-12)
//!   - `additionalProperties: false` on all objects (API requirement)
//!   - Recursive `$ref` cycles flattened to `{ "type": "object" }`

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use schemars::generate::SchemaSettings;
use specta::TypeCollection;
use specta_typescript::{BigIntExportBehavior, Typescript};

/// Generate a JSON Schema using draft-07 (required by the Anthropic API).
///
/// Schemars v1 defaults to draft-2020-12 which the API silently rejects.
/// See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/105
fn draft07_schema_for<T: schemars::JsonSchema>() -> serde_json::Value {
    let schema = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<T>();
    let deep = serde_json::to_value(schema).expect("schema must serialize");
    make_sdk_schema(&deep)
}

// ── SDK schema post-processing ────────────────────────────────────────────────

/// Transform a deep JSON Schema into an Anthropic API-compatible schema:
/// 1. Add `additionalProperties: false` to every object with properties
/// 2. Detect recursive `$ref` cycles and replace them with `{ "type": "object" }`
fn make_sdk_schema(schema: &serde_json::Value) -> serde_json::Value {
    let mut sdk = schema.clone();

    // First pass: find all definition names involved in recursive $ref cycles
    let recursive_defs = find_recursive_refs(&sdk);

    // Second pass: flatten recursive refs + add additionalProperties: false
    transform_for_sdk(&mut sdk, &recursive_defs);

    sdk
}

/// Walk the definitions graph and find definition names that are part of a cycle.
fn find_recursive_refs(schema: &serde_json::Value) -> HashSet<String> {
    let definitions = schema
        .get("definitions")
        .and_then(|d| d.as_object())
        .cloned()
        .unwrap_or_default();

    let mut recursive = HashSet::new();

    for def_name in definitions.keys() {
        let mut visited = HashSet::new();
        if has_cycle(def_name, &definitions, &mut visited) {
            recursive.insert(def_name.clone());
        }
    }

    recursive
}

/// DFS: does following $ref from `current` eventually lead back to `current`?
fn has_cycle(
    current: &str,
    definitions: &serde_json::Map<String, serde_json::Value>,
    visited: &mut HashSet<String>,
) -> bool {
    if !visited.insert(current.to_string()) {
        return true; // back-edge found
    }

    if let Some(def) = definitions.get(current) {
        for ref_target in collect_refs(def) {
            if has_cycle(&ref_target, definitions, visited) {
                return true;
            }
        }
    }

    visited.remove(current);
    false
}

/// Collect all `$ref` target definition names from a schema node, recursively.
fn collect_refs(value: &serde_json::Value) -> Vec<String> {
    let mut refs = Vec::new();
    collect_refs_inner(value, &mut refs);
    refs
}

fn collect_refs_inner(value: &serde_json::Value, refs: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::String(r)) = map.get("$ref") {
                if let Some(name) = r.strip_prefix("#/definitions/") {
                    refs.push(name.to_string());
                }
            }
            for v in map.values() {
                collect_refs_inner(v, refs);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_refs_inner(v, refs);
            }
        }
        _ => {}
    }
}

/// Walk the schema tree and apply SDK transformations:
/// - Replace `$ref` to recursive definitions with `{ "type": "object" }`
/// - Add `"additionalProperties": false` to every object with `"properties"`
fn transform_for_sdk(value: &mut serde_json::Value, recursive_defs: &HashSet<String>) {
    match value {
        serde_json::Value::Object(map) => {
            // Replace recursive $ref with { "type": "object" }
            if let Some(serde_json::Value::String(r)) = map.get("$ref") {
                if let Some(name) = r.strip_prefix("#/definitions/") {
                    if recursive_defs.contains(name) {
                        *value = serde_json::json!({ "type": "object" });
                        return;
                    }
                }
            }

            // Add additionalProperties: false to objects with properties
            if map.contains_key("properties") {
                map.insert(
                    "additionalProperties".to_string(),
                    serde_json::Value::Bool(false),
                );
            }

            // Recurse into all values
            for v in map.values_mut() {
                transform_for_sdk(v, recursive_defs);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                transform_for_sdk(v, recursive_defs);
            }
        }
        _ => {}
    }
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

    // ── 3. Export JSON Schema constants (SDK-compatible) ────────────────────

    let schemas: Vec<(&str, serde_json::Value)> = vec![
        ("RESEARCH_STEP", draft07_schema_for::<ResearchStepOutput>()),
        ("DETAILED_RESEARCH", draft07_schema_for::<DetailedResearchOutput>()),
        ("DECISIONS", draft07_schema_for::<DecisionsOutput>()),
        ("GENERATE_SKILL", draft07_schema_for::<GenerateSkillOutput>()),
        ("ANSWER_EVALUATION", draft07_schema_for::<AnswerEvaluationOutput>()),
        ("CLARIFICATIONS", draft07_schema_for::<ClarificationsFile>()),
    ];

    let mut consts = String::from(
        "// AUTO-GENERATED by codegen \u{2014} do not edit manually\n\
         // Run `cd app/src-tauri && cargo run --bin codegen` to regenerate\n\
         //\n\
         // SDK-compatible: draft-07, additionalProperties: false, no recursive $ref\n\n",
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
