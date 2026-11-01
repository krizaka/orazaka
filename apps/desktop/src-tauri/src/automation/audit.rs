//! The append-only, hash-chained audit log of the device (ADR-079 §4).
//!
//! One JSON line per event in `audit.jsonl`. Each entry carries the SHA-256 of the previous entry, and its own hash is
//! computed over `seq · at · event · data · prev`: editing, deleting or reordering a line breaks the chain, and
//! `verify` says where. The log never holds a secret nor the content of a user's file — names, ids and decisions.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub seq: u64,
    pub at: String,
    pub event: String,
    pub data: Value,
    pub prev: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub ok: bool,
    pub entries: u64,
    /// The first sequence number whose hash or link does not match.
    pub broken_at: Option<u64>,
}

fn hash_of(seq: u64, at: &str, event: &str, data: &Value, prev: &str) -> String {
    let mut h = Sha256::new();
    // serde_json writes object keys in insertion order of a Map (BTreeMap by default: sorted) — stable.
    h.update(format!(
        "{seq}\u{1f}{at}\u{1f}{event}\u{1f}{data}\u{1f}{prev}"
    ));
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub struct AuditLog {
    path: PathBuf,
    last: Option<(u64, String)>,
}

impl AuditLog {
    pub fn open(path: &Path) -> Self {
        let last = read_all(path).last().map(|e| (e.seq, e.hash.clone()));
        Self {
            path: path.to_path_buf(),
            last,
        }
    }

    pub fn append(&mut self, at: &str, event: &str, data: Value) -> Result<AuditEntry, String> {
        let (seq, prev) = match &self.last {
            Some((s, h)) => (s + 1, h.clone()),
            None => (1, GENESIS.to_string()),
        };
        let hash = hash_of(seq, at, event, &data, &prev);
        let entry = AuditEntry {
            seq,
            at: at.into(),
            event: event.into(),
            data,
            prev,
            hash: hash.clone(),
        };
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| e.to_string())?;
        let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        writeln!(f, "{line}").map_err(|e| e.to_string())?;
        self.last = Some((seq, hash));
        Ok(entry)
    }

    /// The last `limit` entries, newest first.
    pub fn tail(&self, limit: usize) -> Vec<AuditEntry> {
        let mut all = read_all(&self.path);
        all.reverse();
        all.truncate(limit);
        all
    }

    pub fn verify(&self) -> Verification {
        verify_entries(&read_all_raw(&self.path))
    }
}

fn read_all_raw(path: &Path) -> Vec<Option<AuditEntry>> {
    let Ok(f) = fs::File::open(path) else {
        return vec![];
    };
    BufReader::new(f)
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<AuditEntry>(&l).ok())
        .collect()
}

fn read_all(path: &Path) -> Vec<AuditEntry> {
    read_all_raw(path).into_iter().flatten().collect()
}

fn verify_entries(entries: &[Option<AuditEntry>]) -> Verification {
    let mut prev = GENESIS.to_string();
    for (i, e) in entries.iter().enumerate() {
        let expected_seq = i as u64 + 1;
        let Some(e) = e else {
            return Verification {
                ok: false,
                entries: entries.len() as u64,
                broken_at: Some(expected_seq),
            };
        };
        if e.seq != expected_seq
            || e.prev != prev
            || e.hash != hash_of(e.seq, &e.at, &e.event, &e.data, &e.prev)
        {
            return Verification {
                ok: false,
                entries: entries.len() as u64,
                broken_at: Some(expected_seq),
            };
        }
        prev = e.hash.clone();
    }
    Verification {
        ok: true,
        entries: entries.len() as u64,
        broken_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn appends_a_chain_that_verifies_and_survives_a_reopen() {
        let d = tempdir().unwrap();
        let p = d.path().join("audit.jsonl");
        let mut log = AuditLog::open(&p);
        log.append(
            "2026-10-16T08:00:00",
            "automation.created",
            json!({"id": "a1"}),
        )
        .unwrap();
        log.append("2026-10-16T08:00:01", "run.started", json!({"run": "r1"}))
            .unwrap();
        let mut reopened = AuditLog::open(&p);
        let third = reopened
            .append("2026-10-16T08:00:02", "run.finished", json!({"run": "r1"}))
            .unwrap();
        assert_eq!(third.seq, 3);
        assert_eq!(
            reopened.verify(),
            Verification {
                ok: true,
                entries: 3,
                broken_at: None
            }
        );
        assert_eq!(reopened.tail(1)[0].event, "run.finished");
    }

    #[test]
    fn an_edited_line_breaks_the_chain_where_it_was_edited() {
        let d = tempdir().unwrap();
        let p = d.path().join("audit.jsonl");
        let mut log = AuditLog::open(&p);
        for i in 0..3 {
            log.append("2026-10-16T08:00:00", "tool.called", json!({"n": i}))
                .unwrap();
        }
        let tampered = fs::read_to_string(&p)
            .unwrap()
            .replacen("\"n\":1", "\"n\":9", 1);
        fs::write(&p, tampered).unwrap();
        let v = AuditLog::open(&p).verify();
        assert!(!v.ok);
        assert_eq!(v.broken_at, Some(2));
    }

    #[test]
    fn a_deleted_line_breaks_the_chain() {
        let d = tempdir().unwrap();
        let p = d.path().join("audit.jsonl");
        let mut log = AuditLog::open(&p);
        for i in 0..3 {
            log.append("2026-10-16T08:00:00", "tool.called", json!({"n": i}))
                .unwrap();
        }
        let lines: Vec<String> = fs::read_to_string(&p)
            .unwrap()
            .lines()
            .map(String::from)
            .collect();
        fs::write(&p, format!("{}\n{}\n", lines[0], lines[2])).unwrap();
        assert_eq!(AuditLog::open(&p).verify().broken_at, Some(2));
    }
}
