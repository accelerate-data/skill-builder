//! Code-generation binary for shared data contracts.
//!
//! Reads the canonical Rust contract types and produces:
//! - TypeScript type definitions (via Specta) for frontend + sidecar
//! - JSON Schema constants (via Schemars) for app-side output contracts
//!   Flat schemas: top-level fields only, nested types
//!   collapsed to `{ "type": "object" }`. Deep validation is done by
//!   Rust's typed serde deserialization, not provider-native schema handling.

use std::fs;
use std::path::Path;

use schemars::generate::SchemaSettings;
use specta::TypeCollection;
use specta_typescript::{BigIntExportBehavior, Typescript};

/// Generate the full (deep) JSON Schema from a Rust type via schemars (draft-07).
///
/// Includes `definitions` with `$ref` pointers for all nested types.
/// Used for reference/review only — the SDK cannot enforce schemas with `$ref`.
fn deep_schema_for<T: schemars::JsonSchema>() -> serde_json::Value {
    let schema = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<T>();
    serde_json::to_value(schema).expect("schema must serialize")
}

/// Generate an **inlined** JSON Schema: all `$ref` pointers resolved into the
/// schema body, no `definitions` block. The app keeps these schemas inline so
/// prompt contracts and validation artifacts can use the same shape.
///
/// Recursive types (e.g. `Question.refinements: Vec<Question>`) are capped at
/// one level of nesting — the recursive `$ref` is replaced with `{"type":"array"}`
/// since SKILL.md says refinements don't have sub-refinements.
fn inline_schema_for<T: schemars::JsonSchema>() -> serde_json::Value {
    let deep = deep_schema_for::<T>();
    let definitions = deep
        .get("definitions")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    let mut resolving = std::collections::HashSet::new();
    let mut result = inline_resolve(&deep, &definitions, &mut resolving);
    // Post-process for compact app contract schemas:
    // 1. Drop definitions (everything is inlined)
    // 2. Drop $schema
    // 3. Drop description (reduces token overhead)
    // 4. Ensure additionalProperties: false on root (SDK requires it)
    if let Some(obj) = result.as_object_mut() {
        obj.remove("definitions");
        obj.remove("$schema");
        obj.remove("description");
        obj.insert("additionalProperties".to_string(), serde_json::json!(false));
    }
    result
}

