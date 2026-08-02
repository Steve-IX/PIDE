use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use thiserror::Error;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

mod github;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_TREE_DEPTH: usize = 8;
const MAX_ENTRIES_PER_DIR: usize = 400;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
];

#[derive(Debug, Error)]
pub enum FsError {
    #[error("{0}")]
    Message(String),
}

impl Serialize for FsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub entries: Vec<GitStatusEntry>,
    pub error: Option<String>,
}

const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "pdf", "zip", "gz", "7z", "rar", "exe",
    "dll", "so", "dylib", "wasm", "mp3", "mp4", "mov", "avi", "woff", "woff2", "ttf", "eot",
    "bin", "o", "obj", "class", "jar", "pyc", "pdb",
];

fn is_probably_text(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if BINARY_EXTS.iter().any(|b| b.eq_ignore_ascii_case(ext)) {
            return false;
        }
    }
    true
}

fn search_in_file(path: &Path, query: &str, out: &mut Vec<SearchMatch>, max: usize) {
    if out.len() >= max || !is_probably_text(path) {
        return;
    }
    let Ok(meta) = fs::metadata(path) else { return };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return;
    }
    let Ok(content) = fs::read_to_string(path) else { return };
    let q = query.to_lowercase();
    for (idx, line) in content.lines().enumerate() {
        if out.len() >= max {
            break;
        }
        if let Some(col) = line.to_lowercase().find(&q) {
            let preview: String = line.chars().take(200).collect();
            out.push(SearchMatch {
                path: path.to_string_lossy().to_string(),
                line: idx + 1,
                column: col + 1,
                preview: preview.trim().to_string(),
            });
        }
    }
}

fn walk_search(dir: &Path, query: &str, out: &mut Vec<SearchMatch>, max: usize, depth: usize) {
    if out.len() >= max || depth > MAX_TREE_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= max {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if should_skip_dir(&name) {
                continue;
            }
            walk_search(&path, query, out, max, depth + 1);
        } else {
            search_in_file(&path, query, out, max);
        }
    }
}

fn configure_no_window(cmd: &mut Command) {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn run_git(workspace: &Path, args: &[&str]) -> Result<std::process::Output, FsError> {
    run_git_with_auth(workspace, args, None)
}

fn write_askpass_helper() -> Result<PathBuf, FsError> {
    let dir = std::env::temp_dir().join("pide-askpass");
    fs::create_dir_all(&dir).map_err(|e| FsError::Message(e.to_string()))?;
    #[cfg(windows)]
    {
        let path = dir.join("askpass.cmd");
        // Token lives in PIDE_GIT_PASSWORD env — not in argv / script body.
        fs::write(
            &path,
            "@echo off\r\necho %~1 | find /I \"Username\" >nul\r\nif %errorlevel%==0 (\r\necho %GIT_USERNAME%\r\n) else (\r\necho %PIDE_GIT_PASSWORD%\r\n)\r\n",
        )
        .map_err(|e| FsError::Message(e.to_string()))?;
        Ok(path)
    }
    #[cfg(not(windows))]
    {
        let path = dir.join("askpass.sh");
        fs::write(
            &path,
            "#!/bin/sh\ncase \"$1\" in\n  *[Uu]sername*) printf '%s\\n' \"$GIT_USERNAME\" ;;\n  *) printf '%s\\n' \"$PIDE_GIT_PASSWORD\" ;;\nesac\n",
        )
        .map_err(|e| FsError::Message(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path)
                .map_err(|e| FsError::Message(e.to_string()))?
                .permissions();
            perms.set_mode(0o700);
            fs::set_permissions(&path, perms).map_err(|e| FsError::Message(e.to_string()))?;
        }
        Ok(path)
    }
}

fn run_git_with_auth(
    workspace: &Path,
    args: &[&str],
    token: Option<&str>,
) -> Result<std::process::Output, FsError> {
    let mut cmd = Command::new("git");
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .current_dir(workspace);

    // Prefer PIDE keyring token via GIT_ASKPASS (token not passed as git argv).
    if let Some(t) = token.filter(|s| !s.is_empty()) {
        let askpass = write_askpass_helper()?;
        cmd.env("GIT_ASKPASS", &askpass);
        cmd.env("SSH_ASKPASS", &askpass);
        cmd.env("GIT_USERNAME", "x-access-token");
        cmd.env("PIDE_GIT_PASSWORD", t);
        // Disable other credential helpers for this process so they don't steal the prompt.
        cmd.env("GIT_CONFIG_COUNT", "2");
        cmd.env("GIT_CONFIG_KEY_0", "credential.helper");
        cmd.env("GIT_CONFIG_VALUE_0", "");
        cmd.env("GIT_CONFIG_KEY_1", "credential.username");
        cmd.env("GIT_CONFIG_VALUE_1", "x-access-token");
    }

    cmd.args(args);
    configure_no_window(&mut cmd);
    cmd.output()
        .map_err(|e| FsError::Message(format!("git not available: {e}")))
}

fn load_token_optional() -> Option<String> {
    github::load_session()
        .ok()
        .flatten()
        .map(|s| s.token)
}

fn git_output_text(out: &std::process::Output) -> String {
    let err = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    format!("{}{}", err.trim(), stdout.trim()).trim().to_string()
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|s| *s == name)
}

