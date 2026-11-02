//! Tools are MCP servers (ADR-079 §3): the runner is an MCP client over stdio (JSON-RPC 2.0, one message per line).
//!
//! The servers a run may start, their pinned versions and the **effect of each tool** are data — `mcp-catalogue.json`,
//! bundled with the app — never a list in this file. A tool the catalogue does not know is `exec`, and `exec` is refused
//! in v1. The filesystem server is started with the automation's folder as its **only** allowed directory, and the
//! runner checks every path against the same folder before a call: two locks, not one.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

const CATALOGUE: &str = include_str!("../../mcp-catalogue.json");
pub const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Effect {
    Read,
    Write,
    External,
    Exec,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSpec {
    pub package: String,
    pub version: String,
    pub tools: HashMap<String, Effect>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Catalogue {
    pub servers: HashMap<String, ServerSpec>,
}

impl Catalogue {
    pub fn bundled() -> Self {
        serde_json::from_str(CATALOGUE).expect("mcp-catalogue.json is valid (tested)")
    }

    /// The effect of a tool; unknown server or tool = `Exec` (refused in v1).
    pub fn effect(&self, server: &str, tool: &str) -> Effect {
        self.servers
            .get(server)
            .and_then(|s| s.tools.get(tool))
            .copied()
            .unwrap_or(Effect::Exec)
    }
}

/// What a recipe needs from the filesystem — implemented over MCP for real, over a folder in tests.
pub trait FsTools {
    /// File names (not paths) directly inside `dir`.
    fn list_files(&mut self, dir: &Path) -> Result<Vec<String>, String>;
    fn read_bytes(&mut self, path: &Path) -> Result<Vec<u8>, String>;
    fn write_text(&mut self, path: &Path, content: &str) -> Result<(), String>;
}

/// An MCP server process and its JSON-RPC channel.
pub struct McpClient {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    next_id: u64,
    timeout: Duration,
}

impl McpClient {
    pub fn spawn(mut cmd: Command, timeout: Duration) -> Result<Self, String> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("cannot start the MCP server: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let mut client = Self {
            child,
            stdin,
            lines: rx,
            next_id: 1,
            timeout,
        };
        client.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                // No `roots` capability: the server keeps the directory it was started with.
                "capabilities": {},
                "clientInfo": { "name": "orazaka-desktop", "version": env!("CARGO_PKG_VERSION") }
            }),
        )?;
        client.notify("notifications/initialized")?;
        Ok(client)
    }

    fn send(&mut self, msg: &Value) -> Result<(), String> {
        writeln!(self.stdin, "{msg}").map_err(|e| format!("MCP server closed: {e}"))?;
        self.stdin.flush().map_err(|e| e.to_string())
    }

    fn notify(&mut self, method: &str) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method }))
    }

    pub fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let deadline = std::time::Instant::now() + self.timeout;
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            let line = self.lines.recv_timeout(left).map_err(|e| match e {
                std::sync::mpsc::RecvTimeoutError::Timeout => {
                    format!("MCP server did not answer {method} in time")
                }
                std::sync::mpsc::RecvTimeoutError::Disconnected => {
                    format!("MCP server exited before answering {method}")
                }
            })?;
            let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if msg.get("id").and_then(Value::as_u64) != Some(id) {
                continue; // a notification or a log line
            }
            if let Some(err) = msg.get("error") {
                return Err(format!(
                    "MCP error: {}",
                    err.get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                ));
            }
            return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    pub fn list_tools(&mut self) -> Result<Vec<String>, String> {
        let r = self.request("tools/list", json!({}))?;
        Ok(r["tools"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|t| t["name"].as_str().map(String::from))
            .collect())
    }

    /// Calls a tool; a tool-level error (`isError`) is an `Err` with the server's text.
    pub fn call_tool(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        let r = self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        )?;
        if r.get("isError").and_then(Value::as_bool) == Some(true) {
            return Err(first_text(&r).unwrap_or_else(|| format!("{name} failed")));
        }
        Ok(r)
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn first_text(result: &Value) -> Option<String> {
    result["content"]
        .as_array()?
        .iter()
        .find_map(|c| c["text"].as_str().map(String::from))
}

