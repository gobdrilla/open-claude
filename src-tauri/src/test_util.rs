//! Shared helpers for unit tests.

use std::path::{Path, PathBuf};

/// Temp dir `$TMPDIR/ocui-<name>-<pid>`, removed on drop so test runs leave nothing behind.
pub(crate) struct Tmp(pub PathBuf);

impl Tmp {
    /// Fresh, empty directory (leftovers of an earlier run with the same pid are wiped).
    pub(crate) fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("ocui-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Tmp(dir)
    }
}

impl std::ops::Deref for Tmp {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.0
    }
}

impl AsRef<Path> for Tmp {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
