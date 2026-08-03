//! Interactive PTY sessions via `portable-pty` (ConPTY on Windows).

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

use crate::FsError;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl Default for PtyRegistry {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataEvent {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    id: String,
}

fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        // Prefer pwsh if present; fall back to Windows PowerShell.
        let pwsh = std::process::Command::new("where")
            .arg("pwsh")
            .output()
            .ok()
            .filter(|o| o.status.success());
        if pwsh.is_some() {
            CommandBuilder::new("pwsh.exe")
        } else {
            let mut cmd = CommandBuilder::new("powershell.exe");
            cmd.arg("-NoLogo");
            cmd
        }
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        CommandBuilder::new(shell)
    }
}

#[tauri::command]
pub fn pty_create(
    app: AppHandle,
    registry: State<'_, Arc<PtyRegistry>>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<String, FsError> {
    let cwd_path = std::path::PathBuf::from(&cwd);
    if !cwd.trim().is_empty() && !cwd_path.is_dir() {
        return Err(FsError::Message(format!("Not a directory: {cwd}")));
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| FsError::Message(format!("openpty failed: {e}")))?;

    let mut cmd = default_shell();
    if !cwd.trim().is_empty() {
        cmd.cwd(&cwd);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| FsError::Message(format!("spawn shell failed: {e}")))?;

    let killer = child
        .clone_killer();
    // Keep child alive by parking it on a wait thread so Drop doesn't reap oddly.
    thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| FsError::Message(format!("clone reader failed: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| FsError::Message(format!("take writer failed: {e}")))?;

    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst).to_string();
    let id_for_thread = id.clone();
    let registry_arc = registry.inner().clone();

    {
        let mut map = registry
            .sessions
            .lock()
            .map_err(|_| FsError::Message("pty registry poisoned".into()))?;
        map.insert(
            id.clone(),
            PtySession {
                master: pair.master,
                writer,
                killer,
            },
        );
    }

    let app_clone = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty://data",
                        PtyDataEvent {
                            id: id_for_thread.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(
            "pty://exit",
            PtyExitEvent {
                id: id_for_thread.clone(),
            },
        );
        if let Ok(mut map) = registry_arc.sessions.lock() {
            map.remove(&id_for_thread);
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(registry: State<'_, Arc<PtyRegistry>>, id: String, data: String) -> Result<(), FsError> {
    let mut map = registry
        .sessions
        .lock()
        .map_err(|_| FsError::Message("pty registry poisoned".into()))?;
    let session = map
        .get_mut(&id)
        .ok_or_else(|| FsError::Message(format!("unknown pty session: {id}")))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| FsError::Message(format!("pty write failed: {e}")))?;
    session
        .writer
        .flush()
        .map_err(|e| FsError::Message(format!("pty flush failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    registry: State<'_, Arc<PtyRegistry>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), FsError> {
    let map = registry
        .sessions
        .lock()
        .map_err(|_| FsError::Message("pty registry poisoned".into()))?;
    let session = map
        .get(&id)
        .ok_or_else(|| FsError::Message(format!("unknown pty session: {id}")))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| FsError::Message(format!("pty resize failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(registry: State<'_, Arc<PtyRegistry>>, id: String) -> Result<(), FsError> {
    let mut map = registry
        .sessions
        .lock()
        .map_err(|_| FsError::Message("pty registry poisoned".into()))?;
    if let Some(mut session) = map.remove(&id) {
        let _ = session.killer.kill();
    }
    Ok(())
}
