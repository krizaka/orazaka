//! Signing in to the user's Orazaka account — the way a desktop app should: the **system browser** and
//! OAuth 2.1 authorization code with **PKCE** (S256), delivered back by the `orazaka://auth/callback` deep link.
//!
//! * The app never sees a password: the user signs in on the Orazaka page; the page hands back a one-time code that
//!   is useless without the verifier only this process holds.
//! * Tokens live in the **macOS Keychain** (never in a file, never in the web layer): the UI only gets the account
//!   (name, email, roles, server). The access token is short-lived, the refresh token rotates, and signing out
//!   revokes it on the server before the Keychain entry is deleted.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use url::Url;

pub const REDIRECT_URI: &str = "orazaka://auth/callback";
/// A sign-in the user abandons stops being valid after this long.
pub const PENDING_TTL: Duration = Duration::from_secs(10 * 60);
/// The access token is renewed this long before it expires.
const REFRESH_SKEW_SECS: u64 = 60;

// ───────────────────────────── PKCE ─────────────────────────────

fn b64url(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn random_b64url(n_bytes: usize) -> String {
    let mut buf = vec![0u8; n_bytes];
    getrandom::fill(&mut buf).expect("the OS random generator is available");
    b64url(&buf)
}

/// `BASE64URL(SHA256(verifier))` — RFC 7636 S256.
pub fn challenge_of(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

/// A fresh verifier: 64 random bytes → 86 base64url characters (RFC 7636 allows 43–128).
pub fn new_verifier() -> String {
    random_b64url(64)
}

pub fn new_state() -> String {
    random_b64url(24)
}

pub fn authorize_url(web_base: &str, challenge: &str, state: &str) -> String {
    format!(
        "{}/desktop/authorize?code_challenge={challenge}&code_challenge_method=S256&state={state}",
        web_base.trim_end_matches('/')
    )
}

// ───────────────────────────── where the identity service is ─────────────────────────────

/// The identity API of a server: a hosted Orazaka publishes its edge under `/edge`; a local stack's edge is on 8088.
pub fn api_base(mode: &str, remote_url: &str) -> String {
    if mode == "local" {
        "http://localhost:8088".into()
    } else {
        format!("{}/edge", remote_url.trim_end_matches('/'))
    }
}

// ───────────────────────────── the callback ─────────────────────────────

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The code of `orazaka://auth/callback?code=…&state=…`, only if it is exactly that URL and carries the state of the
/// sign-in this app started.
pub fn parse_callback(url: &Url, expected_state: &str) -> Result<String, String> {
    if url.scheme() != "orazaka" || url.host_str() != Some("auth") || url.path() != "/callback" {
        return Err("not the sign-in callback".into());
    }
    let (mut code, mut state) = (None, None);
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" if code.is_none() => code = Some(v.to_string()),
            "state" if state.is_none() => state = Some(v.to_string()),
            _ => {}
        }
    }
    let state = state.ok_or("missing state")?;
    if !constant_time_eq(&state, expected_state) {
        return Err("the state does not match this sign-in".into());
    }
    code.filter(|c| !c.is_empty()).ok_or_else(|| "missing code".to_string())
}

// ───────────────────────────── session and storage ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: u64,
    pub username: String,
    pub email: String,
    pub authorities: Vec<String>,
    /// The identity API these tokens belong to — they are never sent anywhere else.
    pub api_base: String,
}

/// What the web layer may know: the account, never a token.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub signed_in: bool,
    pub username: Option<String>,
    pub email: Option<String>,
    pub authorities: Vec<String>,
    pub server: Option<String>,
}

impl Account {
    pub fn signed_out() -> Self {
        Account { signed_in: false, username: None, email: None, authorities: vec![], server: None }
    }
    pub fn of(session: &Session) -> Self {
        Account {
            signed_in: true,
            username: Some(session.username.clone()),
            email: Some(session.email.clone()),
            authorities: session.authorities.clone(),
            server: Some(session.api_base.trim_end_matches("/edge").to_string()),
        }
    }
}

pub trait SessionStore: Send + Sync {
    fn load(&self) -> Option<Session>;
    fn save(&self, session: &Session) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

const KEYCHAIN_SERVICE: &str = "com.krizaka.orazaka.desktop";
const KEYCHAIN_ACCOUNT: &str = "session";

/// The macOS Keychain (generic password item), so the tokens never touch the disk in clear.
pub struct KeychainStore;

impl KeychainStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
    }
}

