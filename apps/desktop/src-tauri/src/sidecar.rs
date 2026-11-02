//! The sidecar allow-list.
//!
//! The app never runs a shell and never runs an arbitrary program: the web UI can only ask for one
//! of a handful of **named** operations of the bundled `orazaka` CLI, and this module is the only
//! place that turns such a request into an argument vector. Anything else — a different
//! sub-command, `--purge`, a free-form service name, a path — is refused before a process exists.

use serde::Deserialize;

/// The services `orazaka logs --service` knows about.
pub const LOG_SERVICES: &[&str] = &["router", "ollama", "media-worker", "image-worker", "ui"];
pub const START_MODES: &[&str] = &["dev", "full"];
pub const MAX_TAIL: u32 = 500;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliCall {
    pub command: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub tail: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub args: Vec<String>,
    /// Seconds before the process is killed.
    pub timeout_secs: u64,
}

pub fn plan(call: &CliCall) -> Result<Plan, String> {
    let s = |v: &str| v.to_string();
    match call.command.as_str() {
        "version" => Ok(Plan {
            args: vec![s("--version")],
            timeout_secs: 30,
        }),
        "status" => Ok(Plan {
            args: vec![s("status"), s("--json")],
            timeout_secs: 60,
        }),
        "doctor" => Ok(Plan {
            args: vec![s("doctor")],
            timeout_secs: 120,
        }),
        // Never `--purge`: deleting data is a terminal decision, not a button in a control panel.
        "stop" => Ok(Plan {
            args: vec![s("stop"), s("-y")],
            timeout_secs: 300,
        }),
        "start" => {
            let mode = call.mode.as_deref().unwrap_or("dev");
            if !START_MODES.contains(&mode) {
                return Err(format!("unknown start mode: {mode}"));
            }
            Ok(Plan {
                args: vec![s("start"), s("--mode"), s(mode)],
                timeout_secs: 20 * 60,
            })
        }
        "logs" => {
            let mut args = vec![s("logs")];
            if let Some(service) = call.service.as_deref() {
                if !LOG_SERVICES.contains(&service) {
                    return Err(format!("unknown log service: {service}"));
                }
                args.push(s("--service"));
                args.push(s(service));
            }
            let tail = call.tail.unwrap_or(100).clamp(1, MAX_TAIL);
            args.push(s("--tail"));
            args.push(tail.to_string());
            Ok(Plan {
                args,
                timeout_secs: 30,
            })
        }
        other => Err(format!("command not allowed: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(command: &str) -> CliCall {
        CliCall {
            command: command.into(),
            mode: None,
            service: None,
            tail: None,
        }
    }

    #[test]
    fn the_five_operations_map_to_fixed_arguments() {
        assert_eq!(plan(&call("version")).unwrap().args, ["--version"]);
        assert_eq!(plan(&call("status")).unwrap().args, ["status", "--json"]);
        assert_eq!(plan(&call("doctor")).unwrap().args, ["doctor"]);
        assert_eq!(plan(&call("stop")).unwrap().args, ["stop", "-y"]);
        assert_eq!(
            plan(&call("start")).unwrap().args,
            ["start", "--mode", "dev"]
        );
    }

    #[test]
    fn stop_can_never_purge() {
        let mut c = call("stop");
        c.mode = Some("--purge".into());
        let p = plan(&c).unwrap();
        assert!(!p.args.iter().any(|a| a.contains("purge")));
        assert!(plan(&call("stop --purge")).is_err());
    }

    #[test]
    fn unknown_commands_are_refused() {
        for bad in [
            "",
            "install",
            "reset",
            "config",
            "db",
            "chat",
            "rm",
            "sh",
            "status --json; ls",
            "../x",
        ] {
            assert!(plan(&call(bad)).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn start_modes_and_services_are_enumerated() {
        let mut c = call("start");
        c.mode = Some("full".into());
        assert_eq!(plan(&c).unwrap().args, ["start", "--mode", "full"]);
        c.mode = Some("dev; reboot".into());
        assert!(plan(&c).is_err());

        let mut l = call("logs");
        l.service = Some("ollama".into());
        l.tail = Some(9999);
        assert_eq!(
            plan(&l).unwrap().args,
            ["logs", "--service", "ollama", "--tail", "500"]
        );
        l.service = Some("../../etc/passwd".into());
        assert!(plan(&l).is_err());
    }

    #[test]
    fn tail_is_clamped() {
        let mut l = call("logs");
        l.tail = Some(0);
        assert_eq!(plan(&l).unwrap().args, ["logs", "--tail", "1"]);
    }

    #[test]
    fn a_free_form_json_payload_cannot_smuggle_arguments() {
        let c: CliCall =
            serde_json::from_str(r#"{"command":"status","args":["--purge"],"mode":"dev"}"#)
                .unwrap();
        assert_eq!(plan(&c).unwrap().args, ["status", "--json"]);
    }
}
