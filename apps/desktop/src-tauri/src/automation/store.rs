//! The device's automation store (ADR-079 §6: in local mode it is the source of truth for its own automations).
//!
//! One JSON file in the app's data directory: the automations, the recent runs with their traces, the approvals, the
//! grants, the kill switch and the **defaults rule set** — the budgets a new automation starts with, versioned, with
//! bounds kept in code (organisation rule of 2026-10-15: parameters are data; bounds are safety).

use super::types::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// @fixed: the store keeps a bounded history on the device; the workspace keeps the rest (slice 2).
pub const MAX_RUNS_KEPT: usize = 200;

/// Bounds no rule set can cross.
pub const BOUNDS: Policy = Policy {
    max_files_per_run: 100,
    max_tokens_per_run: 2_000_000,
    max_runs_per_day: 48,
    max_chars_per_document: 200_000,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub version: u32,
    pub policy: Policy,
    pub model: ModelTarget,
    pub time: String,
    /// New automations start in dry-run until the user turns it off.
    pub dry_run: bool,
}

impl Default for Defaults {
    /// Version 1 of the rule set, seeded on first launch.
    fn default() -> Self {
        Self {
            version: 1,
            policy: Policy {
                max_files_per_run: 10,
                max_tokens_per_run: 60_000,
                max_runs_per_day: 3,
                max_chars_per_document: 24_000,
            },
            model: ModelTarget {
                base_url: "http://localhost:11434/v1".into(),
                model: "qwen2.5:7b".into(),
            },
            time: "08:00".into(),
            dry_run: false,
        }
    }
}