/// Recursively resolve `$ref` pointers by inlining the referenced definition.
/// Tracks which definitions are currently being resolved to detect cycles.
fn inline_resolve(
    value: &serde_json::Value,
    definitions: &serde_json::Value,
    resolving: &mut std::collections::HashSet<String>,
) -> serde_json::Value {
    match value {
        serde_json::Value::Object(obj) => {
            // If this object has "type": "object" and "properties", add additionalProperties: false
            // (required by Anthropic API on ALL objects, not just root)
            let is_object_with_props = obj.get("type") == Some(&serde_json::json!("object"))
                && obj.contains_key("properties");

            // Direct $ref → inline the definition
            if let Some(ref_str) = obj.get("$ref").and_then(|r| r.as_str()) {
                let def_name = ref_str.trim_start_matches("#/definitions/");
                // Cycle detection: if we're already resolving this type, collapse
                if resolving.contains(def_name) {
                    return serde_json::json!({ "type": "object", "additionalProperties": false });
                }
                if let Some(def) = definitions.get(def_name) {
                    resolving.insert(def_name.to_string());
                    let mut resolved = inline_resolve(def, definitions, resolving);
                    resolving.remove(def_name);
                    // Ensure additionalProperties: false on resolved object
                    if let Some(ro) = resolved.as_object_mut() {
                        if ro.get("type") == Some(&serde_json::json!("object")) {
                            ro.entry("additionalProperties".to_string())
                                .or_insert(serde_json::json!(false));
                        }
                    }
                    return resolved;
                }
                return serde_json::json!({ "type": "object", "additionalProperties": false });
            }

            // allOf with $ref (schemars wraps required nested types in allOf)
            if let Some(all_of) = obj.get("allOf").and_then(|a| a.as_array()) {
                if all_of.len() == 1 {
                    if let Some(ref_val) = all_of[0].get("$ref") {
                        // Resolve the $ref, then merge any sibling fields (default, description)
                        let mut resolved = inline_resolve(
                            &serde_json::json!({ "$ref": ref_val }),
                            definitions,
                            resolving,
                        );
                        // Copy sibling fields from the allOf wrapper
                        if let Some(resolved_obj) = resolved.as_object_mut() {
                            for (k, v) in obj {
                                if k != "allOf" {
                                    resolved_obj.entry(k.clone()).or_insert_with(|| v.clone());
                                }
                            }
                        }
                        return resolved;
                    }
                }
            }

            // anyOf (nullable $ref): resolve each variant
            if let Some(any_of) = obj.get("anyOf").and_then(|a| a.as_array()) {
                let resolved_variants: Vec<serde_json::Value> = any_of
                    .iter()
                    .map(|v| inline_resolve(v, definitions, resolving))
                    .collect();
                let mut new_obj = serde_json::Map::new();
                for (k, v) in obj {
                    if k == "anyOf" {
                        new_obj.insert(
                            k.clone(),
                            serde_json::Value::Array(resolved_variants.clone()),
                        );
                    } else {
                        new_obj.insert(k.clone(), inline_resolve(v, definitions, resolving));
                    }
                }
                return serde_json::Value::Object(new_obj);
            }

            // Recurse into all fields
            let mut new_obj = serde_json::Map::new();
            for (k, v) in obj {
                new_obj.insert(k.clone(), inline_resolve(v, definitions, resolving));
            }
            // Add additionalProperties: false to all object types with properties
            // (required by Anthropic API for structured output enforcement)
            if is_object_with_props {
                new_obj
                    .entry("additionalProperties".to_string())
                    .or_insert(serde_json::json!(false));
            }
            serde_json::Value::Object(new_obj)
        }
        serde_json::Value::Array(arr) => serde_json::Value::Array(
            arr.iter()
                .map(|v| inline_resolve(v, definitions, resolving))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Generate a flat, SDK-compatible JSON Schema from a Rust type.
///
/// 1. Generate the full schema via schemars (draft-07)
/// 2. Flatten: keep only root-level properties, collapse nested types to
///    `{ "type": "object" }` or `{ "type": "array" }`, drop `definitions`
/// 3. Add `additionalProperties: false`
fn flat_schema_for<T: schemars::JsonSchema>() -> serde_json::Value {
    flatten_schema(&deep_schema_for::<T>())
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
        result.insert(
            "properties".to_string(),
            serde_json::Value::Object(flat_props),
        );
    }

    // All properties are required in the SDK schema — the agent should produce
    // every field. Rust serde(default) provides tolerance if fields are missing,
    // but the SDK schema tells the agent they're mandatory.
    if let Some(props) = schema.get("properties").and_then(|p| p.as_object()) {
        let all_keys: Vec<serde_json::Value> = props
            .keys()
            .map(|k| serde_json::Value::String(k.clone()))
            .collect();
        result.insert("required".to_string(), serde_json::Value::Array(all_keys));
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
        let has_null = any_of
            .iter()
            .any(|v| v.get("type") == Some(&serde_json::json!("null")));
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
    Choice, ClarificationsError, ClarificationsFile, ClarificationsMetadata, ClarificationsWarning,
    Note, Question, Section,
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

    // ── 3. Export flat JSON Schema constants for app output contracts ───────
    //
    // Flat schemas: top-level fields + types only, nested objects as
    // { "type": "object" }. The prompt contract carries the envelope; Rust
    // typed deserialization validates the full payload.

    let schemas: Vec<(&str, serde_json::Value)> = vec![
        ("RESEARCH_STEP", flat_schema_for::<ResearchStepOutput>()),
        (
            "DETAILED_RESEARCH",
            flat_schema_for::<DetailedResearchOutput>(),
        ),
        ("DECISIONS", flat_schema_for::<DecisionsOutput>()),
        ("GENERATE_SKILL", flat_schema_for::<GenerateSkillOutput>()),
        (
            "ANSWER_EVALUATION",
            flat_schema_for::<AnswerEvaluationOutput>(),
        ),
        ("CLARIFICATIONS", flat_schema_for::<ClarificationsFile>()),
        // Inlined schemas: all $ref resolved into the body, no definitions block.
        // Recursive types (Question.refinements) are capped at one level.
        (
            "RESEARCH_STEP_INLINE",
            inline_schema_for::<ResearchStepOutput>(),
        ),
        (
            "DETAILED_RESEARCH_INLINE",
            inline_schema_for::<DetailedResearchOutput>(),
        ),
        ("DECISIONS_INLINE", inline_schema_for::<DecisionsOutput>()),
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
    while consts.ends_with("\n\n") {
        consts.pop();
    }

    let schemas_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/generated/schemas.rs");
    write_with_dirs(&schemas_path, &consts)?;
    println!("  wrote {}", schemas_path.display());

    // ── 4. Export inline JSON Schema files for agent reference ────────────
    //
    // Agents read these at runtime to know the exact output structure expected.
    // Deployed to the workspace shared references used by the OpenHands clean-break path.

    let agent_schema_dir =
        project_root().join("../agent-sources/workspace/skills/shared/output-schemas");

    let agent_schemas: Vec<(&str, &str)> = vec![
        ("step-0-research.json", "RESEARCH_STEP_INLINE"),
        ("step-1-detailed-research.json", "DETAILED_RESEARCH_INLINE"),
        ("step-2-decisions.json", "DECISIONS_INLINE"),
    ];

    for (filename, const_name) in &agent_schemas {
        let schema = schemas
            .iter()
            .find(|(n, _)| n == const_name)
            .map(|(_, s)| s);
        if let Some(s) = schema {
            let pretty = serde_json::to_string_pretty(s)?;
            let path = agent_schema_dir.join(filename);
            write_with_dirs(&path, &pretty)?;
            println!("  wrote {}", path.display());
        }
    }

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
