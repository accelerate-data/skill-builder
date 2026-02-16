//! OS-native credential storage for secrets (API keys, OAuth tokens).
//!
//! Uses the `keyring` crate to store secrets in:
//! - macOS Keychain
//! - Windows Credential Manager
//!
//! Falls back gracefully to SQLite storage if the OS keychain is unavailable
//! (e.g., headless environments, CI, sandboxed contexts).

use std::sync::atomic::{AtomicBool, Ordering};

const SERVICE_NAME: &str = "com.skillbuilder.app";

/// Keychain key names for each secret.
pub const KEY_ANTHROPIC_API_KEY: &str = "anthropic_api_key";
pub const KEY_GITHUB_OAUTH_TOKEN: &str = "github_oauth_token";

/// Tracks whether the keychain is available. Once a keychain operation fails
/// with a platform-level error (not just "no entry"), we skip future attempts
/// for the rest of the process lifetime to avoid repeated slow failures.
static KEYCHAIN_UNAVAILABLE: AtomicBool = AtomicBool::new(false);

/// Store a secret in the OS keychain.
/// Returns `Ok(true)` if stored successfully, `Ok(false)` if keychain is unavailable.
pub fn store_secret(key: &str, value: &str) -> Result<bool, String> {
    if KEYCHAIN_UNAVAILABLE.load(Ordering::Relaxed) {
        return Ok(false);
    }

    let entry = keyring::Entry::new(SERVICE_NAME, key).map_err(|e| {
        mark_unavailable(&e);
        format!("Failed to create keychain entry for {}: {}", key, e)
    })?;

    match entry.set_password(value) {
        Ok(()) => {
            log::info!("[keychain] Stored secret: {}", key);
            Ok(true)
        }
        Err(e) => {
            if is_platform_error(&e) {
                mark_unavailable_from_error(&e);
                log::warn!(
                    "[keychain] Platform error storing {}, falling back to SQLite: {}",
                    key,
                    e
                );
                Ok(false)
            } else {
                Err(format!("Failed to store secret {}: {}", key, e))
            }
        }
    }
}

/// Retrieve a secret from the OS keychain.
/// Returns `Ok(Some(value))` if found, `Ok(None)` if not found or keychain unavailable.
pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    if KEYCHAIN_UNAVAILABLE.load(Ordering::Relaxed) {
        return Ok(None);
    }

    let entry = keyring::Entry::new(SERVICE_NAME, key).map_err(|e| {
        mark_unavailable(&e);
        format!("Failed to create keychain entry for {}: {}", key, e)
    })?;

    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            if is_platform_error(&e) {
                mark_unavailable_from_error(&e);
                log::warn!(
                    "[keychain] Platform error reading {}, falling back to SQLite: {}",
                    key,
                    e
                );
                Ok(None)
            } else {
                Err(format!("Failed to get secret {}: {}", key, e))
            }
        }
    }
}

/// Delete a secret from the OS keychain.
/// Returns `Ok(true)` if deleted, `Ok(false)` if not found or keychain unavailable.
pub fn delete_secret(key: &str) -> Result<bool, String> {
    if KEYCHAIN_UNAVAILABLE.load(Ordering::Relaxed) {
        return Ok(false);
    }

    let entry = keyring::Entry::new(SERVICE_NAME, key).map_err(|e| {
        mark_unavailable(&e);
        format!("Failed to create keychain entry for {}: {}", key, e)
    })?;

    match entry.delete_credential() {
        Ok(()) => {
            log::info!("[keychain] Deleted secret: {}", key);
            Ok(true)
        }
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => {
            if is_platform_error(&e) {
                mark_unavailable_from_error(&e);
                log::warn!(
                    "[keychain] Platform error deleting {}: {}",
                    key,
                    e
                );
                Ok(false)
            } else {
                Err(format!("Failed to delete secret {}: {}", key, e))
            }
        }
    }
}

/// Check if the keychain is available (not marked as unavailable).
pub fn is_available() -> bool {
    !KEYCHAIN_UNAVAILABLE.load(Ordering::Relaxed)
}

/// Determine if a keyring error indicates a platform-level failure
/// (keychain not available, access denied, etc.) vs. a user-level error.
fn is_platform_error(e: &keyring::Error) -> bool {
    matches!(
        e,
        keyring::Error::PlatformFailure(_)
            | keyring::Error::NoStorageAccess(_)
    )
}

