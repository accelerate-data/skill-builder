/// Service layer for business logic that orchestrates DB operations and external I/O.
///
/// Modules here handle fetching, parsing, transforming, and caching data from
/// external sources (e.g., models.dev). Commands (`commands/`) invoke these
/// services; DB modules (`db/`) handle raw SQL CRUD.
pub mod model_catalog;
