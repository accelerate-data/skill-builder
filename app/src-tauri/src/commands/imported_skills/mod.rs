pub mod bundled;
pub mod frontmatter;
pub mod helpers;
pub mod lifecycle;
pub mod listing;
pub mod upload;

// Re-export everything so callers using `commands::imported_skills::*` continue to work.
pub(crate) use bundled::{purge_stale_bundled_skills, seed_bundled_skills};
pub(crate) use frontmatter::{parse_frontmatter, parse_frontmatter_full, Frontmatter};
pub(crate) use helpers::{
    add_dir_to_zip, copy_dir_recursive, extract_archive, find_skill_md, generate_skill_id,
    get_archive_prefix, validate_skill_name,
};
pub(crate) use lifecycle::delete_imported_skill;
pub(crate) use listing::{export_skill, get_skill_content, list_imported_skills};
pub(crate) use upload::{import_skill_from_file, parse_skill_file};
