use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{configure_no_window, FsError};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct SidecarState {
    child: Option<Child>,
    pid: Option<u32>,
    base_url: String,
    last_error: Option<String>,
    /// Snapshot of last start config for resume-after-minimize.
    last_config: Option<StartLlamaSidecarArgs>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: None,
            pid: None,
            base_url: "http://127.0.0.1:8080".into(),
            last_error: None,
            last_config: None,
        }
    }
}

static STATE: Mutex<SidecarState> = Mutex::new(SidecarState {
    child: None,
    pid: None,
    base_url: String::new(),
    last_error: None,
    last_config: None,
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLlamaSidecarArgs {
    pub binary_path: String,
    pub gguf_path: String,
    pub base_url: String,
    pub num_gpu: i32,
    pub ctx: i32,
    pub kv_cache: String,
    pub ngram: bool,
    pub ngram_draft_n_max: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaSidecarStartResult {
    pub pid: u32,
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaSidecarStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub base_url: Option<String>,
    pub healthy: bool,
    pub last_error: Option<String>,
}

fn parse_port(base_url: &str) -> u16 {
    let trimmed = base_url.trim().trim_end_matches('/');
    if let Some(idx) = trimmed.rfind(':') {
        let port_str = &trimmed[idx + 1..];
        if let Ok(p) = port_str.parse::<u16>() {
            return p;
        }
    }
    8080
}

fn kv_flags(kv: &str) -> Vec<String> {
    let v = if kv.eq_ignore_ascii_case("f16") {
        "f16"
    } else {
        "q8_0"
    };
    // Prefer long flags; also pass short aliases for older llama.cpp builds via same values.
    vec![
        "--cache-type-k".into(),
        v.into(),
        "--cache-type-v".into(),
        v.into(),
    ]
}

fn is_process_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("tasklist");
        cmd.args(["/FI", &format!("PID eq {pid}"), "/NH"]);
        configure_no_window(&mut cmd);
        if let Ok(out) = cmd.output() {
            let text = String::from_utf8_lossy(&out.stdout);
            return text.contains(&pid.to_string());
        }
        false
    }
    #[cfg(not(windows))]
    {
        Path::new(&format!("/proc/{pid}")).exists()
    }
}

fn probe_healthy(base_url: &str) -> bool {
    let base = base_url.trim().trim_end_matches('/');
    let urls = [format!("{base}/health"), format!("{base}/v1/models")];
    for url in urls {
        let result = ureq::get(&url)
            .timeout(Duration::from_secs(2))
            .call();
        if let Ok(resp) = result {
            if resp.status() >= 200 && resp.status() < 300 {
                return true;
            }
        }
    }
    false
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        configure_no_window(&mut cmd);
        let _ = cmd.output();
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("kill");
        cmd.args(["-TERM", &pid.to_string()]);
        let _ = cmd.output();
    }
}

fn reap_if_exited(state: &mut SidecarState) {
    if let Some(child) = state.child.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                state.child = None;
                state.pid = None;
            }
            Ok(None) => {}
            Err(_) => {
                state.child = None;
                state.pid = None;
            }
        }
    } else if let Some(pid) = state.pid {
        if !is_process_alive(pid) {
            state.pid = None;
        }
    }
}

#[tauri::command]
pub async fn start_llama_sidecar(
    args: StartLlamaSidecarArgs,
) -> Result<LlamaSidecarStartResult, FsError> {
    tauri::async_runtime::spawn_blocking(move || start_llama_sidecar_sync(args))
        .await
        .map_err(|e| FsError::Message(format!("start_llama_sidecar join: {e}")))?
}

