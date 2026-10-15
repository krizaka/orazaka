//! The folder scope — the heart of the app's least-privilege file access.
//!
//! The app can read a path **only** when it lies inside a folder the user granted with the native
//! picker. Grants are persisted (a JSON file in the app's data directory), listed in the UI and
//! revocable. Every path is canonicalised before it is compared, so `..` segments and symlinks that
//! leave a granted folder are refused; broad or sensitive locations can never be granted.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum ScopeError {
    /// The folder is too broad or too sensitive to be granted (home, `/`, `~/.ssh`, `/System`…).
    Forbidden(String),
    /// The path does not exist or is not a directory / file as expected.
    NotFound(String),
    /// The path is outside every granted folder.
    OutsideScope(String),
    Io(String),
}

impl std::fmt::Display for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScopeError::Forbidden(p) => write!(f, "forbidden: {p}"),
            ScopeError::NotFound(p) => write!(f, "not found: {p}"),
            ScopeError::OutsideScope(p) => write!(f, "outside the granted folders: {p}"),
            ScopeError::Io(e) => write!(f, "io: {e}"),
        }
    }
}

impl std::error::Error for ScopeError {}

/// Directories (relative to the user's home) that can never be granted, nor read through a grant.
const SENSITIVE_HOME_DIRS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    ".config",
    ".npmrc",
    "Library",
    ".claude",
    ".cargo",
    ".krizaka-worktrees",
];

/// System locations that can never be granted (they are broad, or hold other programs' data).
const FORBIDDEN_ABSOLUTE: &[&str] = &[
    "/", "/System", "/Library", "/Users", "/Volumes", "/private", "/etc", "/usr", "/bin", "/sbin",
    "/var", "/opt", "/Applications", "/dev", "/cores", "/tmp",
];

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScopeStore {
    roots: Vec<PathBuf>,
}

impl ScopeStore {
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    pub fn load(file: &Path) -> Self {
        Self::load_with_home(file, home_dir().as_deref())
    }

    pub fn load_with_home(file: &Path, home: Option<&Path>) -> Self {
        let Ok(raw) = fs::read_to_string(file) else {
            return Self::default();
        };
        let mut store: ScopeStore = serde_json::from_str(&raw).unwrap_or_default();
        // A folder that has vanished, or that became forbidden, silently drops out of the scope.
        store
            .roots
            .retain(|r| r.is_dir() && check_grantable(r, home).is_ok());
        store
    }

    pub fn save(&self, file: &Path) -> Result<(), ScopeError> {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|e| ScopeError::Io(e.to_string()))?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| ScopeError::Io(e.to_string()))?;
        fs::write(file, json).map_err(|e| ScopeError::Io(e.to_string()))
    }

    /// Grants a folder (idempotent). Returns the canonical path stored.
    pub fn grant(&mut self, folder: &Path) -> Result<PathBuf, ScopeError> {
        self.grant_with_home(folder, home_dir().as_deref())
    }

    pub fn grant_with_home(
        &mut self,
        folder: &Path,
        home: Option<&Path>,
    ) -> Result<PathBuf, ScopeError> {
        let canon = folder
            .canonicalize()
            .map_err(|_| ScopeError::NotFound(folder.display().to_string()))?;
        if !canon.is_dir() {
            return Err(ScopeError::NotFound(canon.display().to_string()));
        }
        check_grantable(&canon, home)?;
        // A child of an already granted folder adds nothing; a parent replaces its children.
        if self.roots.iter().any(|r| canon.starts_with(r)) {
            return Ok(canon);
        }
        self.roots.retain(|r| !r.starts_with(&canon));
        self.roots.push(canon.clone());
        self.roots.sort();
        Ok(canon)
    }

    pub fn revoke(&mut self, folder: &Path) -> bool {
        let before = self.roots.len();
        self.roots.retain(|r| r != folder);
        self.roots.len() != before
    }

    pub fn revoke_all(&mut self) {
        self.roots.clear();
    }

    /// Resolves `path` to its canonical form **iff** it lies inside a granted folder and is not a
    /// sensitive location. This is the one gate every read goes through.
    pub fn resolve(&self, path: &Path) -> Result<PathBuf, ScopeError> {
        self.resolve_with_home(path, home_dir().as_deref())
    }

    pub fn resolve_with_home(
        &self,
        path: &Path,
        home: Option<&Path>,
    ) -> Result<PathBuf, ScopeError> {
        let canon = path
            .canonicalize()
            .map_err(|_| ScopeError::NotFound(path.display().to_string()))?;
        if !self.roots.iter().any(|r| canon.starts_with(r)) {
            return Err(ScopeError::OutsideScope(path.display().to_string()));
        }
        if is_sensitive(&canon, home) {
            return Err(ScopeError::Forbidden(canon.display().to_string()));
        }
        Ok(canon)
    }
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .and_then(|p| p.canonicalize().ok())
}

fn is_sensitive(canon: &Path, home: Option<&Path>) -> bool {
    if let Some(home) = home {
        for d in SENSITIVE_HOME_DIRS {
            if canon.starts_with(home.join(d)) {
                return true;
            }
        }
    }
    false
}

