//! Wasmtime WASI sandbox + resource-limited host process spawn.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

use crate::{ensure_inside_workspace, FsError};

#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SandboxChunkEvent {
    stream: String,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub timed_out: bool,
    pub reason: String,
    pub kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxWasmArgs {
    pub workspace_path: String,
    pub wasm_path: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub stdin: Option<String>,
    #[serde(default)]
    pub wall_seconds: Option<u64>,
    #[serde(default)]
    pub wasm_memory_mib: Option<u64>,
    #[serde(default)]
    pub fuel: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxLimitedArgs {
    pub workspace_path: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub wall_seconds: Option<u64>,
    #[serde(default)]
    pub host_memory_mib: Option<u64>,
}

struct ActiveJob {
    cancel: Arc<AtomicBool>,
}

pub struct SandboxRegistry {
    job: Mutex<Option<ActiveJob>>,
}

impl Default for SandboxRegistry {
    fn default() -> Self {
        Self {
            job: Mutex::new(None),
        }
    }
}

fn default_wall_secs(v: Option<u64>) -> u64 {
    v.unwrap_or(5).clamp(1, 120)
}

fn default_wasm_mem_mib(v: Option<u64>) -> u64 {
    v.unwrap_or(64).clamp(1, 512)
}

fn default_fuel(v: Option<u64>) -> u64 {
    v.unwrap_or(50_000_000).clamp(1_000, 500_000_000)
}

fn default_host_mem_mib(v: Option<u64>) -> u64 {
    v.unwrap_or(256).clamp(16, 2048)
}

fn emit_chunk(app: &AppHandle, stream: &str, data: &str) {
    if data.is_empty() {
        return;
    }
    let _ = app.emit(
        "sandbox://chunk",
        SandboxChunkEvent {
            stream: stream.into(),
            data: data.into(),
        },
    );
}

fn begin_job(registry: &SandboxRegistry) -> Result<Arc<AtomicBool>, FsError> {
    let mut guard = registry
        .job
        .lock()
        .map_err(|_| FsError::Message("sandbox registry poisoned".into()))?;
    if guard.is_some() {
        return Err(FsError::Message(
            "A sandbox job is already running. Cancel it first.".into(),
        ));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *guard = Some(ActiveJob {
        cancel: cancel.clone(),
    });
    Ok(cancel)
}

fn end_job(registry: &SandboxRegistry) {
    if let Ok(mut guard) = registry.job.lock() {
        *guard = None;
    }
}

#[tauri::command]
pub fn sandbox_cancel(registry: State<'_, Arc<SandboxRegistry>>) -> Result<(), FsError> {
    let guard = registry
        .job
        .lock()
        .map_err(|_| FsError::Message("sandbox registry poisoned".into()))?;
    if let Some(job) = guard.as_ref() {
        job.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn sandbox_is_active(registry: State<'_, Arc<SandboxRegistry>>) -> Result<bool, FsError> {
    let guard = registry
        .job
        .lock()
        .map_err(|_| FsError::Message("sandbox registry poisoned".into()))?;
    Ok(guard.is_some())
}

#[tauri::command]
pub async fn sandbox_run_wasm(
    app: AppHandle,
    registry: State<'_, Arc<SandboxRegistry>>,
    args: SandboxWasmArgs,
) -> Result<SandboxResult, FsError> {
    let cancel = begin_job(&registry)?;
    let reg = registry.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let out = run_wasm_inner(&app, cancel, args);
        end_job(&reg);
        out
    })
    .await
    .map_err(|e| FsError::Message(format!("sandbox wasm task failed: {e}")))?;
    result
}

fn run_wasm_inner(
    app: &AppHandle,
    cancel: Arc<AtomicBool>,
    args: SandboxWasmArgs,
) -> Result<SandboxResult, FsError> {
    use wasmtime::{Config, Engine, Linker, Module, Store, StoreLimitsBuilder};
    use wasmtime_wasi::p1::{self, WasiP1Ctx};
    use wasmtime_wasi::p2::pipe::{MemoryInputPipe, MemoryOutputPipe};
    use wasmtime_wasi::{DirPerms, FilePerms, I32Exit, WasiCtxBuilder};

    let wall = Duration::from_secs(default_wall_secs(args.wall_seconds));
    let mem_bytes = default_wasm_mem_mib(args.wasm_memory_mib) * 1024 * 1024;
    let fuel = default_fuel(args.fuel);

    let wasm_path =
        ensure_inside_workspace(&args.workspace_path, Path::new(&args.wasm_path))?;
    if !wasm_path.is_file() {
        return Err(FsError::Message(format!(
            "Not a file: {}",
            args.wasm_path
        )));
    }
    let workspace =
        ensure_inside_workspace(&args.workspace_path, Path::new(&args.workspace_path))?;

    let mut config = Config::new();
    config.consume_fuel(true);
    config.epoch_interruption(true);
    let engine = Engine::new(&config)
        .map_err(|e| FsError::Message(format!("wasmtime engine: {e}")))?;

    struct State {
        wasi: WasiP1Ctx,
        limits: wasmtime::StoreLimits,
    }

    let stdout_pipe = MemoryOutputPipe::new(2 * 1024 * 1024);
    let stderr_pipe = MemoryOutputPipe::new(2 * 1024 * 1024);
    let stdin_bytes = args.stdin.unwrap_or_default();
    let stdin_pipe = MemoryInputPipe::new(stdin_bytes.into_bytes());

    let mut builder = WasiCtxBuilder::new();
    builder.stdin(stdin_pipe);
    builder.stdout(stdout_pipe.clone());
    builder.stderr(stderr_pipe.clone());
    let mut wasm_args = vec![wasm_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "guest.wasm".into())];
    wasm_args.extend(args.args);
    builder.args(&wasm_args);
    builder
        .preopened_dir(&workspace, ".", DirPerms::all(), FilePerms::all())
        .map_err(|e| FsError::Message(format!("wasi preopen: {e}")))?;

    let limits = StoreLimitsBuilder::new()
        .memory_size(mem_bytes as usize)
        .instances(4)
        .memories(4)
        .tables(8)
        .build();

    let state = State {
        wasi: builder.build_p1(),
        limits,
    };

    let mut linker = Linker::new(&engine);
    p1::add_to_linker_sync(&mut linker, |s: &mut State| &mut s.wasi)
        .map_err(|e| FsError::Message(format!("wasi linker: {e}")))?;

    let mut store = Store::new(&engine, state);
    store.limiter(|s| &mut s.limits);
    store
        .set_fuel(fuel)
        .map_err(|e| FsError::Message(format!("set_fuel: {e}")))?;
    store.set_epoch_deadline(1);
    store.epoch_deadline_trap();

    let engine_for_epoch = engine.clone();
    let cancel_for_epoch = cancel.clone();
    let deadline = Instant::now() + wall;
    let epoch_handle = thread::spawn(move || {
        while Instant::now() < deadline && !cancel_for_epoch.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(100));
            engine_for_epoch.increment_epoch();
        }
        engine_for_epoch.increment_epoch();
        engine_for_epoch.increment_epoch();
    });

    let module = Module::from_file(&engine, &wasm_path)
        .map_err(|e| FsError::Message(format!("load wasm: {e}")))?;
    let instance = linker
        .instantiate(&mut store, &module)
        .map_err(|e| FsError::Message(format!("instantiate: {e}")))?;

    let start = instance
        .get_typed_func::<(), ()>(&mut store, "_start")
        .map_err(|e| FsError::Message(format!("missing _start: {e}")))?;

    let call_result = start.call(&mut store, ());
    let timed_out = Instant::now() >= deadline || cancel.load(Ordering::SeqCst);
    cancel.store(true, Ordering::SeqCst);
    let _ = epoch_handle.join();

    let stdout = String::from_utf8_lossy(&stdout_pipe.contents()).to_string();
    let stderr = String::from_utf8_lossy(&stderr_pipe.contents()).to_string();
    emit_chunk(app, "stdout", &stdout);
    emit_chunk(app, "stderr", &stderr);

    match call_result {
        Ok(()) => Ok(SandboxResult {
            stdout,
            stderr,
            code: 0,
            timed_out: false,
            reason: "ok".into(),
            kind: "wasm".into(),
        }),
        Err(e) => {
            if let Some(exit) = e.downcast_ref::<I32Exit>() {
                return Ok(SandboxResult {
                    stdout,
                    stderr,
                    code: exit.0,
                    timed_out: false,
                    reason: "exit".into(),
                    kind: "wasm".into(),
                });
            }
            let msg = format!("{e:#}");
            let out_of_fuel = msg.contains("fuel") || msg.contains("all fuel");
            let epoch = msg.contains("epoch") || timed_out;
            let reason = if cancel.load(Ordering::SeqCst) && !epoch {
                "cancelled"
            } else if epoch {
                "timed out / epoch interrupt"
            } else if out_of_fuel {
                "out of fuel"
            } else {
                "trap"
            };
            Ok(SandboxResult {
                stdout,
                stderr: if stderr.is_empty() {
                    msg.clone()
                } else {
                    format!("{stderr}\n{msg}")
                },
                code: 1,
                timed_out: epoch || out_of_fuel,
                reason: reason.into(),
                kind: "wasm".into(),
            })
        }
    }
}