impl SessionStore for KeychainStore {
    fn load(&self) -> Option<Session> {
        let raw = Self::entry().ok()?.get_password().ok()?;
        serde_json::from_str(&raw).ok()
    }
    fn save(&self, session: &Session) -> Result<(), String> {
        let raw = serde_json::to_string(session).map_err(|e| e.to_string())?;
        Self::entry()?.set_password(&raw).map_err(|e| e.to_string())
    }
    fn clear(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// In-memory store (tests).
#[derive(Default)]
pub struct MemoryStore(pub Mutex<Option<Session>>);

impl SessionStore for MemoryStore {
    fn load(&self) -> Option<Session> {
        self.0.lock().unwrap().clone()
    }
    fn save(&self, session: &Session) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(session.clone());
        Ok(())
    }
    fn clear(&self) -> Result<(), String> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

// ───────────────────────────── the identity API ─────────────────────────────

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub username: String,
    pub email: String,
    #[serde(default)]
    pub authorities: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ApiError {
    /// The server refused the grant (expired, replayed, revoked): the user must sign in again.
    Rejected,
    Unreachable(String),
}

pub trait AuthApi: Send + Sync {
    fn exchange(&self, api_base: &str, code: &str, verifier: &str) -> Result<TokenResponse, ApiError>;
    fn refresh(&self, api_base: &str, refresh_token: &str) -> Result<TokenResponse, ApiError>;
    fn revoke(&self, api_base: &str, refresh_token: &str) -> Result<(), ApiError>;
}

/// The real thing: HTTPS (or loopback http) to the identity service, with a timeout.
pub struct HttpAuthApi;

impl HttpAuthApi {
    fn agent() -> ureq::Agent {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .build()
            .into()
    }
    fn post(url: &str, body: serde_json::Value) -> Result<ureq::http::Response<ureq::Body>, ApiError> {
        match Self::agent().post(url).header("Content-Type", "application/json").send_json(body) {
            Ok(r) => Ok(r),
            Err(ureq::Error::StatusCode(400..=499)) => Err(ApiError::Rejected),
            Err(e) => Err(ApiError::Unreachable(e.to_string())),
        }
    }
    fn token(url: String, body: serde_json::Value) -> Result<TokenResponse, ApiError> {
        let mut res = Self::post(&url, body)?;
        res.body_mut().read_json::<TokenResponse>().map_err(|e| ApiError::Unreachable(e.to_string()))
    }
}

impl AuthApi for HttpAuthApi {
    fn exchange(&self, api_base: &str, code: &str, verifier: &str) -> Result<TokenResponse, ApiError> {
        Self::token(
            format!("{api_base}/api/v1/auth/desktop/token"),
            serde_json::json!({"grantType": "authorization_code", "code": code, "codeVerifier": verifier, "redirectUri": REDIRECT_URI}),
        )
    }
    fn refresh(&self, api_base: &str, refresh_token: &str) -> Result<TokenResponse, ApiError> {
        Self::token(
            format!("{api_base}/api/v1/auth/desktop/token"),
            serde_json::json!({"grantType": "refresh_token", "refreshToken": refresh_token}),
        )
    }
    fn revoke(&self, api_base: &str, refresh_token: &str) -> Result<(), ApiError> {
        Self::post(&format!("{api_base}/api/v1/auth/desktop/revoke"), serde_json::json!({"refreshToken": refresh_token}))
            .map(|_| ())
    }
}

// ───────────────────────────── the flow ─────────────────────────────

/// A sign-in started in the browser and not completed yet.
pub struct Pending {
    pub verifier: String,
    pub state: String,
    pub api_base: String,
    pub started: Instant,
}

fn session_of(api_base: &str, t: TokenResponse, now: u64) -> Session {
    Session {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: now + t.expires_in,
        username: t.username,
        email: t.email,
        authorities: t.authorities,
        api_base: api_base.to_string(),
    }
}

/// Completes the sign-in the callback URL belongs to: checks the URL and the state, exchanges the code with the
/// verifier, stores the session in the Keychain.
pub fn complete_sign_in(
    api: &dyn AuthApi,
    store: &dyn SessionStore,
    pending: Pending,
    url: &Url,
    now: u64,
) -> Result<Session, String> {
    if pending.started.elapsed() > PENDING_TTL {
        return Err("the sign-in took too long — start again".into());
    }
    let code = parse_callback(url, &pending.state)?;
    let tokens = api
        .exchange(&pending.api_base, &code, &pending.verifier)
        .map_err(|e| match e {
            ApiError::Rejected => "the server refused the sign-in — start again".to_string(),
            ApiError::Unreachable(m) => format!("cannot reach the server: {m}"),
        })?;
    let session = session_of(&pending.api_base, tokens, now);
    store.save(&session)?;
    Ok(session)
}

/// A valid access token, renewed through the rotating refresh token when it is about to expire. A refused refresh
/// (expired, revoked, replayed) signs the user out: the Keychain entry is deleted.
pub fn fresh_access_token(api: &dyn AuthApi, store: &dyn SessionStore, now: u64) -> Result<String, String> {
    let session = store.load().ok_or("not signed in")?;
    if now + REFRESH_SKEW_SECS < session.expires_at {
        return Ok(session.access_token);
    }
    match api.refresh(&session.api_base, &session.refresh_token) {
        Ok(tokens) => {
            let renewed = session_of(&session.api_base, tokens, now);
            store.save(&renewed)?;
            Ok(renewed.access_token)
        }
        Err(ApiError::Rejected) => {
            store.clear()?;
            Err("the session ended — sign in again".into())
        }
        Err(ApiError::Unreachable(m)) => Err(format!("cannot reach the server: {m}")),
    }
}

/// Signs out: the refresh token is revoked on the server (best effort), then the Keychain entry is deleted — always.
pub fn sign_out(api: &dyn AuthApi, store: &dyn SessionStore) -> Result<(), String> {
    if let Some(session) = store.load() {
        let _ = api.revoke(&session.api_base, &session.refresh_token);
    }
    store.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// RFC 7636 appendix B.
    const RFC_VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const RFC_CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    #[test]
    fn challenge_is_the_rfc7636_s256_of_the_verifier() {
        assert_eq!(challenge_of(RFC_VERIFIER), RFC_CHALLENGE);
    }

    #[test]
    fn verifiers_and_states_are_long_random_and_url_safe() {
        let (a, b) = (new_verifier(), new_verifier());
        assert_ne!(a, b);
        assert!((43..=128).contains(&a.len()));
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(challenge_of(&a).len(), 43);
        assert!(new_state().len() >= 16);
    }

    #[test]
    fn authorize_url_asks_for_s256_on_the_servers_web_page() {
        let u = Url::parse(&authorize_url("https://dev.orazaka.com/", "CH", "ST")).unwrap();
        assert_eq!(u.origin().ascii_serialization(), "https://dev.orazaka.com");
        assert_eq!(u.path(), "/desktop/authorize");
        let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge"], "CH");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "ST");
    }

    #[test]
    fn api_base_is_the_public_edge_or_the_local_one() {
        assert_eq!(api_base("remote", "https://dev.orazaka.com"), "https://dev.orazaka.com/edge");
        assert_eq!(api_base("local", "https://dev.orazaka.com"), "http://localhost:8088");
    }

    fn cb(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_callback_must_be_exactly_the_registered_link_with_the_right_state() {
        assert_eq!(parse_callback(&cb("orazaka://auth/callback?code=abc&state=S1"), "S1").unwrap(), "abc");
        for bad in [
            "orazaka://auth/callback?code=abc&state=OTHER",
            "orazaka://auth/callback?code=abc",
            "orazaka://auth/callback?state=S1",
            "orazaka://auth/callback?code=&state=S1",
            "orazaka://evil/callback?code=abc&state=S1",
            "orazaka://auth/other?code=abc&state=S1",
            "https://auth/callback?code=abc&state=S1",
        ] {
            assert!(parse_callback(&cb(bad), "S1").is_err(), "{bad}");
        }
    }

    #[test]
    fn a_repeated_code_parameter_cannot_override_the_first() {
        assert_eq!(parse_callback(&cb("orazaka://auth/callback?code=first&code=second&state=S1"), "S1").unwrap(), "first");
    }

    #[derive(Default)]
    struct FakeApi {
        exchanged: Mutex<Vec<(String, String, String)>>,
        reject_refresh: bool,
        refreshes: AtomicUsize,
        revoked: Mutex<Vec<String>>,
    }

    fn tokens(access: &str, refresh: &str) -> TokenResponse {
        TokenResponse {
            access_token: access.into(),
            refresh_token: refresh.into(),
            expires_in: 1800,
            username: "eric".into(),
            email: "eric@orazaka.com".into(),
            authorities: vec!["ROLE_USER".into()],
        }
    }

    impl AuthApi for FakeApi {
        fn exchange(&self, base: &str, code: &str, verifier: &str) -> Result<TokenResponse, ApiError> {
            self.exchanged.lock().unwrap().push((base.into(), code.into(), verifier.into()));
            Ok(tokens("access-1", "refresh-1"))
        }
        fn refresh(&self, _: &str, _: &str) -> Result<TokenResponse, ApiError> {
            self.refreshes.fetch_add(1, Ordering::SeqCst);
            if self.reject_refresh { Err(ApiError::Rejected) } else { Ok(tokens("access-2", "refresh-2")) }
        }
        fn revoke(&self, _: &str, refresh: &str) -> Result<(), ApiError> {
            self.revoked.lock().unwrap().push(refresh.into());
            Ok(())
        }
    }

    fn pending() -> Pending {
        Pending { verifier: "V".repeat(64), state: "S1".into(), api_base: "https://dev.orazaka.com/edge".into(), started: Instant::now() }
    }

    #[test]
    fn completing_the_sign_in_exchanges_the_code_with_the_verifier_and_stores_the_session() {
        let (api, store) = (FakeApi::default(), MemoryStore::default());
        let s = complete_sign_in(&api, &store, pending(), &cb("orazaka://auth/callback?code=the-code&state=S1"), 1000).unwrap();
        assert_eq!(api.exchanged.lock().unwrap()[0], ("https://dev.orazaka.com/edge".into(), "the-code".into(), "V".repeat(64)));
        assert_eq!(s.expires_at, 2800);
        assert_eq!(store.load().unwrap(), s);
        let acct = Account::of(&s);
        assert_eq!(acct.server.as_deref(), Some("https://dev.orazaka.com"));
        assert_eq!(acct.email.as_deref(), Some("eric@orazaka.com"));
    }

    #[test]
    fn a_callback_with_another_state_never_reaches_the_server_nor_the_keychain() {
        let (api, store) = (FakeApi::default(), MemoryStore::default());
        assert!(complete_sign_in(&api, &store, pending(), &cb("orazaka://auth/callback?code=c&state=EVIL"), 1000).is_err());
        assert!(api.exchanged.lock().unwrap().is_empty());
        assert!(store.load().is_none());
    }

    #[test]
    fn an_abandoned_sign_in_expires() {
        let (api, store) = (FakeApi::default(), MemoryStore::default());
        let mut p = pending();
        p.started = Instant::now().checked_sub(PENDING_TTL + Duration::from_secs(1)).unwrap();
        assert!(complete_sign_in(&api, &store, p, &cb("orazaka://auth/callback?code=c&state=S1"), 1000).is_err());
        assert!(api.exchanged.lock().unwrap().is_empty());
    }

    fn signed_in(store: &MemoryStore, expires_at: u64) {
        store
            .save(&Session {
                access_token: "access-1".into(),
                refresh_token: "refresh-1".into(),
                expires_at,
                username: "eric".into(),
                email: "eric@orazaka.com".into(),
                authorities: vec![],
                api_base: "https://dev.orazaka.com/edge".into(),
            })
            .unwrap();
    }

    #[test]
    fn a_valid_access_token_is_reused_without_a_network_call() {
        let (api, store) = (FakeApi::default(), MemoryStore::default());
        signed_in(&store, 5000);
        assert_eq!(fresh_access_token(&api, &store, 1000).unwrap(), "access-1");
        assert_eq!(api.refreshes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn an_access_token_about_to_expire_is_renewed_and_the_rotated_refresh_token_stored() {
        let (api, store) = (FakeApi::default(), MemoryStore::default());
        signed_in(&store, 1030);
        assert_eq!(fresh_access_token(&api, &store, 1000).unwrap(), "access-2");
        assert_eq!(store.load().unwrap().refresh_token, "refresh-2");
    }

    #[test]
    fn a_refused_refresh_signs_the_user_out_of_the_keychain() {
        let (api, store) = (FakeApi { reject_refresh: true, ..Default::default() }, MemoryStore::default());
        signed_in(&store, 900);
        assert!(fresh_access_token(&api, &store, 1000).is_err());
        assert!(store.load().is_none());
    }

    #[test]
    fn nothing_without_a_session() {
        assert!(fresh_access_token(&FakeApi::default(), &MemoryStore::default(), 1).is_err());
    }

    #[test]
    fn signing_out_revokes_on_the_server_then_empties_the_keychain() {
        let (api, store) = (FakeApi::default(), MemoryStore::default());
        signed_in(&store, 5000);
        sign_out(&api, &store).unwrap();
        assert_eq!(api.revoked.lock().unwrap().as_slice(), ["refresh-1"]);
        assert!(store.load().is_none());
        // signing out twice is harmless
        sign_out(&api, &store).unwrap();
    }

    #[test]
    fn the_web_layer_never_gets_a_token() {
        let store = MemoryStore::default();
        signed_in(&store, 5000);
        let json = serde_json::to_string(&Account::of(&store.load().unwrap())).unwrap();
        assert!(!json.contains("access-1") && !json.contains("refresh-1") && !json.to_lowercase().contains("token"));
    }
}