fn check_grantable(canon: &Path, home: Option<&Path>) -> Result<(), ScopeError> {
    let shown = canon.display().to_string();
    for f in FORBIDDEN_ABSOLUTE {
        // The folder itself, never what is under it (`/Users/me/Documents` is fine).
        if canon == Path::new(f) {
            return Err(ScopeError::Forbidden(shown));
        }
    }
    // macOS volumes' roots and `/Users/<name>` — a whole home is too broad.
    if let Some(home) = home {
        if canon == home {
            return Err(ScopeError::Forbidden(shown));
        }
        if is_sensitive(canon, Some(home)) {
            return Err(ScopeError::Forbidden(shown));
        }
        // Also refuse a folder that *contains* the home (e.g. `/Users`).
        if home.starts_with(canon) {
            return Err(ScopeError::Forbidden(shown));
        }
    }
    for f in ["/System", "/Library", "/usr", "/bin", "/sbin", "/etc", "/private/etc"] {
        if canon.starts_with(f) {
            return Err(ScopeError::Forbidden(shown));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fake_home() -> tempfile::TempDir {
        let h = tempdir().unwrap();
        fs::create_dir_all(h.path().join("Documents/clients")).unwrap();
        fs::create_dir_all(h.path().join(".ssh")).unwrap();
        fs::write(h.path().join(".ssh/id_ed25519"), "secret").unwrap();
        fs::write(h.path().join("Documents/clients/a.pdf"), "%PDF").unwrap();
        h
    }

    #[test]
    fn grants_a_normal_folder_and_resolves_inside_it() {
        let h = fake_home();
        let home = h.path().canonicalize().unwrap();
        let mut s = ScopeStore::default();
        let root = s.grant_with_home(&home.join("Documents"), Some(&home)).unwrap();
        assert!(s.resolve_with_home(&root.join("clients/a.pdf"), Some(&home)).is_ok());
    }

    #[test]
    fn refuses_the_home_itself_root_and_sensitive_folders() {
        let h = fake_home();
        let home = h.path().canonicalize().unwrap();
        let mut s = ScopeStore::default();
        assert!(matches!(s.grant_with_home(&home, Some(&home)), Err(ScopeError::Forbidden(_))));
        assert!(matches!(s.grant_with_home(Path::new("/"), Some(&home)), Err(ScopeError::Forbidden(_))));
        assert!(matches!(
            s.grant_with_home(&home.join(".ssh"), Some(&home)),
            Err(ScopeError::Forbidden(_))
        ));
        assert!(matches!(s.grant_with_home(Path::new("/System"), Some(&home)), Err(ScopeError::Forbidden(_))));
        assert!(s.roots().is_empty());
    }

    #[test]
    fn refuses_a_parent_of_home() {
        let h = fake_home();
        let home = h.path().canonicalize().unwrap();
        let parent = home.parent().unwrap().to_path_buf();
        let mut s = ScopeStore::default();
        assert!(matches!(
            s.grant_with_home(&parent, Some(&home)),
            Err(ScopeError::Forbidden(_))
        ));
    }

    #[test]
    fn refuses_paths_outside_the_scope_and_dotdot_escapes() {
        let h = fake_home();
        let home = h.path().canonicalize().unwrap();
        let mut s = ScopeStore::default();
        let root = s.grant_with_home(&home.join("Documents"), Some(&home)).unwrap();
        let escape = root.join("clients/../../.ssh/id_ed25519");
        assert!(matches!(
            s.resolve_with_home(&escape, Some(&home)),
            Err(ScopeError::OutsideScope(_))
        ));
        assert!(matches!(
            s.resolve_with_home(Path::new("/etc/hosts"), Some(&home)),
            Err(ScopeError::OutsideScope(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_leaves_the_granted_folder() {
        let h = fake_home();
        let home = h.path().canonicalize().unwrap();
        let mut s = ScopeStore::default();
        let root = s.grant_with_home(&home.join("Documents"), Some(&home)).unwrap();
        std::os::unix::fs::symlink(home.join(".ssh/id_ed25519"), root.join("innocent.txt")).unwrap();
        assert!(matches!(
            s.resolve_with_home(&root.join("innocent.txt"), Some(&home)),
            Err(ScopeError::OutsideScope(_))
        ));
    }

    #[test]
    fn revoking_removes_access_and_a_parent_grant_absorbs_children() {
        let h = fake_home();
        let home = h.path().canonicalize().unwrap();
        let mut s = ScopeStore::default();
        let child = s.grant_with_home(&home.join("Documents/clients"), Some(&home)).unwrap();
        let parent = s.grant_with_home(&home.join("Documents"), Some(&home)).unwrap();
        assert_eq!(s.roots(), &[parent.clone()]);
        assert!(s.resolve_with_home(&child.join("a.pdf"), Some(&home)).is_ok());
        assert!(s.revoke(&parent));
        assert!(matches!(
            s.resolve_with_home(&child.join("a.pdf"), Some(&home)),
            Err(ScopeError::OutsideScope(_))
        ));
        assert!(!s.revoke(&parent));
    }

    #[test]
    fn grants_persist_and_vanished_folders_drop_out() {
        let h = fake_home();
        let home = h.path().canonicalize().unwrap();
        let file = h.path().join("data/scope.json");
        let mut s = ScopeStore::default();
        s.grant_with_home(&home.join("Documents"), Some(&home)).unwrap();
        s.save(&file).unwrap();
        let loaded = ScopeStore::load_with_home(&file, Some(&home));
        assert_eq!(loaded.roots().len(), 1);
        fs::remove_dir_all(home.join("Documents")).unwrap();
        assert!(ScopeStore::load_with_home(&file, Some(&home)).roots().is_empty());
    }
}