#[tauri::command]
pub async fn sandbox_run_limited(
    app: AppHandle,
    registry: State<'_, Arc<SandboxRegistry>>,
    args: SandboxLimitedArgs,
) -> Result<SandboxResult, FsError> {
    let cancel = begin_job(&registry)?;
    let reg = registry.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let out = run_limited_inner(&app, cancel, args);
        end_job(&reg);
        out
    })
    .await
    .map_err(|e| FsError::Message(format!("sandbox limited task failed: {e}")))?;
    result
}

fn run_limited_inner(
    app: &AppHandle,
    cancel: Arc<AtomicBool>,
    args: SandboxLimitedArgs,
) -> Result<SandboxResult, FsError> {
    let wall = Duration::from_secs(default_wall_secs(args.wall_seconds));
    let mem_mib = default_host_mem_mib(args.host_memory_mib);

    let workspace =
        ensure_inside_workspace(&args.workspace_path, Path::new(&args.workspace_path))?;
    let cwd = if let Some(c) = &args.cwd {
        ensure_inside_workspace(&args.workspace_path, Path::new(c))?
    } else {
        workspace.clone()
    };
    if !cwd.is_dir() {
        return Err(FsError::Message(format!("Invalid cwd: {}", cwd.display())));
    }
    if args.program.trim().is_empty() {
        return Err(FsError::Message("program is required".into()));
    }

    #[cfg(windows)]
    {
        return run_limited_windows(app, cancel, &args.program, &args.args, &cwd, wall, mem_mib);
    }

    #[cfg(not(windows))]
    {
        let _ = mem_mib;
        run_limited_unix(app, cancel, &args.program, &args.args, &cwd, wall)
    }
}