/// Where a Node.js >= 22 lives on this Mac (the same places the CLI sidecar looks): a GUI app has no shell PATH.
pub fn node_bin_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        format!("{home}/.volta/bin").into(),
    ];
    for base in [
        format!("{home}/.nvm/versions/node"),
        format!("{home}/.local/share/fnm/node-versions"),
    ] {
        if let Ok(rd) = std::fs::read_dir(&base) {
            let mut v: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
            v.sort();
            v.reverse();
            for p in v {
                dirs.push(p.join("bin"));
                dirs.push(p.join("installation/bin"));
            }
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter()
        .find(|d| d.join("node").is_file() && d.join("npx").is_file())
}

/// The filesystem server of the catalogue, limited to `root`, reached over MCP.
pub struct McpFilesystem {
    client: McpClient,
    root: PathBuf,
}

impl McpFilesystem {
    pub const SERVER: &'static str = "filesystem";

    pub fn start(catalogue: &Catalogue, root: &Path, timeout: Duration) -> Result<Self, String> {
        let spec = catalogue
            .servers
            .get(Self::SERVER)
            .ok_or("the filesystem server is not in the catalogue")?;
        let dir = node_bin_dir()
            .ok_or("Node.js 22+ was not found on this Mac (needed by the filesystem MCP server)")?;
        let mut cmd = Command::new(dir.join("npx"));
        let path = format!("{}:/usr/bin:/bin", dir.display());
        cmd.env("PATH", path)
            .args(["--yes", &format!("{}@{}", spec.package, spec.version)])
            .arg(root);
        let mut client = McpClient::spawn(cmd, timeout)?;
        // Least privilege: refuse to go on if the server offers a tool whose effect the catalogue does not declare.
        for tool in client.list_tools()? {
            if !spec.tools.contains_key(&tool) {
                return Err(format!(
                    "the filesystem server offers an undeclared tool: {tool}"
                ));
            }
        }
        Ok(Self {
            client,
            root: root.to_path_buf(),
        })
    }

    fn inside(&self, path: &Path) -> Result<(), String> {
        let climbs = path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir));
        if path.starts_with(&self.root) && !climbs {
            Ok(())
        } else {
            Err(format!(
                "outside the automation's folder: {}",
                path.display()
            ))
        }
    }
}

impl FsTools for McpFilesystem {
    fn list_files(&mut self, dir: &Path) -> Result<Vec<String>, String> {
        self.inside(dir)?;
        let r = self
            .client
            .call_tool("list_directory", json!({ "path": dir }))?;
        let text = first_text(&r).unwrap_or_default();
        Ok(text
            .lines()
            .filter_map(|l| l.strip_prefix("[FILE] ").map(String::from))
            .collect())
    }

    fn read_bytes(&mut self, path: &Path) -> Result<Vec<u8>, String> {
        use base64::Engine;
        self.inside(path)?;
        let r = self
            .client
            .call_tool("read_media_file", json!({ "path": path }))?;
        let item = r["content"]
            .as_array()
            .and_then(|a| a.first())
            .cloned()
            .unwrap_or(Value::Null);
        let b64 = item["resource"]["blob"]
            .as_str()
            .or_else(|| item["data"].as_str())
            .ok_or("read_media_file returned no data")?;
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| e.to_string())
    }

    fn write_text(&mut self, path: &Path, content: &str) -> Result<(), String> {
        self.inside(path)?;
        self.client
            .call_tool("write_file", json!({ "path": path, "content": content }))
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_declares_the_effect_of_every_filesystem_tool() {
        let c = Catalogue::bundled();
        assert_eq!(c.effect("filesystem", "list_directory"), Effect::Read);
        assert_eq!(c.effect("filesystem", "read_media_file"), Effect::Read);
        assert_eq!(c.effect("filesystem", "write_file"), Effect::Write);
        assert_eq!(c.effect("filesystem", "move_file"), Effect::Write);
    }

    #[test]
    fn an_unknown_tool_or_server_is_exec() {
        let c = Catalogue::bundled();
        assert_eq!(c.effect("filesystem", "run_command"), Effect::Exec);
        assert_eq!(c.effect("shell", "anything"), Effect::Exec);
    }

    #[test]
    fn servers_are_pinned_to_an_exact_version() {
        for (name, s) in Catalogue::bundled().servers {
            assert!(
                s.version.chars().all(|c| c.is_ascii_digit() || c == '.'),
                "{name} must pin an exact version"
            );
        }
    }
}
