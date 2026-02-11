use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::distr::Alphanumeric;
use rand::{rng, RngExt};
use serde::{Deserialize, Serialize};

/// Generates a random alphanumeric string of a given length.
///
/// Used for generating unique connection IDs (`conn_id`) and message references (`ref`).
///
/// Similar to `System.unique_integer()` or `Base.encode64(:crypto.strong_rand_bytes(n))` often used
/// in Elixir for generating refs and IDs.
pub fn random_string(length: usize) -> String {
    rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

/// JWT Claims structure used for channel authorization.
///
/// Phoenix uses `Phoenix.Token` (based on Fernet/HMAC) for signing data.
/// This implementation enforces standard JWTs for `join` payloads.
///
/// - Phoenix tokens are often just signed binaries/terms; this requires JSON structure.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub id: String,
    pub channel: String,
    pub exp: usize,
}

/// Generates a signed JWT for testing or internal use.
///
/// # Arguments
/// * `expiration_secs` - TTL in seconds (matches `Phoenix.Token` `max_age`).
pub async fn generate_jwt(
    id: String,
    channel: String,
    jwt_secret: String,
    expiration_secs: i64,
) -> jsonwebtoken::errors::Result<String> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::seconds(expiration_secs))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        id: id.clone(),
        channel: channel.clone(),
        exp: expiration,
    };

    let header = Header::new(Algorithm::HS256);
    let key = EncodingKey::from_secret(jwt_secret.as_bytes());
    encode(&header, &claims, &key)
}

/// Decodes and validates a JWT from a join payload.
///
/// Equivalent to `Phoenix.Token.verify/4`.
pub async fn decode_jwt(
    token: &str,
    jwt_secret: String,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    let decoding_key = DecodingKey::from_secret(jwt_secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;

    let token_data = decode::<Claims>(token, &decoding_key, &validation)?;
    Ok(token_data.claims)
}