fn start_llama_sidecar_sync(args: StartLlamaSidecarArgs) -> Result<LlamaSidecarStartResult, FsError> {
    let binary = Path::new(args.binary_path.trim());
    let gguf = Path::new(args.gguf_path.trim());
    if !binary.is_file() {
        return Err(FsError::Message(format!(
            "llama-server binary not found: {}",
            args.binary_path
        )));
    }
    if !gguf.is_file() {
        return Err(FsError::Message(format!(
            "GGUF model not found: {}",
            args.gguf_path
        )));
    }

    let base_url = if args.base_url.trim().is_empty() {
        "http://127.0.0.1:8080".to_string()
    } else {
        args.base_url.trim().trim_end_matches('/').to_string()
    };
    let port = parse_port(&base_url);

    {
        let mut state = STATE
            .lock()
            .map_err(|_| FsError::Message("sidecar lock poisoned".into()))?;
        reap_if_exited(&mut state);
        if let Some(pid) = state.pid {
            if is_process_alive(pid) {
                if probe_healthy(&state.base_url) {
                    return Ok(LlamaSidecarStartResult {
                        pid,
                        base_url: state.base_url.clone(),
                    });
                }
                // Stale / unhealthy — kill and restart
                if let Some(mut child) = state.child.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                } else {
                    kill_pid(pid);
                }
                state.pid = None;
            }
        }
    }

    let mut cmd = Command::new(binary);
    cmd.arg("-m")
        .arg(gguf)
        .arg("-ngl")
        .arg(args.num_gpu.to_string())
        .arg("-c")
        .arg(args.ctx.to_string())
        .arg("-fa")
        .arg("on")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string());

    for f in kv_flags(&args.kv_cache) {
        cmd.arg(f);
    }

    if args.ngram {
        cmd.arg("--spec-type")
            .arg("ngram-mod")
            .arg("--spec-draft-n-max")
            .arg(args.ngram_draft_n_max.max(1).to_string());
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| FsError::Message(format!("Failed to spawn llama-server: {e}")))?;
    let pid = child.id();

    {
        let mut state = STATE
            .lock()
            .map_err(|_| FsError::Message("sidecar lock poisoned".into()))?;
        state.child = Some(child);
        state.pid = Some(pid);
        state.base_url = base_url.clone();
        state.last_error = None;
        state.last_config = Some(args.clone());
    }

    // Brief wait so bind can succeed; health is polled from UI.
    std::thread::sleep(Duration::from_millis(400));

    Ok(LlamaSidecarStartResult { pid, base_url })
}

#[tauri::command]
pub async fn stop_llama_sidecar() -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(stop_llama_sidecar_sync)
        .await
        .map_err(|e| FsError::Message(format!("stop_llama_sidecar join: {e}")))?
}

fn stop_llama_sidecar_sync() -> Result<(), FsError> {
    let mut state = STATE
        .lock()
        .map_err(|_| FsError::Message("sidecar lock poisoned".into()))?;
    if let Some(mut child) = state.child.take() {
        let pid = child.id();
        let _ = child.kill();
        let _ = child.wait();
        kill_pid(pid);
    } else if let Some(pid) = state.pid.take() {
        kill_pid(pid);
    }
    state.pid = None;
    state.last_error = None;
    Ok(())
}

#[tauri::command]
pub async fn llama_sidecar_status() -> Result<LlamaSidecarStatus, FsError> {
    tauri::async_runtime::spawn_blocking(llama_sidecar_status_sync)
        .await
        .map_err(|e| FsError::Message(format!("llama_sidecar_status join: {e}")))?
}

fn llama_sidecar_status_sync() -> Result<LlamaSidecarStatus, FsError> {
    let mut state = STATE
        .lock()
        .map_err(|_| FsError::Message("sidecar lock poisoned".into()))?;
    reap_if_exited(&mut state);
    let pid = state.pid;
    let running = pid.map(is_process_alive).unwrap_or(false);
    let base_url = if state.base_url.is_empty() {
        None
    } else {
        Some(state.base_url.clone())
    };
    let healthy = if running {
        base_url
            .as_ref()
            .map(|u| probe_healthy(u))
            .unwrap_or(false)
    } else {
        false
    };
    Ok(LlamaSidecarStatus {
        running,
        pid,
        base_url,
        healthy,
        last_error: state.last_error.clone(),
    })
}

/// Stop for minimize; keeps last_config so resume can restart.
#[tauri::command]
pub async fn suspend_llama_sidecar() -> Result<(), FsError> {
    stop_llama_sidecar().await
}

#[tauri::command]
pub async fn resume_llama_sidecar() -> Result<Option<LlamaSidecarStartResult>, FsError> {
    let config = {
        let state = STATE
            .lock()
            .map_err(|_| FsError::Message("sidecar lock poisoned".into()))?;
        state.last_config.clone()
    };
    match config {
        Some(args) => Ok(Some(start_llama_sidecar(args).await?)),
        None => Ok(None),
    }
}