#[cfg(windows)]
fn run_limited_windows(
    app: &AppHandle,
    cancel: Arc<AtomicBool>,
    program: &str,
    args: &[String],
    cwd: &Path,
    wall: Duration,
    mem_mib: u64,
) -> Result<SandboxResult, FsError> {
    use windows_sys::Win32::Foundation::{HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };
    use windows_sys::Win32::System::Threading::WaitForSingleObject;

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(FsError::Message("CreateJobObjectW failed".into()));
        }
        let job_handle = OwnedHandle::from_raw_handle(job as RawHandle);

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY;
        let mem_bytes = (mem_mib as usize).saturating_mul(1024 * 1024);
        info.ProcessMemoryLimit = mem_bytes;
        info.JobMemoryLimit = mem_bytes;

        let ok = SetInformationJobObject(
            job_handle.as_raw_handle() as HANDLE,
            JobObjectExtendedLimitInformation,
            &mut info as *mut _ as *mut _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            return Err(FsError::Message("SetInformationJobObject failed".into()));
        }

        let mut cmd = Command::new(program);
        cmd.args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| FsError::Message(format!("spawn `{program}`: {e}")))?;

        let child_handle = child.as_raw_handle();
        let assigned = AssignProcessToJobObject(
            job_handle.as_raw_handle() as HANDLE,
            child_handle as HANDLE,
        );
        if assigned == 0 {
            let _ = child.kill();
            return Err(FsError::Message(
                "AssignProcessToJobObject failed".into(),
            ));
        }

        let start = Instant::now();
        let timeout_ms = wall.as_millis().min(u128::from(u32::MAX - 1)) as u32;
        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = TerminateJobObject(job_handle.as_raw_handle() as HANDLE, 1);
                let _ = child.kill();
                let (stdout, stderr) = read_child_pipes(&mut child);
                emit_chunk(app, "stdout", &stdout);
                emit_chunk(app, "stderr", &stderr);
                return Ok(SandboxResult {
                    stdout,
                    stderr,
                    code: 1,
                    timed_out: false,
                    reason: "cancelled".into(),
                    kind: "limited".into(),
                });
            }
            let remaining = wall.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                let _ = TerminateJobObject(job_handle.as_raw_handle() as HANDLE, 1);
                let _ = child.kill();
                let (stdout, stderr) = read_child_pipes(&mut child);
                emit_chunk(app, "stdout", &stdout);
                emit_chunk(app, "stderr", &stderr);
                return Ok(SandboxResult {
                    stdout,
                    stderr,
                    code: 1,
                    timed_out: true,
                    reason: "timed out".into(),
                    kind: "limited".into(),
                });
            }
            let slice = remaining.min(Duration::from_millis(200));
            let wait = WaitForSingleObject(child_handle as HANDLE, slice.as_millis() as u32);
            if wait == WAIT_OBJECT_0 {
                break;
            }
            if wait != WAIT_TIMEOUT {
                break;
            }
            let _ = timeout_ms;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| FsError::Message(format!("wait: {e}")))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        emit_chunk(app, "stdout", &stdout);
        emit_chunk(app, "stderr", &stderr);
        // Drop job_handle → KILL_ON_JOB_CLOSE cleans up any leftover children
        drop(job_handle);
        Ok(SandboxResult {
            stdout,
            stderr,
            code: output.status.code().unwrap_or(-1),
            timed_out: false,
            reason: "ok".into(),
            kind: "limited".into(),
        })
    }
}

