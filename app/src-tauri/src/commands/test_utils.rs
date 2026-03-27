/// Create an in-memory test database with all required tables.
/// Shared across command module tests to avoid duplication.
pub fn create_test_db() -> rusqlite::Connection {
    crate::db::create_test_db_for_tests()
}
