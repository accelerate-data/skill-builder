//! Validate agent JSON output against Rust contract structs via serde.
//!
//! Usage:
//!   echo '{"status":"research_complete",...}' | cargo run --bin validate-output -- --step 0
//!   cargo run --bin validate-output -- --step 1 --file path/to/output.json
//!
//! Exit 0 = valid, exit 1 = invalid (prints serde error).

use app_lib::contracts::workflow_outputs::{
    DecisionsOutput, DetailedResearchOutput, ResearchStepOutput,
};
use std::io::Read;
use std::process;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let step = args
        .iter()
        .position(|a| a == "--step")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
        .unwrap_or_else(|| {
            eprintln!("Usage: validate-output --step 0|1|2 [--file path.json]");
            process::exit(2);
        });

    let json = if let Some(idx) = args.iter().position(|a| a == "--file") {
        let path = args.get(idx + 1).unwrap_or_else(|| {
            eprintln!("--file requires a path");
            process::exit(2);
        });
        std::fs::read_to_string(path).unwrap_or_else(|e| {
            eprintln!("Failed to read {}: {}", path, e);
            process::exit(2);
        })
    } else {
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .unwrap_or_else(|e| {
                eprintln!("Failed to read stdin: {}", e);
                process::exit(2);
            });
        buf
    };

    let json = json.trim();
    if json.is_empty() {
        eprintln!("Empty input");
        process::exit(1);
    }

    let result = match step {
        "0" => serde_json::from_str::<ResearchStepOutput>(json)
            .map(|v| serde_json::to_string_pretty(&v).unwrap()),
        "1" => serde_json::from_str::<DetailedResearchOutput>(json)
            .map(|v| serde_json::to_string_pretty(&v).unwrap()),
        "2" => serde_json::from_str::<DecisionsOutput>(json)
            .map(|v| serde_json::to_string_pretty(&v).unwrap()),
        other => {
            eprintln!("Unknown step: {}. Use 0, 1, or 2.", other);
            process::exit(2);
        }
    };

    match result {
        Ok(pretty) => {
            println!("{}", pretty);
            process::exit(0);
        }
        Err(e) => {
            eprintln!("Serde validation failed: {}", e);
            process::exit(1);
        }
    }
}
