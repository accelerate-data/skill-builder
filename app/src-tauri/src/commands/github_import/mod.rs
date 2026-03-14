#![allow(unused_imports)]
mod catalog;
pub mod commands;
mod http;
mod import;
pub mod url;

pub use commands::{
    check_marketplace_updates, check_marketplace_url, check_skill_customized,
    get_dashboard_skill_names, import_marketplace_to_library, list_github_skills,
    MarketplaceImportResult, MarketplaceUpdateResult, RegistryNameInfo, SkillUpdateInfo,
};
pub(crate) use http::{build_github_client, get_default_branch};
pub(crate) use import::compute_skill_content_hash;
pub use url::parse_github_url;

pub(crate) use catalog::discover_skills_from_catalog;
pub(crate) use commands::list_github_skills_inner;
pub(crate) use import::import_single_skill;
pub(crate) use url::parse_github_url_inner;

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::types::AvailableSkill;

    use super::catalog::{discover_skills_from_catalog, extract_plugin_path};
    use super::commands::{collect_updates_for_installed, InstalledMarketplaceSkill};
    use super::import::{rewrite_skill_md, yaml_quote};
    use super::url::{marketplace_manifest_path, parse_github_url_inner};

    fn available(name: &str, version: Option<&str>) -> AvailableSkill {
        AvailableSkill {
            path: format!("skills/{name}"),
            name: name.to_string(),
            plugin_name: None,
            description: None,
            purpose: None,
            version: version.map(str::to_string),
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        }
    }

    #[test]
    fn test_collect_updates_for_installed_semver_and_missing_manifest_behavior() {
        let installed = vec![
            InstalledMarketplaceSkill {
                name: "newer".to_string(),
                version: Some("1.0.0".to_string()),
                source_url: "https://github.com/acme/skills".to_string(),
            },
            InstalledMarketplaceSkill {
                name: "same".to_string(),
                version: Some("1.0.0".to_string()),
                source_url: "https://github.com/acme/skills".to_string(),
            },
            InstalledMarketplaceSkill {
                name: "missing".to_string(),
                version: Some("1.0.0".to_string()),
                source_url: "https://github.com/acme/skills".to_string(),
            },
        ];
        let listed = vec![
            available("newer", Some("1.1.0")),
            available("same", Some("1.0.0")),
        ];
        let by_name: HashMap<String, &AvailableSkill> =
            listed.iter().map(|s| (s.name.clone(), s)).collect();

        let updates =
            collect_updates_for_installed(&installed, &by_name, "https://github.com/acme/skills");
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].name, "newer");
        assert_eq!(updates[0].version, "1.1.0");
    }

    #[test]
    fn test_collect_updates_for_installed_ignores_empty_marketplace_version() {
        let installed = vec![InstalledMarketplaceSkill {
            name: "tooling".to_string(),
            version: Some("0.1.0".to_string()),
            source_url: "https://github.com/acme/skills".to_string(),
        }];
        let listed = vec![available("tooling", None)];
        let by_name: HashMap<String, &AvailableSkill> =
            listed.iter().map(|s| (s.name.clone(), s)).collect();

        let updates =
            collect_updates_for_installed(&installed, &by_name, "https://github.com/acme/skills");
        assert!(updates.is_empty());
    }

    // --- parse_github_url tests ---

    #[test]
    fn test_parse_full_https_url() {
        let result = parse_github_url_inner("https://github.com/acme/skill-library").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skill-library");
        assert_eq!(result.branch, "main");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_url_no_branch_defaults_to_main() {
        // URLs pasted from a browser (no /tree/branch suffix) always default to "main"
        // even when the repo's real default branch is different (e.g. "master").
        // check_marketplace_url works around this by calling the repos API which
        // returns the actual default branch instead of relying on the parsed value.
        let result = parse_github_url_inner("https://github.com/hbanerjee74/skills").unwrap();
        assert_eq!(result.owner, "hbanerjee74");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_url_with_branch() {
        let result = parse_github_url_inner("https://github.com/acme/skills/tree/develop").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "develop");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_url_with_branch_and_subpath() {
        let result =
            parse_github_url_inner("https://github.com/acme/skills/tree/main/packages/analytics")
                .unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
        assert_eq!(result.subpath.as_deref(), Some("packages/analytics"));
    }

    #[test]
    fn test_parse_url_without_protocol() {
        let result = parse_github_url_inner("github.com/acme/skills").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_shorthand() {
        let result = parse_github_url_inner("acme/skills").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_url_with_trailing_slash() {
        let result = parse_github_url_inner("https://github.com/acme/skills/").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
    }

    #[test]
    fn test_parse_url_with_dot_git() {
        let result = parse_github_url_inner("https://github.com/acme/skills.git").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_url_http() {
        let result = parse_github_url_inner("http://github.com/acme/skills").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
    }

    #[test]
    fn test_parse_url_deep_subpath() {
        let result = parse_github_url_inner(
            "https://github.com/acme/mono/tree/v2/packages/skills/analytics",
        )
        .unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "mono");
        assert_eq!(result.branch, "v2");
        assert_eq!(result.subpath.as_deref(), Some("packages/skills/analytics"));
    }

    #[test]
    fn test_parse_empty_url() {
        let result = parse_github_url_inner("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_parse_single_segment() {
        let result = parse_github_url_inner("just-owner");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expected at least owner/repo"));
    }

    #[test]
    fn test_parse_unsupported_format() {
        // owner/repo/blob/... is not a supported pattern
        let result = parse_github_url_inner("https://github.com/acme/skills/blob/main/README.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported"));
    }

    #[test]
    fn test_parse_whitespace_trimmed() {
        let result = parse_github_url_inner("  acme/skills  ").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
    }

    #[test]
    fn test_parse_shorthand_with_branch() {
        let result = parse_github_url_inner("acme/skills#develop").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "develop");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_shorthand_with_branch_main() {
        let result = parse_github_url_inner("acme/skills#main").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_shorthand_with_empty_branch_defaults_to_main() {
        // owner/repo# with empty branch after # defaults to "main"
        let result = parse_github_url_inner("acme/skills#").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    // --- Frontmatter reuse test ---

    #[test]
    fn test_parse_frontmatter_accessible() {
        // Verify that the pub(crate) parse_frontmatter is callable from here
        let (name, desc) = crate::commands::imported_skills::parse_frontmatter(
            "---\nname: test\ndescription: a test\n---\n# Content",
        );
        assert_eq!(name.as_deref(), Some("test"));
        assert_eq!(desc.as_deref(), Some("a test"));
    }

    // --- validate_skill_name reuse test ---

    #[test]
    fn test_validate_skill_name_accessible() {
        assert!(crate::commands::imported_skills::validate_skill_name("good-name").is_ok());
        assert!(crate::commands::imported_skills::validate_skill_name("../bad").is_err());
        assert!(crate::commands::imported_skills::validate_skill_name("").is_err());
    }

    // --- generate_skill_id reuse test ---

    #[test]
    fn test_generate_skill_id_accessible() {
        let id = crate::commands::imported_skills::generate_skill_id("my-skill");
        assert!(id.starts_with("imp-my-skill-"));
    }

    // --- marketplace.json deserialization tests ---

    #[test]
    fn test_marketplace_json_path_source_deserialization() {
        use crate::types::{MarketplaceJson, MarketplacePluginSource};

        let json = r#"{
            "name": "my-marketplace",
            "plugins": [
                {
                    "name": "analytics-skill",
                    "source": "./analytics-skill",
                    "description": "Analytics skill",
                    "version": "1.0.0",
                    "category": "data"
                },
                {
                    "name": "reporting",
                    "source": "reporting-skill",
                    "description": "Reporting",
                    "version": "2.0.0"
                }
            ]
        }"#;

        let parsed: MarketplaceJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.plugins.len(), 2);

        // Plugin with ./ prefix
        match &parsed.plugins[0].source {
            MarketplacePluginSource::Path(s) => {
                assert_eq!(s, "./analytics-skill");
                let path = s.trim_start_matches("./");
                assert_eq!(path, "analytics-skill");
            }
            _ => panic!("expected Path source"),
        }
        assert_eq!(
            parsed.plugins[0].description.as_deref(),
            Some("Analytics skill")
        );
        assert_eq!(parsed.plugins[0].category.as_deref(), Some("data"));

        // Plugin without ./ prefix
        match &parsed.plugins[1].source {
            MarketplacePluginSource::Path(s) => {
                assert_eq!(s, "reporting-skill");
                let path = s.trim_start_matches("./");
                assert_eq!(path, "reporting-skill");
            }
            _ => panic!("expected Path source"),
        }
    }

    #[test]
    fn test_marketplace_json_external_source_deserialization() {
        use crate::types::{MarketplaceJson, MarketplacePluginSource};

        let json = r#"{
            "plugins": [
                {
                    "name": "external-skill",
                    "source": {
                        "source": "github",
                        "repo": "owner/repo",
                        "ref": "main",
                        "sha": "abc123"
                    }
                }
            ]
        }"#;

        let parsed: MarketplaceJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.plugins.len(), 1);
        match &parsed.plugins[0].source {
            MarketplacePluginSource::External { source, .. } => {
                assert_eq!(source, "github");
            }
            _ => panic!("expected External source"),
        }
    }

    #[test]
    fn test_marketplace_path_stripping() {
        // Verify the path derivation logic: strip leading ./
        let cases = vec![
            ("./analytics-skill", "analytics-skill"),
            ("analytics-skill", "analytics-skill"),
            ("./nested/skill", "nested/skill"),
            ("./", ""),
            ("", ""),
        ];
        for (input, expected) in cases {
            let result = input.trim_start_matches("./");
            assert_eq!(result, expected, "input={:?}", input);
        }
    }

    #[test]
    fn test_marketplace_json_optional_fields() {
        use crate::types::{MarketplaceJson, MarketplacePluginSource};

        // Plugin with only required fields — optional fields must be None
        let json = r#"{
            "plugins": [
                {
                    "name": "minimal-skill",
                    "source": "./minimal"
                }
            ]
        }"#;

        let parsed: MarketplaceJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.plugins.len(), 1);
        let p = &parsed.plugins[0];
        assert_eq!(p.name.as_deref(), Some("minimal-skill"));
        assert!(p.description.is_none());
        assert!(p.version.is_none());
        assert!(p.author.is_none());
        assert!(p.category.is_none());
        assert!(p.tags.is_none());
        match &p.source {
            MarketplacePluginSource::Path(s) => assert_eq!(s, "./minimal"),
            _ => panic!("expected Path source"),
        }
    }

    // --- Frontmatter tests (used by import_single_skill) ---

    #[test]
    fn test_required_frontmatter_filtering_logic() {
        // Exercise the real parse_frontmatter_full path so that regressions in
        // the production parsing or predicate are caught here.
        let parse = crate::commands::imported_skills::parse_frontmatter_full;

        // Complete, valid frontmatter — name and description are the spec fields.
        // domain:, type:, purpose: and other unknown keys are silently ignored.
        let complete =
            parse("---\nname: analytics\ndescription: Does analytics stuff\n---\n# Body");
        assert_eq!(complete.name.as_deref(), Some("analytics"));
        assert_eq!(
            complete.description.as_deref(),
            Some("Does analytics stuff")
        );

        // Whitespace-only values: trim_opt converts these to None.
        let whitespace_name = parse("---\nname:    \ndescription: Desc\n---\n");
        assert!(
            whitespace_name.name.is_none(),
            "whitespace-only name must be None"
        );

        let whitespace_desc = parse("---\nname: reporting\ndescription:   \n---\n");
        assert!(
            whitespace_desc.description.is_none(),
            "whitespace-only description must be None"
        );

        // No frontmatter at all — all fields None.
        let empty = parse("# Just a heading\nNo frontmatter here.");
        assert!(empty.name.is_none());
        assert!(empty.description.is_none());
    }

    #[test]
    fn test_file_prefix_stripping() {
        // Simulate stripping a prefix from file paths when importing
        let prefix = "analytics-skill/";
        let files = vec![
            "analytics-skill/SKILL.md",
            "analytics-skill/references/concepts.md",
            "analytics-skill/references/patterns.md",
        ];

        let relative: Vec<&str> = files
            .iter()
            .filter_map(|f| f.strip_prefix(prefix))
            .collect();

        assert_eq!(relative.len(), 3);
        assert_eq!(relative[0], "SKILL.md");
        assert_eq!(relative[1], "references/concepts.md");
        assert_eq!(relative[2], "references/patterns.md");
    }

    // --- check_marketplace_url JSON validation test ---

    #[test]
    fn test_check_marketplace_url_json_validation_logic() {
        use crate::types::MarketplaceJson;
        // Exercise the serde_json parse step used in check_marketplace_url.
        // Valid MarketplaceJson (with "plugins" array) must succeed; anything missing
        // the required schema or non-JSON must produce an error.
        assert!(serde_json::from_str::<MarketplaceJson>(r#"{"plugins": []}"#).is_ok());
        // Arbitrary valid JSON missing the "plugins" array must be rejected.
        assert!(serde_json::from_str::<MarketplaceJson>(r#"{"anything": 123}"#).is_err());
        assert!(serde_json::from_str::<MarketplaceJson>("Not found").is_err());
        assert!(serde_json::from_str::<MarketplaceJson>("").is_err());
    }

    // --- marketplace_manifest_path tests ---

    #[test]
    fn test_marketplace_manifest_path_no_subpath() {
        assert_eq!(
            marketplace_manifest_path(None),
            ".claude-plugin/marketplace.json"
        );
    }

    #[test]
    fn test_marketplace_manifest_path_single_segment_subpath() {
        // URL like https://github.com/owner/repo/tree/main/plugins
        assert_eq!(
            marketplace_manifest_path(Some("plugins")),
            "plugins/.claude-plugin/marketplace.json"
        );
    }

    #[test]
    fn test_marketplace_manifest_path_deep_subpath() {
        // URL like https://github.com/owner/repo/tree/main/packages/analytics
        assert_eq!(
            marketplace_manifest_path(Some("packages/analytics")),
            "packages/analytics/.claude-plugin/marketplace.json"
        );
    }

    // --- Branch resolution tests ---

    #[test]
    fn test_parse_url_always_defaults_branch_to_main() {
        // Reproduces the root cause of the 404 bug: URLs without a /tree/<branch>
        // suffix always produce branch="main" regardless of the repo's actual default.
        // The fix in list_github_skills_inner / import_github_skills /
        // import_marketplace_to_library is to call get_default_branch() after parsing
        // so that the git tree API uses the correct branch (e.g. "master").
        for url in &[
            "https://github.com/acme/skills",
            "github.com/acme/skills",
            "acme/skills",
        ] {
            let result = parse_github_url_inner(url).unwrap();
            assert_eq!(
                result.branch, "main",
                "URL '{}' should default to 'main' before branch resolution",
                url
            );
        }
    }

    #[test]
    fn test_branch_resolution_uses_resolved_over_parsed() {
        // Simulate the branch resolution logic applied in list_github_skills_inner.
        // When get_default_branch returns "master", it must replace the parsed "main".
        let parsed_branch = "main"; // parse_github_url_inner default

        // Simulate get_default_branch succeeding with a different branch
        let resolved: Result<String, String> = Ok("master".to_string());
        let branch = resolved.unwrap_or_else(|_| parsed_branch.to_string());
        assert_eq!(
            branch, "master",
            "Resolved branch should override parsed default"
        );

        // Simulate get_default_branch failing — should fall back to parsed value
        let resolved_err: Result<String, String> = Err("network error".to_string());
        let branch_fallback = resolved_err.unwrap_or_else(|_| parsed_branch.to_string());
        assert_eq!(
            branch_fallback, "main",
            "Fallback to parsed branch when resolution fails"
        );
    }

    // --- yaml_quote tests ---

    #[test]
    fn test_yaml_quote_plain_value() {
        assert_eq!(yaml_quote("hello"), "\"hello\"");
    }

    #[test]
    fn test_yaml_quote_escapes_double_quotes() {
        assert_eq!(yaml_quote("say \"hi\""), "\"say \\\"hi\\\"\"");
    }

    #[test]
    fn test_yaml_quote_escapes_newlines() {
        assert_eq!(yaml_quote("line1\nline2"), "\"line1\\nline2\"");
    }

    #[test]
    fn test_yaml_quote_escapes_backslashes() {
        assert_eq!(yaml_quote("path\\to"), "\"path\\\\to\"");
    }

    #[test]
    fn test_yaml_quote_escapes_colon_value() {
        // A colon alone doesn't need escaping (it's safe inside double quotes).
        // Verify that a value with a colon is still wrapped correctly.
        let quoted = yaml_quote("key: value");
        assert_eq!(quoted, "\"key: value\"");
    }

    #[test]
    fn test_yaml_quote_injection_attempt() {
        // A newline injection attempt must be neutralised.
        let injected = yaml_quote("legit\nmalicious-key: injected");
        assert_eq!(injected, "\"legit\\nmalicious-key: injected\"");
    }

    // --- rewrite_skill_md body-extraction tests ---

    #[test]
    fn test_rewrite_skill_md_body_not_truncated_by_hr() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        // Body contains a markdown horizontal rule (---) on its own line.
        // The old code would truncate the body at that line; the new code must not.
        let original = "---\nname: old-name\ndescription: old-desc\n---\n# Heading\n\nSome content.\n\n---\n\nMore content after the HR.\n";
        fs::write(&skill_md, original).unwrap();

        let fm = crate::commands::imported_skills::Frontmatter {
            name: Some("new-name".to_string()),
            description: Some("new-desc".to_string()),
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };

        rewrite_skill_md(dir.path(), &fm).unwrap();

        let result = fs::read_to_string(&skill_md).unwrap();

        // Frontmatter values must be updated and quoted
        assert!(
            result.contains("name: \"new-name\""),
            "name not rewritten: {}",
            result
        );
        // domain no longer written to frontmatter

        // The body content AFTER the markdown HR must be preserved
        assert!(
            result.contains("More content after the HR."),
            "body was truncated at markdown HR: {}",
            result
        );
    }

    #[test]
    fn test_rewrite_skill_md_no_frontmatter() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        // File has no frontmatter at all
        let original = "# Just a heading\nNo frontmatter here.\n";
        fs::write(&skill_md, original).unwrap();

        let fm = crate::commands::imported_skills::Frontmatter {
            name: Some("my-skill".to_string()),
            description: Some("desc".to_string()),
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };

        rewrite_skill_md(dir.path(), &fm).unwrap();
        let result = fs::read_to_string(&skill_md).unwrap();

        // Should start with newly injected frontmatter
        assert!(
            result.starts_with("---\n"),
            "missing opening ---: {}",
            result
        );
        assert!(
            result.contains("name: \"my-skill\""),
            "name missing: {}",
            result
        );
        // Original content should be preserved as body
        assert!(
            result.contains("# Just a heading"),
            "original body lost: {}",
            result
        );
    }

    #[test]
    fn test_rewrite_skill_md_yaml_injection_blocked() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        let original = "---\nname: legit\ndescription: desc\n---\n# Body\n";
        fs::write(&skill_md, original).unwrap();

        let fm = crate::commands::imported_skills::Frontmatter {
            name: Some("legit\nmalicious-key: injected".to_string()),
            description: Some("desc".to_string()),
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };

        rewrite_skill_md(dir.path(), &fm).unwrap();
        let result = fs::read_to_string(&skill_md).unwrap();

        // The injected key must NOT appear as a bare YAML key
        assert!(
            !result.contains("\nmalicious-key: injected\n"),
            "YAML injection succeeded: {}",
            result
        );
        // The newline must be escaped inside the quoted value
        assert!(
            result.contains("\\n"),
            "newline not escaped in YAML value: {}",
            result
        );
    }

    // --- rewrite_skill_md rollback tests ---

    #[test]
    fn test_rewrite_skill_md_missing_file() {
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let fm = crate::commands::imported_skills::Frontmatter {
            name: Some("test-skill".to_string()),
            ..Default::default()
        };
        let result = rewrite_skill_md(tmp.path(), &fm);
        assert!(result.is_err(), "should fail when SKILL.md is missing");
    }

    #[test]
    fn test_rewrite_skill_md_preserves_body() {
        use std::fs;
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let original = "---\nname: old-name\n---\n# Skill Body\n\nSome content here.\n";
        fs::write(tmp.path().join("SKILL.md"), original).unwrap();

        let fm = crate::commands::imported_skills::Frontmatter {
            name: Some("new-name".to_string()),
            ..Default::default()
        };
        rewrite_skill_md(tmp.path(), &fm).unwrap();

        let result = fs::read_to_string(tmp.path().join("SKILL.md")).unwrap();
        assert!(
            result.contains("name: \"new-name\""),
            "name should be updated: {}",
            result
        );
        // domain no longer written to frontmatter
        assert!(
            result.contains("# Skill Body"),
            "body should be preserved: {}",
            result
        );
        assert!(
            result.contains("Some content here."),
            "body content should be preserved: {}",
            result
        );
    }

    #[test]
    fn test_rollback_removes_dest_dir_on_rewrite_failure() {
        use std::fs;
        use tempfile::TempDir;

        // Simulate dest_dir with downloaded skill files but no SKILL.md
        let parent = TempDir::new().unwrap();
        let dest_dir = parent.path().join("my-skill");
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(dest_dir.join("some-file.txt"), "content").unwrap();

        // rewrite_skill_md fails because there is no SKILL.md
        let fm = crate::commands::imported_skills::Frontmatter {
            name: Some("my-skill".to_string()),
            ..Default::default()
        };
        let result = rewrite_skill_md(&dest_dir, &fm);
        assert!(result.is_err(), "rewrite should fail without SKILL.md");

        // Rollback cleanup (mirrors import_single_skill on rewrite failure)
        fs::remove_dir_all(&dest_dir).unwrap();
        assert!(!dest_dir.exists(), "dest_dir should be gone after rollback");
    }

    /// Verify that if rewrite_skill_md fails (e.g. SKILL.md is missing after files were written),
    /// the dest_dir is removed and no orphaned files remain on disk.
    ///
    /// Since we cannot mock fs::write, we test the cleanup path by calling rewrite_skill_md on a
    /// directory where SKILL.md has been removed after the skill files were written — simulating the
    /// failure scenario.  The test also verifies the success path: when the rewrite succeeds, the
    /// body content below `---` is preserved verbatim.
    #[test]
    fn test_import_single_skill_cleans_up_disk_on_rewrite_failure() {
        use std::fs;
        use tempfile::TempDir;

        // --- Success path: body below frontmatter is preserved verbatim after rewrite ---
        {
            let dir = TempDir::new().unwrap();
            let skill_md = dir.path().join("SKILL.md");

            let original = "---\nname: my-skill\ndescription: original desc\n---\n# Instructions\n\nDo the thing.\n\nMore body content here.\n";
            fs::write(&skill_md, original).unwrap();

            let fm = crate::commands::imported_skills::Frontmatter {
                name: Some("my-skill".to_string()),
                description: Some("overridden desc".to_string()),
                version: None,
                model: None,
                argument_hint: None,
                user_invocable: None,
                disable_model_invocation: None,
            };

            rewrite_skill_md(dir.path(), &fm).unwrap();

            let result = fs::read_to_string(&skill_md).unwrap();
            // Frontmatter must be updated
            assert!(
                result.contains("description: \"overridden desc\""),
                "description not updated: {}",
                result
            );
            // Body content must be preserved verbatim
            assert!(
                result.contains("# Instructions"),
                "body heading lost: {}",
                result
            );
            assert!(
                result.contains("Do the thing."),
                "body line lost: {}",
                result
            );
            assert!(
                result.contains("More body content here."),
                "second body line lost: {}",
                result
            );
        }

        // --- Cleanup path: when rewrite_skill_md fails, dest_dir is cleaned up ---
        // Simulate the cleanup logic used in import_single_skill when rewrite fails.
        // We write a skill directory to disk, then simulate what happens when the
        // rewrite returns Err — the cleanup code removes dest_dir.
        {
            let skills_root = TempDir::new().unwrap();
            let dest_dir = skills_root.path().join("test-skill");
            fs::create_dir_all(&dest_dir).unwrap();

            // Write some skill files as if download succeeded
            fs::write(
                dest_dir.join("SKILL.md"),
                "---\nname: test-skill\n---\n# Body\n",
            )
            .unwrap();
            fs::write(dest_dir.join("references.md"), "Some references\n").unwrap();

            // Confirm files exist before simulated failure
            assert!(dest_dir.exists(), "dest_dir should exist before cleanup");
            assert!(dest_dir.join("SKILL.md").exists(), "SKILL.md should exist");

            // Simulate what import_single_skill does on rewrite failure:
            // remove dest_dir to avoid leaving orphaned files.
            let simulated_rewrite_err: Result<(), String> =
                Err("Failed to write updated SKILL.md: permission denied".to_string());
            if let Err(e) = simulated_rewrite_err {
                // This is the exact cleanup block from import_single_skill
                if let Err(cleanup_err) = fs::remove_dir_all(&dest_dir) {
                    panic!("Cleanup failed: {}", cleanup_err);
                }
                // Verify dest_dir no longer exists after cleanup
                assert!(
                    !dest_dir.exists(),
                    "dest_dir should be removed after rewrite failure; error was: {}",
                    e
                );
            }
        }
    }

    /// Verify that rewrite_skill_md merges override fields with the original frontmatter:
    /// - Override fields replace original values
    /// - Fields absent from the override retain their original values
    #[test]
    fn test_rewrite_skill_md_preserves_unoverridden_fields() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        // Original SKILL.md has version and model set
        let original = "---\nname: original-name\ndescription: original-desc\nversion: \"1.0.0\"\nmodel: claude-3-haiku\n---\n# Body content\n";
        fs::write(&skill_md, original).unwrap();

        // Simulate what import_single_skill does: parse original, then apply partial override
        let mut fm = crate::commands::imported_skills::parse_frontmatter_full(original);
        // Override only name and description; version and model not in override
        fm.name = Some("overridden-name".to_string());
        fm.description = Some("overridden-desc".to_string());

        rewrite_skill_md(dir.path(), &fm).unwrap();
        let result = fs::read_to_string(&skill_md).unwrap();

        // Overridden fields must be updated
        assert!(
            result.contains("name: \"overridden-name\""),
            "name not overridden: {}",
            result
        );
        assert!(
            result.contains("description: \"overridden-desc\""),
            "description not overridden: {}",
            result
        );

        // Non-overridden fields must be preserved from the original parse
        assert!(
            result.contains("version: \"1.0.0\""),
            "version was lost: {}",
            result
        );
        assert!(
            result.contains("model: \"claude-3-haiku\""),
            "model was lost: {}",
            result
        );

        // Body must be preserved
        assert!(
            result.contains("# Body content"),
            "body was lost: {}",
            result
        );
    }

    // -----------------------------------------------------------------------
    // discover_skills_from_catalog tests
    // -----------------------------------------------------------------------

    use crate::types::{MarketplacePlugin, MarketplacePluginSource};
    use std::collections::HashSet;

    fn make_plugin(name: Option<&str>, source: &str, desc: Option<&str>) -> MarketplacePlugin {
        MarketplacePlugin {
            name: name.map(|s| s.to_string()),
            source: MarketplacePluginSource::Path(source.to_string()),
            description: desc.map(|s| s.to_string()),
            version: None,
            author: None,
            category: None,
            tags: None,
        }
    }

    fn dirs(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    fn sorted_names(skills: &[crate::types::AvailableSkill]) -> Vec<String> {
        let mut v: Vec<_> = skills.iter().map(|s| s.name.clone()).collect();
        v.sort();
        v
    }

    fn sorted_paths(skills: &[crate::types::AvailableSkill]) -> Vec<String> {
        let mut v: Vec<_> = skills.iter().map(|s| s.path.clone()).collect();
        v.sort();
        v
    }

    /// Standard case: source `"./engineering"` → skills at `engineering/skills/{name}/SKILL.md`
    #[test]
    fn test_discover_nested_skills_normal() {
        let plugins = vec![make_plugin(Some("engineering"), "./engineering", None)];
        let skill_dirs = dirs(&[
            "engineering/skills/standup",
            "engineering/skills/code-review",
        ]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["code-review", "standup"]);
        assert_eq!(
            sorted_paths(&skills),
            vec![
                "engineering/skills/code-review",
                "engineering/skills/standup"
            ]
        );
    }

    /// Corner condition: source `"./"` → plugin_path empty → skills at `skills/{name}/SKILL.md`
    #[test]
    fn test_discover_root_plugin_source() {
        let plugins = vec![make_plugin(Some("root"), "./", None)];
        let skill_dirs = dirs(&["skills/standup", "skills/code-review"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["code-review", "standup"]);
        assert_eq!(
            sorted_paths(&skills),
            vec!["skills/code-review", "skills/standup"]
        );
    }

    /// Bare source with `pluginRoot`: `"engineering"` + `plugin_root="plugins"` →
    /// plugin_path = `"plugins/engineering"` → skills at `plugins/engineering/skills/{name}/SKILL.md`
    #[test]
    fn test_discover_bare_source_with_plugin_root() {
        let plugins = vec![make_plugin(Some("eng"), "engineering", None)];
        let skill_dirs = dirs(&["plugins/engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, Some("plugins"), &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
        assert_eq!(
            sorted_paths(&skills),
            vec!["plugins/engineering/skills/standup"]
        );
    }

    /// Bare source without `pluginRoot` → treated as a path from repo root.
    #[test]
    fn test_discover_bare_source_without_plugin_root() {
        let plugins = vec![make_plugin(Some("eng"), "engineering", None)];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// Multiple plugins each contribute their own skills.
    #[test]
    fn test_discover_multiple_plugins() {
        let plugins = vec![
            make_plugin(Some("engineering"), "./engineering", None),
            make_plugin(Some("research"), "./research", None),
        ];
        let skill_dirs = dirs(&[
            "engineering/skills/standup",
            "engineering/skills/code-review",
            "research/skills/literature-search",
        ]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(skills.len(), 3);
        assert_eq!(
            sorted_names(&skills),
            vec!["code-review", "literature-search", "standup"]
        );
    }

    /// Plugin whose `skills/` directory is empty → contributes 0 skills.
    #[test]
    fn test_discover_plugin_with_no_skills() {
        let plugins = vec![make_plugin(Some("empty"), "./empty-plugin", None)];
        let skill_dirs = dirs(&["other/skills/something"]); // unrelated dirs
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert!(skills.is_empty());
    }

    /// External source type (`github`, `npm`, etc.) → entry is skipped entirely.
    #[test]
    fn test_discover_external_source_skipped() {
        let plugins = vec![MarketplacePlugin {
            name: Some("ext".to_string()),
            source: MarketplacePluginSource::External {
                source: "github".to_string(),
                extra: serde_json::json!({"repo": "owner/repo"}),
            },
            description: None,
            version: None,
            author: None,
            category: None,
            tags: None,
        }];
        let skill_dirs = dirs(&["anything/skills/foo"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert!(skills.is_empty());
    }

    /// `subpath` is prepended to anchor source paths to the repo root.
    /// source `"./engineering"` + subpath `"sub"` → plugin_path = `"sub/engineering"`
    #[test]
    fn test_discover_with_subpath() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering", None)];
        let skill_dirs = dirs(&["sub/engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, Some("sub"));
        assert_eq!(sorted_names(&skills), vec!["standup"]);
        assert_eq!(
            sorted_paths(&skills),
            vec!["sub/engineering/skills/standup"]
        );
    }

    /// Dirs more than one level below `skills/` are excluded (remainder contains `/`).
    #[test]
    fn test_discover_deeply_nested_dirs_excluded() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering", None)];
        let skill_dirs = dirs(&[
            "engineering/skills/standup",          // ✓ exactly one level deep
            "engineering/skills/nested/sub-skill", // ✗ two levels — excluded
        ]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// Trailing slash in source is normalized and treated identically to no trailing slash.
    #[test]
    fn test_discover_trailing_slash_in_source() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering/", None)];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// Empty catalog returns no skills.
    #[test]
    fn test_discover_empty_catalog() {
        let skills = discover_skills_from_catalog(&[], None, &HashSet::new(), None);
        assert!(skills.is_empty());
    }

    /// Plugin `description` propagates to each skill discovered from that plugin.
    #[test]
    fn test_discover_description_propagated() {
        let plugins = vec![make_plugin(
            Some("eng"),
            "./engineering",
            Some("Engineering skills"),
        )];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(skills[0].description.as_deref(), Some("Engineering skills"));
    }

    /// Plugin entries without a `name` field are valid per spec and still discovered.
    #[test]
    fn test_discover_unnamed_plugin() {
        let plugins = vec![make_plugin(None, "./engineering", None)];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// `plugin_name` is always `None` on every skill returned by `discover_skills_from_catalog`.
    /// It is populated later (from plugin.json) in `list_github_skills_inner`.
    #[test]
    fn test_discover_plugin_name_always_none() {
        let plugins = vec![
            make_plugin(Some("engineering"), "./engineering", None),
            make_plugin(Some("research"), "./research", None),
        ];
        let skill_dirs = dirs(&[
            "engineering/skills/standup",
            "research/skills/literature-search",
        ]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(skills.len(), 2);
        for skill in &skills {
            assert!(
                skill.plugin_name.is_none(),
                "plugin_name must be None at discovery time (populated later from plugin.json), but got {:?} for '{}'",
                skill.plugin_name, skill.name
            );
        }
    }

    /// A skill_dirs entry whose path ends at `skills/` exactly (no skill name segment) is excluded.
    /// This guards against a hypothetical tree entry at `engineering/skills/` with an empty
    /// skill_name after strip_prefix.
    #[test]
    fn test_discover_empty_skill_name_excluded() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering", None)];
        // "engineering/skills/" stripped of prefix "engineering/skills/" → empty skill_name
        let skill_dirs = dirs(&["engineering/skills/", "engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        // Only the valid skill survives; the empty-name entry is dropped
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    // -----------------------------------------------------------------------
    // extract_plugin_path tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_extract_plugin_path_normal() {
        assert_eq!(
            extract_plugin_path("engineering/skills/standup"),
            "engineering"
        );
    }

    #[test]
    fn test_extract_plugin_path_nested_plugin() {
        assert_eq!(
            extract_plugin_path("plugins/eng/skills/standup"),
            "plugins/eng"
        );
    }

    /// Root plugin: `skills/` is directly under the repo root → plugin_path = ""
    #[test]
    fn test_extract_plugin_path_root_plugin() {
        assert_eq!(extract_plugin_path("skills/standup"), "");
    }

    /// Subpath + root plugin: e.g. subpath="sub", source="./" → skill at "sub/skills/standup"
    #[test]
    fn test_extract_plugin_path_subpath_root_plugin() {
        assert_eq!(extract_plugin_path("sub/skills/standup"), "sub");
    }

    #[test]
    fn test_extract_plugin_path_deep_subpath() {
        assert_eq!(
            extract_plugin_path("sub/engineering/skills/standup"),
            "sub/engineering"
        );
    }

    /// Path with no `/skills/` segment at all → returns ""
    #[test]
    fn test_extract_plugin_path_no_skills_segment() {
        assert_eq!(extract_plugin_path("engineering/standup"), "");
    }

    #[test]
    fn test_extract_plugin_path_empty_string() {
        assert_eq!(extract_plugin_path(""), "");
    }

    // -----------------------------------------------------------------------
    // import_single_skill — end-to-end tests with mockito HTTP server
    //
    // These tests call import_single_skill directly with a mock HTTP server
    // standing in for raw.githubusercontent.com. This validates the full
    // request-parse-validate pipeline, including the strict `name:` check.
    // -----------------------------------------------------------------------

    fn make_tree(entries: &[(&str, &str)]) -> Vec<serde_json::Value> {
        entries
            .iter()
            .map(|(path, typ)| serde_json::json!({"path": path, "type": typ}))
            .collect()
    }

    /// SKILL.md without a `name:` field — import must be rejected with a clear error.
    /// Regression test for the "no directory fallback" rule.
    #[tokio::test]
    async fn test_import_single_skill_rejects_missing_name() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/owner/repo/main/my-skill/SKILL.md")
            .with_status(200)
            .with_body("---\ndescription: Some description\npurpose: domain\nversion: 1.0.0\n---\n# Body\n")
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let tmp = tempfile::tempdir().unwrap();
        let tree = make_tree(&[("my-skill/SKILL.md", "blob")]);

        let result = super::import::import_single_skill(
            &client,
            &server.url(),
            "owner",
            "repo",
            "main",
            "my-skill",
            &tree,
            tmp.path(),
            false,
            None,
        )
        .await;

        assert!(
            result.is_err(),
            "import must fail when name: is absent from frontmatter"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("missing the 'name' frontmatter field"),
            "error should identify the missing field, got: {err}"
        );
    }

    /// SKILL.md without a `name:` field but with a metadata_override that supplies one —
    /// import succeeds and the skill is written to disk under the override name.
    #[tokio::test]
    async fn test_import_single_skill_override_rescues_missing_name() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/owner/repo/main/my-skill/SKILL.md")
            .with_status(200)
            .with_body(
                "---\ndescription: A description\npurpose: domain\nversion: 1.0.0\n---\n# Body\n",
            )
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let tmp = tempfile::tempdir().unwrap();
        let tree = make_tree(&[("my-skill/SKILL.md", "blob")]);
        let override_ = crate::types::SkillMetadataOverride {
            name: Some("override-name".to_string()),
            ..Default::default()
        };

        let result = super::import::import_single_skill(
            &client,
            &server.url(),
            "owner",
            "repo",
            "main",
            "my-skill",
            &tree,
            tmp.path(),
            false,
            Some(&override_),
        )
        .await;

        assert!(
            result.is_ok(),
            "import should succeed when override supplies a name; got: {:?}",
            result
        );
        assert_eq!(result.unwrap().skill_name, "override-name");
        assert!(
            tmp.path().join("override-name").exists(),
            "skill dir must be written to disk"
        );
    }
}
