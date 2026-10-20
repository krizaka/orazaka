//! The automation model (ADR-079 §1): an automation is *trigger + recipe + policy*; a run is a job with a trace.
//!
//! Everything here is plain data, serialised in camelCase for the UI and the local store. Named values are enums
//! (organisation rule of 2026-10-15), never strings compared by hand.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// What an automation runs. Slice 1 has one built-in recipe; Studios, pack Studios and prompts come with sync.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Recipe {
    /// Summarise the PDFs of a folder that have no summary note yet, and save `<name>.summary.md` next to each.
    SummariseNewPdfs,
}

impl Recipe {
    /// The job feature key of a run of this recipe on the device (ADR-079 §1: `automation.local.*`).
    pub fn feature_key(self) -> &'static str {
        match self {
            Recipe::SummariseNewPdfs => "automation.local.summarise-new-pdfs",
        }
    }
}

/// What to do with a scheduled slot that passed while the Mac slept or the app was closed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CatchUp {
    /// Run once for the latest missed slot (the default: "every morning" still happens if the Mac woke at 9).
    #[default]
    Once,
    /// Run only if the slot is less than the grace window old.
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    /// Local time of day, `HH:MM` (24 h).
    pub time: String,
    /// ISO weekdays it runs on (1 = Monday … 7 = Sunday); empty = every day.
    #[serde(default)]
    pub days: Vec<u8>,
    #[serde(default)]
    pub catch_up: CatchUp,
}

/// Which model answers: an OpenAI-compatible endpoint (Ollama, LocalAI, mlx_lm.server…) and a model id — data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelTarget {
    pub base_url: String,
    pub model: String,
}

/// Budgets and limits of one automation (ADR-079 §4). Defaults come from the device's rule set (`Defaults`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub max_files_per_run: u32,
    pub max_tokens_per_run: u64,
    pub max_runs_per_day: u32,
    pub max_chars_per_document: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub recipe: Recipe,
    pub schedule: Schedule,
    /// The granted folder it reads from and writes next to (canonical).
    pub folder: PathBuf,
    pub model: ModelTarget,
    pub policy: Policy,
    pub dry_run: bool,
    pub enabled: bool,
    pub created_at: String,
    /// The last scheduled slot handled (local naive time, `YYYY-MM-DDTHH:MM:SS`), so a slot runs once.
    #[serde(default)]
    pub last_slot: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    Running,
    AwaitingApproval,
    Succeeded,
    Failed,
    Cancelled,
    Halted,
    SkippedBudget,
}

impl RunStatus {
    pub fn is_final(self) -> bool {
        !matches!(self, RunStatus::Running | RunStatus::AwaitingApproval)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StepKind {
    /// A call to an MCP tool.
    Tool,
    /// A call to the model.
    Model,
    /// The approval gate.
    Approval,
    /// A decision of the runner (budget, nothing to do, halted…).
    Note,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StepStatus {
    Ok,
    Error,
    Skipped,
    /// A side effect recorded but not performed (dry-run).
    DryRun,
    Waiting,
}

/// One line of a run's trace: never the untrusted content itself, never a secret.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub seq: u32,
    pub kind: StepKind,
    pub name: String,
    pub detail: String,
    pub status: StepStatus,
    pub at: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub model: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub duration_ms: u64,
    /// Local inference on the user's own hardware is 0 credits in the pricebook today.
    pub credits: u64,
}

/// A write the run prepared and that waits for the approval gate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftWrite {
    pub path: PathBuf,
    pub source: PathBuf,
    pub content: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RunTrigger {
    Schedule,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    /// The job id this run is reported under (ADR-079 §1: every run is a job).
    pub job_id: String,
    pub feature_key: String,
    pub automation_id: String,
    pub automation_name: String,
    pub trigger: RunTrigger,
    pub status: RunStatus,
    pub dry_run: bool,
    pub started_at: String,
    #[serde(default)]
    pub finished_at: Option<String>,
    pub steps: Vec<Step>,
    pub usage: Usage,
    #[serde(default)]
    pub pending: Vec<DraftWrite>,
    #[serde(default)]
    pub written: Vec<PathBuf>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalState {
    Pending,
    Approved,
    Denied,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritePreview {
    pub path: PathBuf,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: String,
    pub run_id: String,
    pub automation_id: String,
    pub automation_name: String,
    pub server: String,
    pub tool: String,
    pub scope: PathBuf,
    pub writes: Vec<WritePreview>,
    pub created_at: String,
    pub expires_at: String,
    pub state: ApprovalState,
    #[serde(default)]
    pub decided_at: Option<String>,
}

/// "Approve always for this tool and folder" — narrow, listed, revocable (ADR-079 §4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub automation_id: String,
    pub server: String,
    pub tool: String,
    pub scope: PathBuf,
    pub created_at: String,
    #[serde(default)]
    pub revoked_at: Option<String>,
}

impl Grant {
    pub fn covers(&self, automation_id: &str, server: &str, tool: &str, path: &std::path::Path) -> bool {
        self.revoked_at.is_none()
            && self.automation_id == automation_id
            && self.server == server
            && self.tool == tool
            && path.starts_with(&self.scope)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Decision {
    Once,
    Always,
    Deny,
}
