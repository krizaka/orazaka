//! Code on the Mac — slice 1 of ADR-093: the read and write core.
//!
//! * `scope`      — a granted repository; every path is resolved here (canonical, inside, no symlink out).
//! * `visibility` — the one function every read goes through, and the redactor.
//! * `tools`      — the read tools the agent will get: `read_file`, `list_dir`, `search_text`, `outline`.
//! * `diff`       — pending diffs, approved or rejected per hunk, applied exactly against the base hash.
//! * `snapshot`   — `refs/orazaka/snapshots/<run-id>` and the undo.
//! * `checks`     — slice 2: user-confirmed argv commands (the only `exec`), run in a Seatbelt sandbox.
//! * `editor`     — « Open in VS Code / Xcode » at a line.
//!
//! No GitHub and no model loop here: this slice builds the tools and the review a human uses.

pub mod checks;
pub mod diff;
pub mod editor;
pub mod scope;
pub mod snapshot;
pub mod tools;
pub mod visibility;

pub use scope::{CodeError, Repo, RepoInfo};

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_checks;
