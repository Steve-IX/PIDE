# PIDE — Local LLM IDE

**PIDE** is a cross-platform, local-first desktop IDE built around [Ollama](https://ollama.com). Edit code in Monaco, chat with local models, search the workspace, commit with Git, and sync to GitHub — all without sending your code to a cloud LLM.

Inspired by VS Code / Cursor layouts; not affiliated with either product.

[![Repo](https://img.shields.io/badge/github-Steve--IX%2FPIDE-181717?logo=github)](https://github.com/Steve-IX/PIDE)

---

## Highlights

| Area | What you get |
|------|----------------|
| **Workbench** | Explorer, editor tabs, breadcrumbs, resizable panes, status bar, toasts |
| **AI chat** | Modes, Auto routing, `@file`, apply proposals, **tok/s badge** per reply |
| **Models** | Enable toggles, role assignment, **Hyper-Speed**, **Speed Lab** |
| **Editor** | Monaco with find, language detection, **FIM ghost text** (llama.cpp), create/apply/diff |
| **Search** | Workspace find (`Ctrl+Shift+F`) with jump-to-line |
| **Git** | Status, diff, stage, commit, Fetch / Pull / Push / Sync |
| **GitHub** | Device Flow or PAT; tokens in OS keyring |
| **Themes** | Dark / Light / High Contrast + import VS Code color themes |
| **Terminal** | Interactive xterm.js + ConPTY (`portable-pty`); Run Current File |
| **Privacy** | Local Ollama only; paths sandboxed to the open folder |

---

## Stack

- **Shell:** [Tauri 2](https://v2.tauri.app/) (Rust)
- **UI:** React 19 + TypeScript + Vite + Tailwind CSS 4
- **Editor:** Monaco
- **Terminal:** xterm.js
- **State:** Zustand
- **LLM:** Ollama HTTP API (streaming chat) + optional llama.cpp server

---

## Prerequisites

- [Node.js](https://nodejs.org/) **20+**
- [Rust](https://rustup.rs/) (stable)
- **WebView2** (Windows)
- [Ollama](https://ollama.com/) installed and running (`ollama serve`)
- **Git** on `PATH` (Source Control + sync)
- Optional: [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` for n-gram speculative decoding

---

## Quick start

```powershell
# 1. Start Ollama
ollama serve

# 2. Recommended agent fleet (fits ~16GB RAM + Iris Xe)
ollama pull qwen2.5-coder:1.5b   # Router / Explore (fast)
ollama pull qwen2.5-coder:7b    # Coder / Worker
ollama pull llama3.1:8b         # Plan / Debug reasoning
# optional: ollama pull dolphin-llama3:8b

# 3. Run PIDE
git clone https://github.com/Steve-IX/PIDE.git
cd PIDE
npm install
npm run tauri:dev
```

> File I/O and native dialogs require the Tauri shell (`npm run tauri:dev`). Browser-only Vite is not enough for a full workspace.

---

## Features

### AI chat & Auto routing

Cursor-style composer with a **Mode pill** and **Model pill**:

| Mode | Behavior |
|------|----------|
| **Agent** | Coding-focused assistant; Auto routes to coder or planner |
| **Plan** | Structured markdown checklists (planner model) |
| **Debug** | Diagnose + minimal fix (reasoner model) |
| **Multitask** | Planner emits JSON subtasks → worker runs them **one after another** with progress |
| **Ask** | Single-shot Q&A |

**Auto** (default): a tiny router model classifies intent (`code` \| `plan` \| `debug` \| `ask`), then Ollama swaps to the specialist. On machines with shared GPU memory (e.g. Intel Iris Xe), PIDE never loads two LLMs at once — orchestration is sequential.

Turn Auto off to pin any **enabled** model from the Models pane.

### Models pane

Activity bar → **Models**:

- Search / refresh installed models
- Per-model enable toggles (disabled models stay out of the picker)
- Role assignments: **Router**, **Explore**, **Planner**, **Worker**
- Speed profile: Fast / Balanced / Quality
- **Hyper-Speed** toggle (tight context, GPU offload, prefer 1.5B)
- **Speed Lab** — warm + fixed coding prompt; reports real tok/s

Missing preferred models fall back to whatever is installed (e.g. only `dolphin-llama3:8b` still works).

### Hyper-Speed & tok/s (Sprint 8)

**tok/s formula** (Ollama final stream chunk):

```text
tok/s = eval_count / (eval_duration_ns / 1e9)
```

Each completed assistant message shows a pill (e.g. `52.3 tok/s`). Status bar shows the last reading.

| Setting | Effect |
|---------|--------|
| **Hyper-Speed** | Caps `num_ctx` (~2048), history (~6), attach (~4k); raises `num_batch` / `num_gpu`; Auto prefers **1.5B** for Ask / Agent |
| **Speed Lab** | Benchmark selected model against a fixed FizzBuzz prompt |
| **llama.cpp backend** | Optional `llama-server` with **ngram** speculation (Ollama API cannot enable this) |

**Target:** warm `qwen2.5-coder:1.5b` + Hyper-Speed ≥ **40 tok/s** on Speed Lab (Iris Xe / 16GB). 7B/8B show real metrics; cloud 40–70 is not guaranteed on iGPU.

#### llama.cpp sidecar (Sprint 8–9)

Ollama does not expose [llama.cpp speculative](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) flags. Use a local `llama-server` for **ngram-mod** (no second draft model) and **KV cache Q8_0** (roughly half the KV RAM vs F16).

**Managed (recommended):** Models / Settings → enable **Manage llama-server** → pick `llama-server.exe` + `.gguf` → **Start**. PIDE owns PID, polls `/health`, and can **stop on minimize** (frees RAM) then restart on restore.

**Manual:**

```powershell
llama-server -m qwen2.5-coder-1.5b.gguf -ngl 99 -c 2048 -fa on `
  --host 127.0.0.1 --port 8080 `
  --cache-type-k q8_0 --cache-type-v q8_0 `
  --spec-type ngram-mod --spec-draft-n-max 64
```

Then set **Inference backend → llama.cpp**, URL `http://127.0.0.1:8080`.

Still **one** model loaded — never dual-model speculative on Iris Xe.

#### Intel SYCL build (optional, outside PIDE)

For more throughput on Iris Xe, compile llama.cpp with Intel oneAPI / SYCL and Level Zero host-memory bypass, then point PIDE’s binary path at that build:

```text
GGML_SYCL=ON
GGML_SYCL_USE_LEVEL_ZERO_API=1
```

PIDE does not install oneAPI; it only launches the binary you provide.

#### Ghost text (Sprint 10)

Optimistic inline completions in Monaco when **Inference backend = llama.cpp**:

- Frontend `web-tree-sitter` trims the active scope (JS/TS/Python/Rust) + imports; other languages use a line-window fallback
- FIM prompt uses Qwen tokens (`<|fim_prefix|>` / `<|fim_suffix|>` / `<|fim_middle|>`) against `llama-server` `POST /completion`
- Monaco `CancellationToken` → `AbortController` so typing aborts stale requests
- Toggle + debounce under Models / Settings (llama-server controls). **Tab** accepts ghost text

WASM assets live in `public/tree-sitter/` (not bundled into JS). Refresh after upgrading deps:

```powershell
npm run refresh:tree-sitter
```

#### Deferred (AI infra)

- Full LSP language servers  
- [OpenVINO GenAI](https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/ai-pc.html) / IR conversion pipeline  
- Bundling a prebuilt `llama-server` in the installer  

### Local speed (laptop-friendly)

- Warm selected models with `keep_alive` so the next chat avoids a cold load
- Trim chat history and large file attachments
- Prefer patches/snippets over full-file rewrites
- Batched stream UI (~32ms) to keep React smooth
- Hyper-Speed + Speed Lab for measurable throughput

Use **Fast** / **Hyper-Speed** for short Q&A; **Quality** for harder refactors. Check `ollama ps` to confirm the model is on GPU.

### Themes

| Id | Name |
|----|------|
| `pide-dark` | PIDE Dark (default) |
| `pide-light` | PIDE Light |
| `pide-hc` | PIDE High Contrast |

**Settings → Appearance** for theme, UI font size, density, quick color overrides, or full VS Code–style JSON. Import a theme file via **Import theme JSON…**. Shortcut: `Ctrl+Shift+T`.

Workbench keys follow [VS Code Theme Color](https://code.visualstudio.com/api/references/theme-color) naming.

### GitHub Auth + Sync

1. Create a GitHub **OAuth App** with **Device Flow** enabled (no client secret needed for public native apps).
2. Paste the **Client ID** into **Settings → GitHub OAuth Client ID**.
3. Or use a **PAT** with `repo` scope — stored in the OS keyring (never in the repo or plain `localStorage`).

In Source Control (open folder + remote + signed in): **Fetch**, **Pull** (`--ff-only`), **Push**, **Sync**. Status shows ahead/behind (e.g. `main ↔ origin/main ↑2 ↓1`). HTTPS remotes only.

Scopes: `repo`, `read:user`, `user:email`.

### Workspace tooling

- File create / rename / delete, dirty confirms
- Multi-file apply proposals from path-labeled chat fences
- Persistent chat sessions per workspace (`localStorage`)
- Command palette & Quick Open
- Bottom panel: **interactive ConPTY terminal** (multi-session), Output, Problems (compiler + git/search)
- **Run Current File** (`Ctrl+F5`) and **Tasks** (`Ctrl+Shift+B` / tasks.json) — runners and builds via the live shell; compilers on `PATH`
- **Debug** (`F5` / DAP) — multi-language `launch.json`; Python/Go/lldb on PATH; Ctrl+F5 runs many languages
- **Sandbox** — Wasmtime WASI for `.wasm`; limited host spawn (Job Objects + wall timeout)
#### Terminal & run (Sprint 11–12)

PIDE no longer uses a one-shot fake REPL. The Terminal tab spawns real PowerShell/pwsh sessions via [portable-pty](https://docs.rs/portable-pty/) (Windows ConPTY) and streams I/O to [xterm.js](https://xtermjs.org/docs/). Multiple sessions (up to 4) appear as tabs under Terminal; **+** opens another shell.

**Run File** (`Ctrl+F5`) maps the active editor language to a host command and writes it into the live PTY.

**Tasks (Sprint 12):** Load and merge `.vscode/tasks.json` and `.pide/tasks.json` (same label → `.pide` wins). Subset: `label`, `type` (`shell`|`process`), `command`, `args`, `options.cwd`, `group` / default build, optional `problemMatcher` (`$tsc`, `$rustc`, `$gcc`).

- **Tasks: Run Build Task** — `Ctrl+Shift+B`
- Command Palette lists each loaded task
- Task output is parsed into **Problems** (tsc / rustc / gcc patterns); click jumps to file:line

Example `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build",
      "type": "shell",
      "command": "npm run build",
      "group": { "kind": "build", "isDefault": true },
      "problemMatcher": ["$tsc"]
    }
  ]
}
```

#### Debug (Sprint 13)

DAP client runs in Rust over stdio (same process pattern as the PTY). Adapters are **not** bundled — use host tools.

1. Install language adapters on PATH as needed (`pip install debugpy`, Delve `dlv`, LLVM `lldb-dap`, …).
2. Open a folder — PIDE creates or **merges** `.vscode/launch.json` with configs for Python, Node/TS, Go, Rust/C/C++ (lldb), Java, Ruby, PHP, and PowerShell. Your existing entries are kept; only missing `name`s are added. `.pide/launch.json` still wins on the same `name`.
3. **F5** picks a config matching the active file when possible. **Ctrl+F5** runs without a debugger via language runners (Python, Node, TS, Rust, Go, C/C++, Java, Ruby, PHP, Lua, Perl, R, Julia, Kotlin, Zig, Dart, …).

Example (full seed includes many languages):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: current file",
      "type": "python",
      "request": "launch",
      "program": "${file}",
      "stopOnEntry": false
    }
  ]
}
```

Note: `${file}` and `${workspaceFolder}` are expanded; other VS Code variables are passed through as-is.

4. Click the editor **glyph margin** to set breakpoints, then press **F5** (or **Debug: Start** in the palette).
5. Continue / Step / Stop live in the debug toolbar; stack and variables appear in the bottom **Debug** tab. Adapter `output` events go to **Output**.

**Custom adapters** (js-debug, Java, PHP, netcoredbg, …): set `debugAdapterExecutable` and optional `debugAdapterArgs`. Missing adapters show a toast with a run-without-debug hint (no crash).

#### Sandbox (Sprint 14)

PIDE embeds [Wasmtime](https://docs.wasmtime.dev/) for **WASI Preview 1** guests and runs one-shot host commands under resource limits. Interactive **Run File** / PTY / tasks are unchanged (unlimited host shell).

**Wasmtime (.wasm):**
1. Place a WASI `.wasm` in the workspace (build with e.g. `cargo build --target wasm32-wasip1` or see the [Wasmtime book](https://docs.wasmtime.dev/)).
2. Open the `.wasm` in the explorer (editor shows a placeholder; bytes are not loaded).
3. **Sandbox: Run Current Wasm** (Command Palette) — stdout/stderr stream to **Output**. Limits: wall clock, fuel, memory (Settings → Sandbox).
4. **Sandbox: Cancel** interrupts the guest via epoch trap.

Python/JS and other host languages still use **Ctrl+F5** / DAP — not Wasmtime.

**Limited host spawn:** `sandbox_run_limited` (argv only) jails `cwd` to the workspace and applies Windows **Job Objects** (memory + kill-on-close) with a wall timeout. Used via store `runLimitedCommand` for future agent-proposed runs.

#### Deferred (run stack roadmap)

- [Firecracker](https://github.com/firecracker-microvm/firecracker) microVMs — Linux/KVM only (not Windows desktop)
- Full LSP language servers
- OpenVINO GenAI / IR conversion pipeline
- Bundling a prebuilt `llama-server` in the installer

---

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save |
| `Ctrl+L` | Toggle chat |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+P` | Quick Open |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+Shift+T` | Color Theme |
| `Ctrl+Shift+F` | Find in Files |
| `Ctrl+\`` | Toggle terminal |
| `F5` | Start Debugging |
| `Ctrl+F5` | Run Current File (no debugger) |
| `Ctrl+Shift+B` | Run Build Task |
| `Ctrl+F` | Find in editor (Monaco) |
| `Ctrl+I` | Focus Agent mode |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run tauri:dev` | Full desktop app (recommended) |
| `npm run tauri:build` | Production binary |
| `npm run build` | Frontend only (`tsc` + Vite) |
| `npm run dev` | Vite only (no native FS) |

---

## Project layout

```
PIDE/
├── src/                 # React UI, services, theme tokens
│   ├── components/      # Workbench panes + chat composer
│   ├── services/        # Ollama, agent router, git, FS, search
│   ├── theme/           # Built-in themes + applyTheme
│   └── stores/          # Zustand IDE store
├── src-tauri/           # Tauri 2 + Rust (FS, GitHub keyring helpers)
├── package.json
└── README.md
```

---

## Roadmap (done so far)

1. **Core IDE** — explorer, Monaco, chat, palette, settings  
2. **Gaps** — CRUD, diff apply, terminal, toasts  
3. **Parity** — search, SCM, `@file`, multi-apply, sessions  
4. **GitHub** — Device Flow / PAT + Fetch/Pull/Push/Sync  
5. **Theming** — VS Code–compatible tokens, import, HC  
6. **LLM speed** — profiles, warmup, trim, batched stream  
7. **Multi-agent UI** — modes, Auto routing, Models pane, Multitask  
8. **Hyper-Speed** — tok/s telemetry, Speed Lab, Hyper-Speed mode, optional llama.cpp ngram  
9. **Sidecar supervisor** — managed llama-server spawn/stop, KV Q8_0, suspend on minimize  
10. **Ghost text** — WASM Tree-sitter + Qwen FIM inline completions  
11. **Interactive terminal + Run File** — ConPTY/`portable-pty`, language runners via PATH  
12. **Tasks & Problems** — tasks.json, multi-terminal, compiler diagnostic parsing  

---

## Hardware notes (16GB RAM / Iris Xe)

| Spec | Guidance |
|------|----------|
| ~16GB RAM + shared ~2GB GPU | **Never** run two LLMs concurrently — Auto is sequential |
| Prefer Q4 / ≤8B | Skip 14B+ on this class of machine |
| Keep prompts tight | Use Fast / **Hyper-Speed**; attach only needed `@file`s |
| Throughput target | Warm **1.5B** + Hyper-Speed ≥ **40 tok/s** (Speed Lab) **with GPU** |

### Getting off 100% CPU (required for 40+ tok/s)

If `ollama ps` shows `PROCESSOR 100% CPU`, the iGPU is unused and Speed Lab will often land ~10–20 tok/s. Enable experimental Vulkan for Intel iGPU:

1. Set user environment variables (Windows → Environment Variables):
   - `OLLAMA_VULKAN=1`
   - `GGML_VK_DISABLE_INTEGER_DOT_PRODUCT=1` (avoids known Iris Xe gibberish — see [ollama#13086](https://github.com/ollama/ollama/issues/13086))
2. Fully quit Ollama from the tray and relaunch.
3. Chat once, then check `ollama ps` — you want GPU percentage, not 100% CPU.
4. Models → **Hyper-Speed** on → **Speed Lab** on `qwen2.5-coder:1.5b`.

Ollama version should be recent enough to ship Vulkan binaries (0.12.11+). See [Ollama Windows docs](https://docs.ollama.com/windows) and [Vulkan iGPU notes](https://github.com/ollama/ollama/issues/13023).

---

## Notes

- Paths are sandboxed to the open workspace.
- HTTPS remotes only (no SSH key UI yet).
- Motion respects `prefers-reduced-motion`.
- Tokens and secrets stay out of git (see `.gitignore` for `.env`).

## License

Private / unpublished terms unless a `LICENSE` file is added. Copyright © Steve-IX contributors.
