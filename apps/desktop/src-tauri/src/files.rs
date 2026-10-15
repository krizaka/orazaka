//! Listing and previewing files — always through the scope (`ScopeStore::resolve`), never directly.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;

pub const MAX_ENTRIES: usize = 2000;
pub const MAX_TEXT_PREVIEW: usize = 64 * 1024;
pub const MAX_IMAGE_PREVIEW: u64 = 5 * 1024 * 1024;
pub const MAX_PDF_PREVIEW: u64 = 12 * 1024 * 1024;
/// The largest file "Send to workspace" will read into memory.
pub const MAX_SEND: u64 = 50 * 1024 * 1024;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub kind: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub kind: String,
    pub text: Option<String>,
    /// base64 of the file (images, PDFs) within the preview limits.
    pub data: Option<String>,
}

pub fn kind_of(name: &str) -> &'static str {
    match extension(name).as_str() {
        "pdf" => "pdf",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "svg" => "image",
        "mp4" | "mov" | "webm" | "m4v" => "video",
        "mp3" | "wav" | "m4a" | "flac" => "audio",
        "txt" | "md" | "csv" | "json" | "yaml" | "yml" | "xml" | "html" | "log" | "tsv" => "text",
        "doc" | "docx" | "odt" | "rtf" | "pages" => "document",
        "xls" | "xlsx" | "ods" | "numbers" => "sheet",
        _ => "file",
    }
}

pub fn mime_of(name: &str) -> &'static str {
    match extension(name).as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// A temp, partial or hidden name that is never listed nor reported by the folder watch.
pub fn is_noise(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with("~$")
        || name.ends_with('~')
        || name.ends_with(".crdownload")
        || name.ends_with(".part")
        || name.ends_with(".tmp")
        || name.ends_with(".download")
}

/// Lists a directory already resolved through the scope. Hidden files are skipped; folders first.
pub fn list_dir(dir: &Path) -> Result<Listing, String> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut truncated = false;
    let rd = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for item in rd.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if is_noise(&name) {
            continue;
        }
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        // `symlink_metadata`: a link is reported as a link and never followed here.
        let Ok(meta) = item.path().symlink_metadata() else { continue };
        if meta.file_type().is_symlink() {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(Entry {
            kind: if meta.is_dir() { "folder".into() } else { kind_of(&name).into() },
            path: item.path().display().to_string(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified,
            name,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Listing { entries, truncated })
}

pub fn preview(file: &Path) -> Result<Preview, String> {
    let meta = fs::metadata(file).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let kind = kind_of(&name);
    let mut p = Preview {
        mime: mime_of(&name).into(),
        kind: kind.into(),
        size: meta.len(),
        name,
        text: None,
        data: None,
    };
    match kind {
        "text" => {
            let mut buf = Vec::new();
            fs::File::open(file)
                .and_then(|f| f.take(MAX_TEXT_PREVIEW as u64).read_to_end(&mut buf))
                .map_err(|e| e.to_string())?;
            p.text = Some(String::from_utf8_lossy(&buf).to_string());
        }
        "image" if meta.len() <= MAX_IMAGE_PREVIEW => {
            p.data = Some(STANDARD.encode(fs::read(file).map_err(|e| e.to_string())?));
        }
        "pdf" if meta.len() <= MAX_PDF_PREVIEW => {
            p.data = Some(STANDARD.encode(fs::read(file).map_err(|e| e.to_string())?));
        }
        _ => {}
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn lists_folders_first_hides_noise_and_skips_symlinks() {
        let d = tempdir().unwrap();
        fs::create_dir(d.path().join("b-folder")).unwrap();
        fs::write(d.path().join("a.pdf"), "%PDF").unwrap();
        fs::write(d.path().join(".DS_Store"), "x").unwrap();
        fs::write(d.path().join("~$draft.docx"), "x").unwrap();
        fs::write(d.path().join("big.crdownload"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/hosts", d.path().join("link.txt")).unwrap();
        let l = list_dir(d.path()).unwrap();
        let names: Vec<_> = l.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["b-folder", "a.pdf"]);
        assert_eq!(l.entries[1].kind, "pdf");
    }

    #[test]
    fn previews_text_is_capped_and_pdf_is_base64() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("n.md"), "x".repeat(MAX_TEXT_PREVIEW + 100)).unwrap();
        fs::write(d.path().join("a.pdf"), "%PDF-1.4").unwrap();
        fs::write(d.path().join("x.bin"), [0u8, 1, 2]).unwrap();
        let t = preview(&d.path().join("n.md")).unwrap();
        assert_eq!(t.text.unwrap().len(), MAX_TEXT_PREVIEW);
        let p = preview(&d.path().join("a.pdf")).unwrap();
        assert_eq!(p.mime, "application/pdf");
        assert_eq!(STANDARD.decode(p.data.unwrap()).unwrap(), b"%PDF-1.4");
        let b = preview(&d.path().join("x.bin")).unwrap();
        assert!(b.text.is_none() && b.data.is_none());
        assert!(preview(d.path()).is_err());
    }

    #[test]
    fn noise_names() {
        for n in [".hidden", "~$a.docx", "a.part", "a.crdownload", "a.tmp"] {
            assert!(is_noise(n), "{n}");
        }
        assert!(!is_noise("contract.pdf"));
    }
}
