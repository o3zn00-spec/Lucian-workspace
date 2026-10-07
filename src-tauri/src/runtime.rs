//! Installed runtime layout. Never resolve release executables through PATH.
use std::{fs, path::{Path, PathBuf}};

#[derive(Debug)]
pub struct Runtime {
    pub web: PathBuf,
    pub node: PathBuf,
}

fn contained_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    if name.contains(['\\', ':']) || name.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err("Invalid runtime path".into());
    }
    let path = root.join(name).canonicalize().map_err(|_| "Runtime file missing")?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("Runtime file escaped its installation".into());
    }
    Ok(path)
}

pub fn packaged(resources: &Path) -> Result<Runtime, String> {
    resolve_distribution(resources, true)
}

// Fixture override is compiled out of release builds entirely.
#[cfg(debug_assertions)]
pub fn staged(resources: &Path) -> Result<Runtime, String> {
    resolve_distribution(resources, false)
}

fn resolve_distribution(resources: &Path, require_ready: bool) -> Result<Runtime, String> {
    let resources = resources.canonicalize().map_err(|_| "Resource directory missing")?;
    let root = resources.join("runtime").canonicalize().map_err(|_| "Runtime bundle missing")?;
    if !root.starts_with(&resources) { return Err("Runtime directory escaped its installation".into()); }
    let manifest_path = contained_file(&root, "distribution.json")?;
    if fs::metadata(&manifest_path).map_err(|_| "Runtime manifest unavailable")?.len() > 16384 {
        return Err("Runtime manifest too large".into());
    }
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(manifest_path).map_err(|_| "Runtime manifest unavailable")?
    ).map_err(|_| "Invalid runtime manifest")?;
    // Readiness is a packaging gate, not a signature or permission grant.
    if manifest["version"] != 1 || !manifest["releaseReady"].is_boolean() ||
        (require_ready && manifest["releaseReady"] != true) {
        return Err("Runtime distribution is not release-ready".into());
    }
    let node = contained_file(&root, "node/node.exe")?;
    let host = contained_file(&root, "web/desktop/host.mjs")?;
    contained_file(&root, "web/.next/BUILD_ID")?;
    contained_file(&root, "web/runtime-manifest.json")?;
    let web = root.join("web").canonicalize().map_err(|_| "Web runtime missing")?;
    if !host.starts_with(&web) {
        return Err("Runtime entry point escaped its component".into());
    }
    Ok(Runtime { web, node })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("lucian-layout-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(root.join("runtime")).unwrap();
        root.canonicalize().unwrap()
    }
    fn put(root: &Path, name: &str, bytes: &str) {
        let path = root.join("runtime").join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    #[test]
    fn rejects_incomplete_and_unapproved_distribution() {
        let root = fixture();
        assert!(packaged(&root).is_err());
        put(&root, "distribution.json", r#"{"version":1,"releaseReady":false}"#);
        assert!(packaged(&root).unwrap_err().contains("not release-ready"));
        put(&root, "distribution.json", r#"{"version":1,"releaseReady":true}"#);
        assert!(packaged(&root).unwrap_err().contains("missing"));
    }
    #[test]
    fn resolves_only_complete_fixed_layout() {
        let root = fixture();
        put(&root, "distribution.json", r#"{"version":1,"releaseReady":true}"#);
        for path in ["node/node.exe", "web/desktop/host.mjs", "web/.next/BUILD_ID", "web/runtime-manifest.json"] {
            put(&root, path, "fixture, not executable");
        }
        let runtime = packaged(&root).unwrap();
        assert!(runtime.node.starts_with(&root));
        assert!(runtime.web.ends_with("web"));
        put(&root, "distribution.json", r#"{"version":1,"releaseReady":false}"#);
        assert!(packaged(&root).is_err());
        #[cfg(debug_assertions)]
        assert!(staged(&root).is_ok());
    }
    #[test]
    fn rejects_bad_versions_and_oversized_manifest() {
        let root = fixture();
        put(&root, "distribution.json", r#"{"version":2,"releaseReady":true}"#);
        assert!(packaged(&root).is_err());
        put(&root, "distribution.json", &" ".repeat(16385));
        assert!(packaged(&root).unwrap_err().contains("too large"));
    }
    #[test]
    fn rejects_path_traversal_and_absolute_names() {
        let root = fixture();
        for name in ["../x", "/x", "C:/x", "a\\b", "a//b", "a/./b"] {
            assert!(contained_file(&root, name).is_err());
        }
    }
}