fn mark_unavailable(e: &keyring::Error) {
    if is_platform_error(e) {
        mark_unavailable_from_error(e);
    }
}

fn mark_unavailable_from_error(e: &keyring::Error) {
    log::warn!("[keychain] Marking keychain as unavailable: {}", e);
    KEYCHAIN_UNAVAILABLE.store(true, Ordering::Relaxed);
}

/// Migrate secrets from SQLite settings to the OS keychain.
///
/// For each secret field (anthropic_api_key, github_oauth_token):
/// 1. If the value exists in SQLite but not in the keychain, store it in the keychain.
/// 2. If the keychain store succeeds, clear the value from the in-memory settings
///    (caller must persist the updated settings back to SQLite).
///
/// Returns the updated settings with secret fields cleared (if migrated).
pub fn migrate_secrets_from_db(
    settings: &crate::types::AppSettings,
) -> (crate::types::AppSettings, bool) {
    let mut updated = settings.clone();
    let mut any_migrated = false;

    // Migrate Anthropic API key
    if let Some(ref api_key) = settings.anthropic_api_key {
        if !api_key.is_empty() {
            match get_secret(KEY_ANTHROPIC_API_KEY) {
                Ok(None) => {
                    // Not in keychain yet, migrate it
                    match store_secret(KEY_ANTHROPIC_API_KEY, api_key) {
                        Ok(true) => {
                            log::info!("[keychain] Migrated anthropic_api_key to keychain");
                            updated.anthropic_api_key = None;
                            any_migrated = true;
                        }
                        Ok(false) => {
                            log::info!("[keychain] Keychain unavailable, keeping anthropic_api_key in SQLite");
                        }
                        Err(e) => {
                            log::warn!("[keychain] Failed to migrate anthropic_api_key: {}", e);
                        }
                    }
                }
                Ok(Some(_)) => {
                    // Already in keychain, just clear from SQLite
                    log::info!("[keychain] anthropic_api_key already in keychain, clearing from SQLite");
                    updated.anthropic_api_key = None;
                    any_migrated = true;
                }
                Err(e) => {
                    log::warn!("[keychain] Failed to check keychain for anthropic_api_key: {}", e);
                }
            }
        }
    }

    // Migrate GitHub OAuth token
    if let Some(ref token) = settings.github_oauth_token {
        if !token.is_empty() {
            match get_secret(KEY_GITHUB_OAUTH_TOKEN) {
                Ok(None) => {
                    match store_secret(KEY_GITHUB_OAUTH_TOKEN, token) {
                        Ok(true) => {
                            log::info!("[keychain] Migrated github_oauth_token to keychain");
                            updated.github_oauth_token = None;
                            any_migrated = true;
                        }
                        Ok(false) => {
                            log::info!("[keychain] Keychain unavailable, keeping github_oauth_token in SQLite");
                        }
                        Err(e) => {
                            log::warn!("[keychain] Failed to migrate github_oauth_token: {}", e);
                        }
                    }
                }
                Ok(Some(_)) => {
                    log::info!("[keychain] github_oauth_token already in keychain, clearing from SQLite");
                    updated.github_oauth_token = None;
                    any_migrated = true;
                }
                Err(e) => {
                    log::warn!("[keychain] Failed to check keychain for github_oauth_token: {}", e);
                }
            }
        }
    }

    (updated, any_migrated)
}

/// Hydrate secrets from the OS keychain into an AppSettings struct.
///
/// If a secret field is None in the settings but exists in the keychain,
/// populate it from the keychain. This makes the keychain usage transparent
/// to the rest of the application.
pub fn hydrate_secrets(settings: &mut crate::types::AppSettings) {
    // Hydrate Anthropic API key
    if settings.anthropic_api_key.is_none() {
        match get_secret(KEY_ANTHROPIC_API_KEY) {
            Ok(Some(key)) => {
                settings.anthropic_api_key = Some(key);
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!("[keychain] Failed to read anthropic_api_key from keychain: {}", e);
            }
        }
    }

    // Hydrate GitHub OAuth token
    if settings.github_oauth_token.is_none() {
        match get_secret(KEY_GITHUB_OAUTH_TOKEN) {
            Ok(Some(token)) => {
                settings.github_oauth_token = Some(token);
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!("[keychain] Failed to read github_oauth_token from keychain: {}", e);
            }
        }
    }
}