fn canonicalize_loose(path: &Path) -> Result<PathBuf, FsError> {
    if let Ok(can) = fs::canonicalize(path) {
        return Ok(can);
    }

    // Walk up until an existing ancestor is found, then rebuild the suffix.
    let mut suffix: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = path.to_path_buf();
    loop {
        if let Some(name) = cursor.file_name() {
            suffix.push(name.to_os_string());
        }
        let parent = match cursor.parent() {
            Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
            _ => {
                return Err(FsError::Message(format!(
                    "Cannot resolve path: {}",
                    path.display()
                )));
            }
        };
        if let Ok(parent_can) = fs::canonicalize(&parent) {
            let mut resolved = parent_can;
            for part in suffix.iter().rev() {
                resolved.push(part);
            }
            return Ok(resolved);
        }
        cursor = parent;
    }
}

fn ensure_inside_workspace(workspace: &str, target: &Path) -> Result<PathBuf, FsError> {
    let root = PathBuf::from(workspace);
    if !root.is_dir() {
        return Err(FsError::Message(format!(
            "Workspace is not a directory: {workspace}"
        )));
    }
    let root_can = fs::canonicalize(&root)
        .map_err(|e| FsError::Message(format!("Invalid workspace: {e}")))?;
    let target_can = canonicalize_loose(target)?;

    if !target_can.starts_with(&root_can) {
        return Err(FsError::Message(
            "Path is outside the open workspace.".into(),
        ));
    }
    Ok(target_can)
}

fn build_tree(path: &Path, depth: usize) -> Result<FileNode, FsError> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let meta = fs::metadata(path)
        .map_err(|e| FsError::Message(format!("metadata {}: {e}", path.display())))?;

    if !meta.is_dir() {
        return Ok(FileNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir: false,
            children: None,
        });
    }

    let mut children = Vec::new();
    if depth < MAX_TREE_DEPTH {
        let mut entries: Vec<_> = fs::read_dir(path)
            .map_err(|e| FsError::Message(format!("read_dir {}: {e}", path.display())))?
            .filter_map(|e| e.ok())
            .collect();

        entries.sort_by(|a, b| {
            let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
            match (a_dir, b_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.file_name().cmp(&b.file_name()),
            }
        });

        for entry in entries.into_iter().take(MAX_ENTRIES_PER_DIR) {
            let child_path = entry.path();
            let child_name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

            if is_dir && should_skip_dir(&child_name) {
                continue;
            }

            match build_tree(&child_path, depth + 1) {
                Ok(node) => children.push(node),
                Err(_) => continue,
            }
        }
    }

    Ok(FileNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: true,
        children: Some(children),
    })
}

#[tauri::command]
fn read_workspace_tree(root: String) -> Result<FileNode, FsError> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(FsError::Message(format!("Not a directory: {root}")));
    }
    build_tree(&path, 0)
}