/// Clamps a policy into the bounds (and to at least 1 everywhere).
pub fn bounded(p: &Policy) -> Policy {
    Policy {
        max_files_per_run: p.max_files_per_run.clamp(1, BOUNDS.max_files_per_run),
        max_tokens_per_run: p.max_tokens_per_run.clamp(1, BOUNDS.max_tokens_per_run),
        max_runs_per_day: p.max_runs_per_day.clamp(1, BOUNDS.max_runs_per_day),
        max_chars_per_document: p
            .max_chars_per_document
            .clamp(1, BOUNDS.max_chars_per_document),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    #[serde(default)]
    pub automations: Vec<Automation>,
    #[serde(default)]
    pub runs: Vec<Run>,
    #[serde(default)]
    pub approvals: Vec<Approval>,
    #[serde(default)]
    pub grants: Vec<Grant>,
    /// The kill switch: every agent of this Mac is stopped and every schedule paused while it is on.
    #[serde(default)]
    pub halted: bool,
    #[serde(default)]
    pub defaults: Defaults,
}

impl Store {
    pub fn load(file: &Path) -> Self {
        fs::read_to_string(file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    /// Writes atomically (a temp file renamed over the old one): a crash never leaves half a store.
    pub fn save(&self, file: &Path) -> Result<(), String> {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = file.with_extension("json.tmp");
        fs::write(
            &tmp,
            serde_json::to_string_pretty(self).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&tmp, file).map_err(|e| e.to_string())
    }

    pub fn automation(&self, id: &str) -> Option<&Automation> {
        self.automations.iter().find(|a| a.id == id)
    }

    pub fn automation_mut(&mut self, id: &str) -> Option<&mut Automation> {
        self.automations.iter_mut().find(|a| a.id == id)
    }

    /// Inserts or replaces a run (newest first), keeping a bounded history.
    pub fn upsert_run(&mut self, run: Run) {
        self.runs.retain(|r| r.id != run.id);
        self.runs.insert(0, run);
        self.runs.truncate(MAX_RUNS_KEPT);
    }

    pub fn run(&self, id: &str) -> Option<&Run> {
        self.runs.iter().find(|r| r.id == id)
    }

    /// Runs of an automation started on `day` (`YYYY-MM-DD`) — skipped runs do not count against the budget.
    pub fn runs_on(&self, automation_id: &str, day: &str) -> u32 {
        self.runs
            .iter()
            .filter(|r| r.automation_id == automation_id && r.started_at.starts_with(day))
            .filter(|r| !matches!(r.status, RunStatus::SkippedBudget | RunStatus::Halted))
            .count() as u32
    }

    pub fn pending_approvals(&self) -> Vec<&Approval> {
        self.approvals
            .iter()
            .filter(|a| a.state == ApprovalState::Pending)
            .collect()
    }

    pub fn active_grants(&self) -> Vec<&Grant> {
        self.grants
            .iter()
            .filter(|g| g.revoked_at.is_none())
            .collect()
    }

    /// Expires the pending approvals whose deadline passed; their runs end cancelled. Returns the expired ids.
    pub fn expire_approvals(&mut self, now: &str) -> Vec<String> {
        let mut expired = Vec::new();
        for a in self
            .approvals
            .iter_mut()
            .filter(|a| a.state == ApprovalState::Pending && a.expires_at.as_str() <= now)
        {
            a.state = ApprovalState::Expired;
            a.decided_at = Some(now.into());
            expired.push(a.run_id.clone());
        }
        for run in self.runs.iter_mut().filter(|r| expired.contains(&r.id)) {
            run.status = RunStatus::Cancelled;
            run.finished_at = Some(now.into());
            run.pending.clear();
            run.error = Some("the approval expired".into());
        }
        expired
    }

    /// Deleting an automation revokes its grants and denies its pending approvals: nothing outlives it.
    pub fn delete_automation(&mut self, id: &str, now: &str) -> bool {
        let before = self.automations.len();
        self.automations.retain(|a| a.id != id);
        for g in self
            .grants
            .iter_mut()
            .filter(|g| g.automation_id == id && g.revoked_at.is_none())
        {
            g.revoked_at = Some(now.into());
        }
        for a in self
            .approvals
            .iter_mut()
            .filter(|a| a.automation_id == id && a.state == ApprovalState::Pending)
        {
            a.state = ApprovalState::Denied;
            a.decided_at = Some(now.into());
        }
        self.automations.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn run(id: &str, automation: &str, started: &str, status: RunStatus) -> Run {
        Run {
            id: id.into(),
            job_id: format!("job-{id}"),
            feature_key: Recipe::SummariseNewPdfs.feature_key().into(),
            automation_id: automation.into(),
            automation_name: "x".into(),
            trigger: RunTrigger::Schedule,
            status,
            dry_run: false,
            started_at: started.into(),
            finished_at: None,
            steps: vec![],
            usage: Usage::default(),
            pending: vec![],
            written: vec![],
            error: None,
        }
    }

    #[test]
    fn round_trips_and_seeds_the_defaults_rule_set_v1() {
        let d = tempdir().unwrap();
        let f = d.path().join("automations.json");
        let s = Store::load(&f);
        assert_eq!(s.defaults.version, 1);
        assert_eq!(s.defaults.model.model, "qwen2.5:7b");
        let mut s = s;
        s.halted = true;
        s.save(&f).unwrap();
        assert!(Store::load(&f).halted);
    }

    #[test]
    fn counts_today_s_runs_but_not_the_skipped_ones() {
        let mut s = Store::default();
        s.upsert_run(run("1", "a", "2026-10-16T08:00:00", RunStatus::Succeeded));
        s.upsert_run(run(
            "2",
            "a",
            "2026-10-16T09:00:00",
            RunStatus::SkippedBudget,
        ));
        s.upsert_run(run("3", "a", "2026-10-15T08:00:00", RunStatus::Succeeded));
        s.upsert_run(run("4", "b", "2026-10-16T08:00:00", RunStatus::Succeeded));
        assert_eq!(s.runs_on("a", "2026-10-16"), 1);
        assert_eq!(s.runs[0].id, "4", "newest first");
    }

    #[test]
    fn policies_are_clamped_into_the_bounds() {
        let p = bounded(&Policy {
            max_files_per_run: 0,
            max_tokens_per_run: u64::MAX,
            max_runs_per_day: 1000,
            max_chars_per_document: 5,
        });
        assert_eq!(
            p,
            Policy {
                max_files_per_run: 1,
                max_tokens_per_run: BOUNDS.max_tokens_per_run,
                max_runs_per_day: 48,
                max_chars_per_document: 5
            }
        );
    }

    #[test]
    fn approvals_expire_and_their_runs_end_cancelled() {
        let mut s = Store::default();
        s.upsert_run(run(
            "r1",
            "a",
            "2026-10-16T08:00:00",
            RunStatus::AwaitingApproval,
        ));
        s.approvals.push(Approval {
            id: "ap1".into(),
            run_id: "r1".into(),
            automation_id: "a".into(),
            automation_name: "x".into(),
            server: "filesystem".into(),
            tool: "write_file".into(),
            scope: PathBuf::from("/x"),
            writes: vec![],
            created_at: "2026-10-16T08:00:00".into(),
            expires_at: "2026-10-17T08:00:00".into(),
            state: ApprovalState::Pending,
            decided_at: None,
        });
        assert!(s.expire_approvals("2026-10-17T07:59:59").is_empty());
        assert_eq!(
            s.expire_approvals("2026-10-17T08:00:00"),
            vec!["r1".to_string()]
        );
        assert_eq!(s.run("r1").unwrap().status, RunStatus::Cancelled);
    }

    #[test]
    fn deleting_an_automation_revokes_its_grants() {
        let mut s = Store::default();
        s.grants.push(Grant {
            id: "g".into(),
            automation_id: "a".into(),
            server: "filesystem".into(),
            tool: "write_file".into(),
            scope: PathBuf::from("/x"),
            created_at: String::new(),
            revoked_at: None,
        });
        s.delete_automation("a", "2026-10-16T10:00:00");
        assert!(s.active_grants().is_empty());
    }
}
