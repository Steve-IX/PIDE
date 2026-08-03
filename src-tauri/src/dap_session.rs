//! DAP (Debug Adapter Protocol) client over stdio JSON-RPC.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::FsError;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DapMessageEvent {
    kind: String,
    body: Value,
}

struct PendingSlot {
    tx: Sender<Value>,
}

struct LiveSession {
    child: Child,
    stdin: ChildStdin,
    next_seq: AtomicI64,
    pending: Arc<Mutex<HashMap<i64, PendingSlot>>>,
}

pub struct DapRegistry {
    session: Mutex<Option<LiveSession>>,
}

impl Default for DapRegistry {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

fn write_dap_message(stdin: &mut ChildStdin, msg: &Value) -> Result<(), FsError> {
    let body = serde_json::to_vec(msg)
        .map_err(|e| FsError::Message(format!("dap serialize: {e}")))?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| FsError::Message(format!("dap write header: {e}")))?;
    stdin
        .write_all(&body)
        .map_err(|e| FsError::Message(format!("dap write body: {e}")))?;
    stdin
        .flush()
        .map_err(|e| FsError::Message(format!("dap flush: {e}")))?;
    Ok(())
}

fn read_dap_message(reader: &mut impl BufRead) -> Result<Value, FsError> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| FsError::Message(format!("dap read header: {e}")))?;
        if n == 0 {
            return Err(FsError::Message("dap adapter closed stdout".into()));
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        let lower = trimmed.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length:") {
            content_length = rest.trim().parse().ok();
        }
    }
    let len = content_length.ok_or_else(|| FsError::Message("dap missing Content-Length".into()))?;
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .map_err(|e| FsError::Message(format!("dap read body: {e}")))?;
    serde_json::from_slice(&buf).map_err(|e| FsError::Message(format!("dap parse body: {e}")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapStartArgs {
    pub adapter_command: String,
    #[serde(default)]
    pub adapter_args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapRequestArgs {
    pub command: String,
    #[serde(default)]
    pub arguments: Option<Value>,
}

#[tauri::command]
pub async fn dap_start(
    app: AppHandle,
    registry: State<'_, Arc<DapRegistry>>,
    args: DapStartArgs,
) -> Result<(), FsError> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || dap_start_inner(app, registry, args))
        .await
        .map_err(|e| FsError::Message(format!("dap start task failed: {e}")))?
}

fn dap_start_inner(
    app: AppHandle,
    registry: Arc<DapRegistry>,
    args: DapStartArgs,
) -> Result<(), FsError> {
    let mut guard = registry
        .session
        .lock()
        .map_err(|_| FsError::Message("dap registry poisoned".into()))?;
    if guard.is_some() {
        return Err(FsError::Message(
            "DAP session already running — stop it first".into(),
        ));
    }

    let mut cmd = Command::new(&args.adapter_command);
    cmd.args(&args.adapter_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8");
    if let Some(cwd) = &args.cwd {
        if !cwd.is_empty() {
            cmd.current_dir(cwd);
        }
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        FsError::Message(format!(
            "Failed to start debug adapter `{}`: {e}. For Python: pip install debugpy",
            args.adapter_command
        ))
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| FsError::Message("dap adapter missing stdin".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| FsError::Message("dap adapter missing stdout".into()))?;

    if let Some(stderr) = child.stderr.take() {
        let app_err = app.clone();
        thread::spawn(move || {
            let mut r = BufReader::new(stderr);
            let mut line = String::new();
            while r.read_line(&mut line).ok().filter(|n| *n > 0).is_some() {
                let text = line.trim_end().to_string();
                line.clear();
                if text.is_empty() {
                    continue;
                }
                let _ = app_err.emit(
                    "dap://message",
                    DapMessageEvent {
                        kind: "event".into(),
                        body: json!({
                            "type": "event",
                            "event": "output",
                            "body": { "category": "stderr", "output": format!("{text}\n") }
                        }),
                    },
                );
            }
        });
    }

    let pending: Arc<Mutex<HashMap<i64, PendingSlot>>> = Arc::new(Mutex::new(HashMap::new()));
    let pending_reader = pending.clone();
    let app_reader = app.clone();

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_dap_message(&mut reader) {
                Ok(msg) => {
                    let msg_type = msg
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if msg_type == "response" {
                        if let Some(req_seq) = msg.get("request_seq").and_then(|v| v.as_i64()) {
                            if let Ok(mut map) = pending_reader.lock() {
                                if let Some(slot) = map.remove(&req_seq) {
                                    let _ = slot.tx.send(msg.clone());
                                }
                            }
                        }
                    }
                    let kind = if msg_type == "event" {
                        "event"
                    } else if msg_type == "response" {
                        "response"
                    } else {
                        msg_type.as_str()
                    };
                    let _ = app_reader.emit(
                        "dap://message",
                        DapMessageEvent {
                            kind: kind.into(),
                            body: msg,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_reader.emit(
            "dap://message",
            DapMessageEvent {
                kind: "event".into(),
                body: json!({
                    "type": "event",
                    "event": "pideTerminated",
                    "body": {}
                }),
            },
        );
    });

    *guard = Some(LiveSession {
        child,
        stdin,
        next_seq: AtomicI64::new(1),
        pending,
    });
    Ok(())
}

#[tauri::command]
pub async fn dap_request(
    registry: State<'_, Arc<DapRegistry>>,
    args: DapRequestArgs,
) -> Result<Value, FsError> {
    let command_name = args.command.clone();
    let rx = {
        let mut guard = registry
            .session
            .lock()
            .map_err(|_| FsError::Message("dap registry poisoned".into()))?;
        let session = guard
            .as_mut()
            .ok_or_else(|| FsError::Message("No active DAP session".into()))?;

        let seq = session.next_seq.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        {
            let mut map = session
                .pending
                .lock()
                .map_err(|_| FsError::Message("dap pending poisoned".into()))?;
            map.insert(seq, PendingSlot { tx });
        }

        let mut msg = json!({
            "seq": seq,
            "type": "request",
            "command": args.command,
        });
        if let Some(a) = args.arguments {
            msg["arguments"] = a;
        }

        if let Err(e) = write_dap_message(&mut session.stdin, &msg) {
            let mut map = session
                .pending
                .lock()
                .map_err(|_| FsError::Message("dap pending poisoned".into()))?;
            map.remove(&seq);
            return Err(e);
        }
        rx
    };

    // Wait off the UI/async runtime thread so concurrent DAP requests (e.g. debugpy
    // launch + configurationDone) cannot freeze the window.
    let timeout = if command_name == "launch" || command_name == "attach" {
        Duration::from_secs(90)
    } else {
        Duration::from_secs(30)
    };

    tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(timeout) {
        Ok(response) => Ok(response),
        Err(_) => Err(FsError::Message(format!(
            "DAP request `{command_name}` timed out"
        ))),
    })
    .await
    .map_err(|e| FsError::Message(format!("dap wait task failed: {e}")))?
}

#[tauri::command]
pub async fn dap_stop(registry: State<'_, Arc<DapRegistry>>) -> Result<(), FsError> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = registry
            .session
            .lock()
            .map_err(|_| FsError::Message("dap registry poisoned".into()))?;
        if let Some(mut session) = guard.take() {
            let _ = write_dap_message(
                &mut session.stdin,
                &json!({
                    "seq": session.next_seq.fetch_add(1, Ordering::SeqCst),
                    "type": "request",
                    "command": "disconnect",
                    "arguments": { "terminateDebuggee": true }
                }),
            );
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        Ok(())
    })
    .await
    .map_err(|e| FsError::Message(format!("dap stop task failed: {e}")))?
}

#[tauri::command]
pub fn dap_is_active(registry: State<'_, Arc<DapRegistry>>) -> Result<bool, FsError> {
    let guard = registry
        .session
        .lock()
        .map_err(|_| FsError::Message("dap registry poisoned".into()))?;
    Ok(guard.is_some())
}