#[tauri::command]
fn read_file(workspace: String, path: String) -> Result<String, FsError> {
    let p = ensure_inside_workspace(&workspace, Path::new(&path))?;
    if !p.is_file() {
        return Err(FsError::Message(format!("Not a file: {path}")));
    }
    let meta = fs::metadata(&p).map_err(|e| FsError::Message(e.to_string()))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(FsError::Message(format!(
            "File too large ({} bytes). Max is {} bytes.",
            meta.len(),
            MAX_FILE_BYTES
        )));
    }
    fs::read_to_string(&p).map_err(|e| FsError::Message(format!("Failed to read {path}: {e}")))
}

#[tauri::command]
fn write_file(workspace: String, path: String, contents: String) -> Result<(), FsError> {
    let p = ensure_inside_workspace(&workspace, Path::new(&path))?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| FsError::Message(e.to_string()))?;
    }
    fs::write(&p, contents).map_err(|e| FsError::Message(format!("Failed to write {path}: {e}")))
}

#[tauri::command]
fn create_file(workspace: String, path: String, contents: Option<String>) -> Result<(), FsError> {
    let p = ensure_inside_workspace(&workspace, Path::new(&path))?;
    if p.exists() {
        return Err(FsError::Message(format!("Already exists: {path}")));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| FsError::Message(e.to_string()))?;
    }
    fs::write(&p, contents.unwrap_or_default())
        .map_err(|e| FsError::Message(format!("Failed to create {path}: {e}")))
}

#[tauri::command]
fn create_dir(workspace: String, path: String) -> Result<(), FsError> {
    let p = ensure_inside_workspace(&workspace, Path::new(&path))?;
    if p.exists() {
        return Err(FsError::Message(format!("Already exists: {path}")));
    }
    fs::create_dir_all(&p).map_err(|e| FsError::Message(format!("Failed to create dir {path}: {e}")))
}

#[tauri::command]
fn rename_path(workspace: String, from: String, to: String) -> Result<(), FsError> {
    let from_p = ensure_inside_workspace(&workspace, Path::new(&from))?;
    let to_p = ensure_inside_workspace(&workspace, Path::new(&to))?;
    if !from_p.exists() {
        return Err(FsError::Message(format!("Not found: {from}")));
    }
    if to_p.exists() {
        return Err(FsError::Message(format!("Target already exists: {to}")));
    }
    if let Some(parent) = to_p.parent() {
        fs::create_dir_all(parent).map_err(|e| FsError::Message(e.to_string()))?;
    }
    fs::rename(&from_p, &to_p)
        .map_err(|e| FsError::Message(format!("Failed to rename: {e}")))
}

#[tauri::command]
fn delete_path(workspace: String, path: String) -> Result<(), FsError> {
    let p = ensure_inside_workspace(&workspace, Path::new(&path))?;
    let root = fs::canonicalize(PathBuf::from(&workspace))
        .map_err(|e| FsError::Message(e.to_string()))?;
    if p == root {
        return Err(FsError::Message(
            "Refusing to delete the workspace root.".into(),
        ));
    }
    if !p.exists() {
        return Err(FsError::Message(format!("Not found: {path}")));
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| FsError::Message(format!("Failed to delete dir: {e}")))
    } else {
        fs::remove_file(&p).map_err(|e| FsError::Message(format!("Failed to delete file: {e}")))
    }
}

#[tauri::command]
async fn run_shell_command(cwd: String, command: String) -> Result<ShellResult, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let cwd_path = PathBuf::from(&cwd);
        if !cwd_path.is_dir() {
            return Err(FsError::Message(format!("Invalid cwd: {cwd}")));
        }

        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("powershell");
            c.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &command,
            ])
            .current_dir(&cwd_path);
            c
        };

        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-lc", &command]).current_dir(&cwd_path);
            c
        };

        configure_no_window(&mut cmd);
        let output = cmd
            .output()
            .map_err(|e| FsError::Message(format!("Failed to run shell: {e}")))?;

        Ok(ShellResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            code: output.status.code().unwrap_or(-1),
            cwd,
        })
    })
    .await
    .map_err(|e| FsError::Message(format!("shell task failed: {e}")))?
}