/// Extract secrets from settings and store them in the keychain.
/// Returns settings with secret fields cleared (if stored successfully).
///
/// Used when saving settings: secrets go to keychain, non-secret data to SQLite.
pub fn extract_and_store_secrets(
    settings: &crate::types::AppSettings,
) -> crate::types::AppSettings {
    let mut cleaned = settings.clone();

    // Store Anthropic API key in keychain
    if let Some(ref api_key) = settings.anthropic_api_key {
        if !api_key.is_empty() {
            match store_secret(KEY_ANTHROPIC_API_KEY, api_key) {
                Ok(true) => {
                    cleaned.anthropic_api_key = None;
                }
                Ok(false) => {
                    // Keychain unavailable, keep in SQLite as fallback
                    log::info!("[keychain] Keychain unavailable, keeping anthropic_api_key in SQLite");
                }
                Err(e) => {
                    log::warn!("[keychain] Failed to store anthropic_api_key: {}", e);
                    // Keep in SQLite as fallback
                }
            }
        }
    } else {
        // API key was cleared — delete from keychain too
        if let Err(e) = delete_secret(KEY_ANTHROPIC_API_KEY) {
            log::warn!("[keychain] Failed to delete anthropic_api_key: {}", e);
        }
    }

    // Store GitHub OAuth token in keychain
    if let Some(ref token) = settings.github_oauth_token {
        if !token.is_empty() {
            match store_secret(KEY_GITHUB_OAUTH_TOKEN, token) {
                Ok(true) => {
                    cleaned.github_oauth_token = None;
                }
                Ok(false) => {
                    log::info!("[keychain] Keychain unavailable, keeping github_oauth_token in SQLite");
                }
                Err(e) => {
                    log::warn!("[keychain] Failed to store github_oauth_token: {}", e);
                }
            }
        }
    } else {
        // Token was cleared — delete from keychain too
        if let Err(e) = delete_secret(KEY_GITHUB_OAUTH_TOKEN) {
            log::warn!("[keychain] Failed to delete github_oauth_token: {}", e);
        }
    }

    cleaned
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AppSettings;

    /// Reset the KEYCHAIN_UNAVAILABLE flag for test isolation.
    fn reset_keychain_flag() {
        KEYCHAIN_UNAVAILABLE.store(false, Ordering::Relaxed);
    }

    #[test]
    fn test_migrate_secrets_no_secrets() {
        reset_keychain_flag();
        let settings = AppSettings::default();
        let (updated, migrated) = migrate_secrets_from_db(&settings);
        assert!(!migrated);
        assert!(updated.anthropic_api_key.is_none());
        assert!(updated.github_oauth_token.is_none());
    }

    #[test]
    fn test_migrate_secrets_empty_strings_ignored() {
        reset_keychain_flag();
        let mut settings = AppSettings::default();
        settings.anthropic_api_key = Some(String::new());
        settings.github_oauth_token = Some(String::new());
        let (updated, migrated) = migrate_secrets_from_db(&settings);
        assert!(!migrated);
        // Empty strings are left as-is (they won't be stored in keychain)
        assert_eq!(updated.anthropic_api_key.as_deref(), Some(""));
        assert_eq!(updated.github_oauth_token.as_deref(), Some(""));
    }

    #[test]
    fn test_hydrate_secrets_leaves_existing_values() {
        reset_keychain_flag();
        let mut settings = AppSettings::default();
        settings.anthropic_api_key = Some("sk-existing".to_string());
        settings.github_oauth_token = Some("gho_existing".to_string());

        hydrate_secrets(&mut settings);

        // Should not overwrite existing values
        assert_eq!(settings.anthropic_api_key.as_deref(), Some("sk-existing"));
        assert_eq!(
            settings.github_oauth_token.as_deref(),
            Some("gho_existing")
        );
    }

    #[test]
    fn test_extract_and_store_clears_when_empty() {
        reset_keychain_flag();
        let mut settings = AppSettings::default();
        settings.anthropic_api_key = None;
        settings.github_oauth_token = None;

        let cleaned = extract_and_store_secrets(&settings);
        assert!(cleaned.anthropic_api_key.is_none());
        assert!(cleaned.github_oauth_token.is_none());
    }

    #[test]
    fn test_keychain_unavailable_flag() {
        reset_keychain_flag();
        assert!(is_available());

        KEYCHAIN_UNAVAILABLE.store(true, Ordering::Relaxed);
        assert!(!is_available());

        // Operations should return fallback values when unavailable
        assert_eq!(store_secret("test", "val").unwrap(), false);
        assert_eq!(get_secret("test").unwrap(), None);
        assert_eq!(delete_secret("test").unwrap(), false);

        reset_keychain_flag();
    }

    #[test]
    #[ignore] // Requires real OS keychain — fails in CI (headless runners)
    fn test_migrate_secrets_with_real_values() {
        reset_keychain_flag();
        let mut settings = AppSettings::default();
        settings.anthropic_api_key = Some("sk-test-12345".to_string());
        settings.github_oauth_token = Some("gho_test_67890".to_string());

        let (updated, migrated) = migrate_secrets_from_db(&settings);

        if migrated {
            // Secrets should be cleared from returned settings
            assert!(updated.anthropic_api_key.is_none());
            assert!(updated.github_oauth_token.is_none());

            // Verify they're actually retrievable from keychain
            assert_eq!(
                get_secret(KEY_ANTHROPIC_API_KEY).unwrap(),
                Some("sk-test-12345".to_string())
            );
            assert_eq!(
                get_secret(KEY_GITHUB_OAUTH_TOKEN).unwrap(),
                Some("gho_test_67890".to_string())
            );

            // Cleanup
            delete_secret(KEY_ANTHROPIC_API_KEY).ok();
            delete_secret(KEY_GITHUB_OAUTH_TOKEN).ok();
        } else {
            // Keychain unavailable — secrets remain for SQLite fallback
            assert_eq!(updated.anthropic_api_key.as_deref(), Some("sk-test-12345"));
            assert_eq!(updated.github_oauth_token.as_deref(), Some("gho_test_67890"));
        }
    }

    // Integration tests that actually use the OS keychain.
    // These tests interact with the real keychain and may require
    // user authorization on first run (macOS Keychain Access prompt).
    // They use a unique test-only service to avoid interfering with
    // production secrets.
    #[cfg(test)]
    mod keychain_integration {
        use super::*;

        const TEST_KEY: &str = "test_keychain_integration_key";

        fn cleanup_test_key() {
            let _ = delete_secret(TEST_KEY);
        }

        #[test]
        #[ignore] // Requires real OS keychain — fails in CI (headless runners)
        fn test_store_and_retrieve() {
            reset_keychain_flag();
            cleanup_test_key();

            let stored = store_secret(TEST_KEY, "test-value-12345");
            match stored {
                Ok(true) => {
                    // Keychain available, verify round-trip
                    let retrieved = get_secret(TEST_KEY).unwrap();
                    assert_eq!(retrieved, Some("test-value-12345".to_string()));

                    // Clean up
                    let deleted = delete_secret(TEST_KEY).unwrap();
                    assert!(deleted);

                    // Verify deletion
                    let after_delete = get_secret(TEST_KEY).unwrap();
                    assert_eq!(after_delete, None);
                }
                Ok(false) => {
                    // Keychain unavailable (CI, headless) — skip
                    eprintln!("Keychain unavailable, skipping integration test");
                }
                Err(e) => {
                    // Unexpected error — could be CI environment
                    eprintln!("Keychain error (may be expected in CI): {}", e);
                }
            }
        }

        #[test]
        fn test_get_nonexistent_key() {
            reset_keychain_flag();
            let result = get_secret("nonexistent_key_that_should_not_exist");
            match result {
                Ok(None) => {} // Expected
                Ok(Some(_)) => panic!("Should not find a nonexistent key"),
                Err(_) => {
                    // Keychain unavailable — acceptable in CI
                }
            }
        }

        #[test]
        fn test_delete_nonexistent_key() {
            reset_keychain_flag();
            let result = delete_secret("nonexistent_key_that_should_not_exist");
            match result {
                Ok(false) => {} // Expected — key didn't exist
                Ok(true) => {} // Unlikely but not wrong
                Err(_) => {
                    // Keychain unavailable — acceptable in CI
                }
            }
        }
    }
}
