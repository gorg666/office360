//! Account-scoped persistent WKWebsiteDataStore identity.
//!
//! Office360 OAuth tokens and Yandex Passport cookies are separate security
//! domains. They are never converted into each other. A single interactive
//! Yandex login may establish both only because the OAuth authorize page runs
//! inside the same persistent WK store that Telemost later reuses.
//!
//! Identifier algorithm is frozen: UUID v5 of `office360:telemost:{account_id}`.
//! Do not change it — existing Telemost sessions depend on this mapping.

pub fn data_store_identifier(account_key: &str) -> Result<[u8; 16], String> {
    let key = account_key.trim();
    if key.is_empty() || key.len() > 256 {
        return Err("Account web session profile is invalid".to_string());
    }
    Ok(*uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_URL,
        format!("office360:telemost:{key}").as_bytes(),
    )
    .as_bytes())
}

pub fn data_store_uuid_string(identifier: [u8; 16]) -> String {
    uuid::Uuid::from_bytes(identifier).to_string()
}

#[cfg(test)]
mod tests {
    use super::data_store_identifier;

    #[test]
    fn identifier_is_stable_and_account_scoped() {
        assert_eq!(
            data_store_identifier("account-a").unwrap(),
            data_store_identifier("account-a").unwrap()
        );
        assert_ne!(
            data_store_identifier("account-a").unwrap(),
            data_store_identifier("account-b").unwrap()
        );
        assert!(data_store_identifier("").is_err());
        assert!(data_store_identifier("   ").is_err());
        assert!(data_store_identifier(&"x".repeat(257)).is_err());
    }

    #[test]
    fn identifier_matches_historical_telemost_algorithm() {
        let expected = *uuid::Uuid::new_v5(
            &uuid::Uuid::NAMESPACE_URL,
            b"office360:telemost:account-a",
        )
        .as_bytes();
        assert_eq!(data_store_identifier("account-a").unwrap(), expected);
        assert_eq!(
            super::data_store_uuid_string(expected),
            uuid::Uuid::from_bytes(expected).to_string()
        );
    }
}