#[tauri::command]
async fn search_workspace(
    workspace: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchMatch>, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }
        let root = PathBuf::from(&workspace);
        if !root.is_dir() {
            return Err(FsError::Message(format!("Not a directory: {workspace}")));
        }
        let max = max_results.unwrap_or(200).clamp(1, 1000);
        let mut out = Vec::new();
        walk_search(&root, q, &mut out, max, 0);
        Ok(out)
    })
    .await
    .map_err(|e| FsError::Message(format!("search task failed: {e}")))?
}

fn git_status_sync(workspace: String) -> Result<GitStatus, FsError> {
    let root = PathBuf::from(&workspace);
    if !root.is_dir() {
        return Err(FsError::Message(format!("Not a directory: {workspace}")));
    }

    let check = run_git(&root, &["rev-parse", "--is-inside-work-tree"]);
    let Ok(check_out) = check else {
        return Ok(GitStatus {
            is_repo: false,
            branch: String::new(),
            entries: vec![],
            error: Some("git not available on PATH".into()),
        });
    };
    if !check_out.status.success() {
        return Ok(GitStatus {
            is_repo: false,
            branch: String::new(),
            entries: vec![],
            error: None,
        });
    }

    let branch_out = run_git(&root, &["branch", "--show-current"])?;
    let branch = String::from_utf8_lossy(&branch_out.stdout).trim().to_string();

    let status_out = run_git(&root, &["status", "--porcelain=1", "-uall"])?;
    if !status_out.status.success() {
        return Ok(GitStatus {
            is_repo: true,
            branch,
            entries: vec![],
            error: Some(String::from_utf8_lossy(&status_out.stderr).trim().to_string()),
        });
    }

    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(&status_out.stdout).lines() {
        if line.len() < 3 {
            continue;
        }
        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let mut path = line[3..].to_string();
        if path.starts_with('"') && path.ends_with('"') {
            path = path.trim_matches('"').to_string();
        }
        if let Some((_, right)) = path.split_once(" -> ") {
            path = right.to_string();
        }
        let untracked = x == '?' && y == '?';
        let staged = !untracked && x != ' ' && x != '?';
        let unstaged = !untracked && y != ' ';
        entries.push(GitStatusEntry {
            path,
            index_status: x.to_string(),
            worktree_status: y.to_string(),
            staged,
            unstaged: unstaged || untracked,
            untracked,
        });
    }

    Ok(GitStatus {
        is_repo: true,
        branch,
        entries,
        error: None,
    })
}

#[tauri::command]
async fn git_status(workspace: String) -> Result<GitStatus, FsError> {
    tauri::async_runtime::spawn_blocking(move || git_status_sync(workspace))
        .await
        .map_err(|e| FsError::Message(format!("git_status task failed: {e}")))?
}

#[tauri::command]
async fn git_diff(workspace: String, path: String, staged: bool) -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&workspace);
        ensure_inside_workspace(&workspace, &root.join(&path))?;

        if staged {
            let out = run_git(&root, &["diff", "--cached", "--", &path])?;
            return Ok(String::from_utf8_lossy(&out.stdout).to_string());
        }

        let status = run_git(&root, &["status", "--porcelain=1", "--", &path])?;
        let line = String::from_utf8_lossy(&status.stdout);
        if line.trim_start().starts_with("??") {
            let full = root.join(&path);
            let content = fs::read_to_string(&full).unwrap_or_default();
            return Ok(content
                .lines()
                .map(|l| format!("+{l}"))
                .collect::<Vec<_>>()
                .join("\n"));
        }

        let out = run_git(&root, &["diff", "--", &path])?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    })
    .await
    .map_err(|e| FsError::Message(format!("git_diff task failed: {e}")))?
}