#[cfg(windows)]
fn read_child_pipes(child: &mut std::process::Child) -> (String, String) {
    let stdout = child
        .stdout
        .take()
        .and_then(|mut s| {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut s, &mut buf);
            Some(String::from_utf8_lossy(&buf).to_string())
        })
        .unwrap_or_default();
    let stderr = child
        .stderr
        .take()
        .and_then(|mut s| {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut s, &mut buf);
            Some(String::from_utf8_lossy(&buf).to_string())
        })
        .unwrap_or_default();
    let _ = child.wait();
    (stdout, stderr)
}

#[cfg(not(windows))]
fn run_limited_unix(
    app: &AppHandle,
    cancel: Arc<AtomicBool>,
    program: &str,
    args: &[String],
    cwd: &Path,
    wall: Duration,
) -> Result<SandboxResult, FsError> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| FsError::Message(format!("spawn `{program}`: {e}")))?;

    let start = Instant::now();
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(SandboxResult {
                stdout: String::new(),
                stderr: String::new(),
                code: 1,
                timed_out: false,
                reason: "cancelled".into(),
                kind: "limited".into(),
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = std::io::Read::read_to_end(&mut out, &mut stdout);
                }
                if let Some(mut err) = child.stderr.take() {
                    let _ = std::io::Read::read_to_end(&mut err, &mut stderr);
                }
                let stdout = String::from_utf8_lossy(&stdout).to_string();
                let stderr = String::from_utf8_lossy(&stderr).to_string();
                emit_chunk(app, "stdout", &stdout);
                emit_chunk(app, "stderr", &stderr);
                return Ok(SandboxResult {
                    stdout,
                    stderr,
                    code: status.code().unwrap_or(-1),
                    timed_out: false,
                    reason: "ok".into(),
                    kind: "limited".into(),
                });
            }
            Ok(None) => {
                if start.elapsed() >= wall {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(SandboxResult {
                        stdout: String::new(),
                        stderr: String::new(),
                        code: 1,
                        timed_out: true,
                        reason: "timed out".into(),
                        kind: "limited".into(),
                    });
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(FsError::Message(format!("wait: {e}")));
            }
        }
    }
}
