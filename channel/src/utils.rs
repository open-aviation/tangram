use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::distributions::Alphanumeric;
use rand::{thread_rng, Rng};
use serde::{Deserialize, Serialize};

pub fn random_string(length: usize) -> String {
    thread_rng().sample_iter(&Alphanumeric).take(length).map(char::from).collect()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub id: String,
    pub channel: String,
    pub exp: usize,
}

pub async fn generate_jwt(id: String, channel: String, jwt_secret: String, expiration_secs: i64) -> jsonwebtoken::errors::Result<String> {
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

pub async fn decode_jwt(token: &str, jwt_secret: String) -> Result<Claims, jsonwebtoken::errors::Error> {
    let decoding_key = DecodingKey::from_secret(jwt_secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;

    let token_data = decode::<Claims>(token, &decoding_key, &validation)?;
    Ok(token_data.claims)
}