#[tauri::command]
async fn git_stage(workspace: String, path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&workspace);
        ensure_inside_workspace(&workspace, &root.join(&path))?;
        let out = run_git(&root, &["add", "--", &path])?;
        if !out.status.success() {
            return Err(FsError::Message(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| FsError::Message(format!("git_stage task failed: {e}")))?
}

#[tauri::command]
async fn git_unstage(workspace: String, path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&workspace);
        ensure_inside_workspace(&workspace, &root.join(&path))?;
        let out = run_git(&root, &["restore", "--staged", "--", &path])?;
        if out.status.success() {
            return Ok(());
        }
        let out2 = run_git(&root, &["reset", "HEAD", "--", &path])?;
        if !out2.status.success() {
            return Err(FsError::Message(
                String::from_utf8_lossy(&out2.stderr).trim().to_string(),
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| FsError::Message(format!("git_unstage task failed: {e}")))?
}

#[tauri::command]
async fn git_commit(workspace: String, message: String) -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&workspace);
        let msg = message.trim();
        if msg.is_empty() {
            return Err(FsError::Message("Commit message is empty".into()));
        }
        let out = run_git(&root, &["commit", "-m", msg])?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            return Err(FsError::Message(format!("{}{}", err.trim(), stdout.trim())));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| FsError::Message(format!("git_commit task failed: {e}")))?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub is_repo: bool,
    pub branch: String,
    pub remote: Option<String>,
    pub remote_url: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub error: Option<String>,
}

fn git_remote_info_sync(workspace: String) -> Result<GitRemoteInfo, FsError> {
    let root = PathBuf::from(&workspace);
    if !root.is_dir() {
        return Err(FsError::Message(format!("Not a directory: {workspace}")));
    }

    let check = run_git(&root, &["rev-parse", "--is-inside-work-tree"]);
    let Ok(check_out) = check else {
        return Ok(GitRemoteInfo {
            is_repo: false,
            branch: String::new(),
            remote: None,
            remote_url: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            error: Some("git not available on PATH".into()),
        });
    };
    if !check_out.status.success() {
        return Ok(GitRemoteInfo {
            is_repo: false,
            branch: String::new(),
            remote: None,
            remote_url: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            error: None,
        });
    }

    let branch = String::from_utf8_lossy(
        &run_git(&root, &["branch", "--show-current"])?
            .stdout,
    )
    .trim()
    .to_string();

    let remote_out = run_git(&root, &["remote"])?;
    let remote = String::from_utf8_lossy(&remote_out.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let remote_url = if let Some(ref r) = remote {
        let out = run_git(&root, &["remote", "get-url", r])?;
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    };

    let upstream_out = run_git(&root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    let upstream = upstream_out.ok().and_then(|o| {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        } else {
            None
        }
    });

    let mut ahead = 0u32;
    let mut behind = 0u32;
    if upstream.is_some() {
        if let Ok(out) = run_git(&root, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                let mut parts = text.split_whitespace();
                ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            }
        }
    }

    Ok(GitRemoteInfo {
        is_repo: true,
        branch,
        remote,
        remote_url,
        upstream,
        ahead,
        behind,
        error: None,
    })
}

#[tauri::command]
async fn git_remote_info(workspace: String) -> Result<GitRemoteInfo, FsError> {
    tauri::async_runtime::spawn_blocking(move || git_remote_info_sync(workspace))
        .await
        .map_err(|e| FsError::Message(format!("git_remote_info failed: {e}")))?
}

fn git_remote_op_sync(workspace: String, op: &str) -> Result<String, FsError> {
    let root = PathBuf::from(&workspace);
    let token = load_token_optional();
    let token_ref = token.as_deref();

    let remote_name = {
        let info = git_remote_info_sync(workspace.clone())?;
        info.remote.unwrap_or_else(|| "origin".into())
    };
    let remote_owned = remote_name.clone();

    let args_owned: Vec<String> = match op {
        "fetch" => vec![
            "fetch".into(),
            "--prune".into(),
            remote_owned.clone(),
        ],
        "pull" => vec!["pull".into(), "--ff-only".into()],
        "push" => vec![
            "push".into(),
            "-u".into(),
            remote_owned,
            "HEAD".into(),
        ],
        _ => return Err(FsError::Message(format!("Unknown op: {op}"))),
    };
    let args: Vec<&str> = args_owned.iter().map(|s| s.as_str()).collect();

    let out = run_git_with_auth(&root, &args, token_ref)?;
    if !out.status.success() {
        let msg = git_output_text(&out);
        let lower = msg.to_lowercase();
        if lower.contains("authentication")
            || lower.contains("could not read username")
            || lower.contains("401")
            || lower.contains("403")
            || lower.contains("denied")
        {
            return Err(FsError::Message(if token.is_none() {
                "Not authenticated. Sign in with GitHub or add a PAT.".into()
            } else {
                format!("GitHub auth failed: {msg}")
            }));
        }
        if lower.contains("non-fast-forward") || lower.contains("fetch first") {
            return Err(FsError::Message(format!(
                "Non-fast-forward — pull/rebase first: {msg}"
            )));
        }
        return Err(FsError::Message(if msg.is_empty() {
            format!("git {op} failed")
        } else {
            msg
        }));
    }
    let msg = git_output_text(&out);
    Ok(if msg.is_empty() {
        format!("git {op} ok")
    } else {
        msg
    })
}

