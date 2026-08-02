use keyring::Entry;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SERVICE: &str = "pide-ide";
const ACCOUNT: &str = "github-session";
const SCOPES: &str = "repo read:user user:email";

#[derive(Debug, Error)]
pub enum GhError {
    #[error("{0}")]
    Message(String),
}

impl Serialize for GhError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSession {
    pub token: String,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

/// Session returned to the UI — never includes the access token.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

impl From<&GitHubSession> for GitHubUser {
    fn from(s: &GitHubSession) -> Self {
        Self {
            login: s.login.clone(),
            name: s.name.clone(),
            avatar_url: s.avatar_url.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeApi {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: Option<u64>,
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TokenApi {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserApi {
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

fn entry() -> Result<Entry, GhError> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| GhError::Message(e.to_string()))
}

pub fn save_session(session: &GitHubSession) -> Result<(), GhError> {
    let json = serde_json::to_string(session).map_err(|e| GhError::Message(e.to_string()))?;
    entry()?
        .set_password(&json)
        .map_err(|e| GhError::Message(e.to_string()))
}

pub fn load_session() -> Result<Option<GitHubSession>, GhError> {
    match entry()?.get_password() {
        Ok(json) => {
            let session: GitHubSession =
                serde_json::from_str(&json).map_err(|e| GhError::Message(e.to_string()))?;
            Ok(Some(session))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(GhError::Message(e.to_string())),
    }
}

pub fn clear_session() -> Result<(), GhError> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(GhError::Message(e.to_string())),
    }
}

pub fn fetch_user(token: &str) -> Result<GitHubSession, GhError> {
    let resp = ureq::get("https://api.github.com/user")
        .set("Authorization", &format!("Bearer {token}"))
        .set("User-Agent", "PIDE-IDE")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| GhError::Message(format!("GitHub /user failed: {e}")))?;

    if resp.status() == 401 || resp.status() == 403 {
        return Err(GhError::Message(
            "GitHub token rejected. Sign in again.".into(),
        ));
    }
    if resp.status() >= 400 {
        return Err(GhError::Message(format!(
            "GitHub /user HTTP {}",
            resp.status()
        )));
    }

    let user: UserApi = resp
        .into_json()
        .map_err(|e| GhError::Message(e.to_string()))?;

    Ok(GitHubSession {
        token: token.to_string(),
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
    })
}

pub fn device_start(client_id: &str) -> Result<DeviceStart, GhError> {
    let id = client_id.trim();
    if id.is_empty() {
        return Err(GhError::Message(
            "Set a GitHub OAuth Client ID in Settings (or use a PAT).".into(),
        ));
    }

    let body = format!("client_id={}&scope={}", urlencoding_basic(id), urlencoding_basic(SCOPES));
    let resp = ureq::post("https://github.com/login/device/code")
        .set("Accept", "application/json")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("User-Agent", "PIDE-IDE")
        .send_string(&body)
        .map_err(|e| GhError::Message(format!("Device code request failed: {e}")))?;

    if resp.status() >= 400 {
        let text = resp.into_string().unwrap_or_default();
        return Err(GhError::Message(format!(
            "Device code error: {text}"
        )));
    }

    let data: DeviceCodeApi = resp
        .into_json()
        .map_err(|e| GhError::Message(e.to_string()))?;

    Ok(DeviceStart {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        interval: data.interval.unwrap_or(5).max(1),
        expires_in: data.expires_in.unwrap_or(900),
    })
}

pub fn device_poll(client_id: &str, device_code: &str) -> Result<Option<GitHubSession>, GhError> {
    let body = format!(
        "client_id={}&device_code={}&grant_type={}",
        urlencoding_basic(client_id.trim()),
        urlencoding_basic(device_code.trim()),
        urlencoding_basic("urn:ietf:params:oauth:grant-type:device_code")
    );

    let resp = ureq::post("https://github.com/login/oauth/access_token")
        .set("Accept", "application/json")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("User-Agent", "PIDE-IDE")
        .send_string(&body)
        .map_err(|e| GhError::Message(format!("Token poll failed: {e}")))?;

    let data: TokenApi = resp
        .into_json()
        .map_err(|e| GhError::Message(e.to_string()))?;

    if let Some(err) = data.error {
        return match err.as_str() {
            "authorization_pending" | "slow_down" => Ok(None),
            "expired_token" => Err(GhError::Message("Device code expired. Start again.".into())),
            "access_denied" => Err(GhError::Message("Authorization denied.".into())),
            other => Err(GhError::Message(
                data.error_description
                    .unwrap_or_else(|| other.to_string()),
            )),
        };
    }

    let token = data
        .access_token
        .ok_or_else(|| GhError::Message("No access_token in response".into()))?;
    let session = fetch_user(&token)?;
    save_session(&session)?;
    Ok(Some(session))
}

pub fn save_pat(token: &str) -> Result<GitHubSession, GhError> {
    let t = token.trim();
    if t.is_empty() {
        return Err(GhError::Message("Token is empty".into()));
    }
    let session = fetch_user(t)?;
    save_session(&session)?;
    Ok(session)
}

fn urlencoding_basic(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
