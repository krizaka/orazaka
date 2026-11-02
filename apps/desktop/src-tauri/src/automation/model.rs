//! The model port (ADR-079 §2): one OpenAI-compatible `chat/completions` client. Ollama, LocalAI, `mlx_lm.server` and
//! vLLM all serve this API, so "a local model" is a base URL and a model id — data on the automation.

use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Completion {
    pub text: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
}

pub trait ModelClient {
    fn complete(&self, system: &str, user: &str) -> Result<Completion, String>;
    fn name(&self) -> String;
}

pub struct OpenAiCompatible {
    pub base_url: String,
    pub model: String,
    pub timeout: Duration,
}

impl OpenAiCompatible {
    /// Only loopback over plain HTTP: a remote model must be HTTPS (the content of the user's files goes there).
    pub fn validate_base_url(url: &str) -> Result<(), String> {
        let u = url::Url::parse(url).map_err(|_| format!("invalid model URL: {url}"))?;
        let loopback = matches!(
            u.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("[::1]")
        );
        match u.scheme() {
            "https" => Ok(()),
            "http" if loopback => Ok(()),
            _ => Err("a model outside this Mac must be reached over https".into()),
        }
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/{}", self.base_url.trim_end_matches('/'), path)
    }

    /// The model ids the endpoint serves (`GET /models`).
    pub fn list_models(base_url: &str, timeout: Duration) -> Result<Vec<String>, String> {
        Self::validate_base_url(base_url)?;
        let url = format!("{}/models", base_url.trim_end_matches('/'));
        let v: Value = ureq::get(&url)
            .timeout(timeout)
            .call()
            .map_err(|e| e.to_string())?
            .into_json()
            .map_err(|e| e.to_string())?;
        Ok(v["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|m| m["id"].as_str().map(String::from))
            .collect())
    }
}

impl ModelClient for OpenAiCompatible {
    fn complete(&self, system: &str, user: &str) -> Result<Completion, String> {
        Self::validate_base_url(&self.base_url)?;
        let body = json!({
            "model": self.model,
            "temperature": 0.2,
            "stream": false,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ]
        });
        let v: Value = ureq::post(&self.endpoint("chat/completions"))
            .timeout(self.timeout)
            .send_json(body)
            .map_err(|e| format!("the model did not answer: {e}"))?
            .into_json()
            .map_err(|e| e.to_string())?;
        let text = v["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("the model returned no text")?
            .to_string();
        Ok(Completion {
            text,
            prompt_tokens: v["usage"]["prompt_tokens"].as_u64().unwrap_or(0),
            completion_tokens: v["usage"]["completion_tokens"].as_u64().unwrap_or(0),
        })
    }

    fn name(&self) -> String {
        self.model.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_may_be_http_anything_else_must_be_https() {
        assert!(OpenAiCompatible::validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(OpenAiCompatible::validate_base_url("http://127.0.0.1:8080/v1").is_ok());
        assert!(OpenAiCompatible::validate_base_url("https://dev.orazaka.com/v1").is_ok());
        assert!(OpenAiCompatible::validate_base_url("http://192.168.1.20:11434/v1").is_err());
        assert!(OpenAiCompatible::validate_base_url("file:///etc/passwd").is_err());
    }
}