#[tauri::command]
async fn git_fetch(workspace: String) -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(move || git_remote_op_sync(workspace, "fetch"))
        .await
        .map_err(|e| FsError::Message(format!("git_fetch failed: {e}")))?
}

#[tauri::command]
async fn git_pull(workspace: String) -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(move || git_remote_op_sync(workspace, "pull"))
        .await
        .map_err(|e| FsError::Message(format!("git_pull failed: {e}")))?
}

#[tauri::command]
async fn git_push(workspace: String) -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(move || git_remote_op_sync(workspace, "push"))
        .await
        .map_err(|e| FsError::Message(format!("git_push failed: {e}")))?
}

#[tauri::command]
async fn git_sync(workspace: String) -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let pull = git_remote_op_sync(workspace.clone(), "pull")?;
        let push = git_remote_op_sync(workspace, "push")?;
        Ok(format!("{pull}\n{push}"))
    })
    .await
    .map_err(|e| FsError::Message(format!("git_sync failed: {e}")))?
}

#[tauri::command]
async fn github_device_start(client_id: String) -> Result<github::DeviceStart, github::GhError> {
    tauri::async_runtime::spawn_blocking(move || github::device_start(&client_id))
        .await
        .map_err(|e| github::GhError::Message(format!("device_start failed: {e}")))?
}

#[tauri::command]
async fn github_device_poll(
    client_id: String,
    device_code: String,
) -> Result<Option<github::GitHubUser>, github::GhError> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(github::device_poll(&client_id, &device_code)?.map(|s| github::GitHubUser::from(&s)))
    })
    .await
    .map_err(|e| github::GhError::Message(format!("device_poll failed: {e}")))?
}

#[tauri::command]
async fn github_save_pat(token: String) -> Result<github::GitHubUser, github::GhError> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(github::GitHubUser::from(&github::save_pat(&token)?))
    })
    .await
    .map_err(|e| github::GhError::Message(format!("save_pat failed: {e}")))?
}

#[tauri::command]
async fn github_load_session() -> Result<Option<github::GitHubUser>, github::GhError> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(github::load_session()?.map(|s| github::GitHubUser::from(&s)))
    })
    .await
    .map_err(|e| github::GhError::Message(format!("load_session failed: {e}")))?
}

#[tauri::command]
async fn github_clear_session() -> Result<(), github::GhError> {
    tauri::async_runtime::spawn_blocking(github::clear_session)
        .await
        .map_err(|e| github::GhError::Message(format!("clear_session failed: {e}")))?
}

#[tauri::command]
async fn github_get_user() -> Result<Option<github::GitHubUser>, github::GhError> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(session) = github::load_session()? else {
            return Ok(None);
        };
        match github::fetch_user(&session.token) {
            Ok(fresh) => {
                let merged = github::GitHubSession {
                    token: session.token,
                    login: fresh.login,
                    name: fresh.name,
                    avatar_url: fresh.avatar_url,
                };
                github::save_session(&merged)?;
                Ok(Some(github::GitHubUser::from(&merged)))
            }
            Err(e) => {
                let _ = github::clear_session();
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| github::GhError::Message(format!("get_user failed: {e}")))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_workspace_tree,
            read_file,
            write_file,
            create_file,
            create_dir,
            rename_path,
            delete_path,
            run_shell_command,
            search_workspace,
            git_status,
            git_diff,
            git_stage,
            git_unstage,
            git_commit,
            git_remote_info,
            git_fetch,
            git_pull,
            git_push,
            git_sync,
            github_device_start,
            github_device_poll,
            github_save_pat,
            github_load_session,
            github_clear_session,
            github_get_user
        ])
        .run(tauri::generate_context!())
        .expect("error while running PIDE");
}
