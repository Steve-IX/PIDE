# PIDE — Local LLM IDE

**PIDE** is a cross-platform, local-first desktop IDE built around [Ollama](https://ollama.com). Edit code in Monaco, chat with local models, search the workspace, commit with Git, and sync to GitHub — all without sending your code to a cloud LLM.

Inspired by VS Code / Cursor layouts; not affiliated with either product.

[![Repo](https://img.shields.io/badge/github-Steve--IX%2FPIDE-181717?logo=github)](https://github.com/Steve-IX/PIDE)

---

## Highlights

| Area | What you get |
|------|----------------|
| **Workbench** | Explorer, editor tabs, breadcrumbs, resizable panes, status bar, toasts |
| **AI chat** | Modes (Agent · Plan · Debug · Multitask · Ask), Auto model routing, `@file` mentions, apply proposals |
| **Models** | Enable/disable installed Ollama models; assign Router / Planner / Worker roles |
| **Editor** | Monaco with find, language detection, create/apply/diff flows |
| **Search** | Workspace find (`Ctrl+Shift+F`) with jump-to-line |
| **Git** | Status, diff, stage, commit, Fetch / Pull / Push / Sync |
| **GitHub** | Device Flow or PAT; tokens in OS keyring |
| **Themes** | Dark / Light / High Contrast + import VS Code color themes |
| **Terminal** | Integrated xterm.js panel |
| **Privacy** | Local Ollama only; paths sandboxed to the open folder |

---

## Stack

- **Shell:** [Tauri 2](https://v2.tauri.app/) (Rust)
- **UI:** React 19 + TypeScript + Vite + Tailwind CSS 4
- **Editor:** Monaco
- **Terminal:** xterm.js
- **State:** Zustand
- **LLM:** Ollama HTTP API (streaming chat)

---

## Prerequisites

- [Node.js](https://nodejs.org/) **20+**
- [Rust](https://rustup.rs/) (stable)
- **WebView2** (Windows)
- [Ollama](https://ollama.com/) installed and running (`ollama serve`)
- **Git** on `PATH` (Source Control + sync)

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

- Search / refresh installed Ollama models
- Per-model enable toggles (disabled models stay out of the picker)
- Role assignments: **Router**, **Explore**, **Planner**, **Worker**
- Speed profile: Fast / Balanced / Quality (`num_ctx`, history window, reply length)

Missing preferred models fall back to whatever is installed (e.g. only `dolphin-llama3:8b` still works).

### Local speed (laptop-friendly)

- Warm selected models with `keep_alive` so the next chat avoids a cold load
- Trim chat history and large file attachments
- Prefer patches/snippets over full-file rewrites
- Batched stream UI (~32ms) to keep React smooth

Use **Fast** for short Q&A; **Quality** for harder refactors. Check `ollama ps` to confirm the model is on GPU.

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
- Bottom panel: Terminal, Output, Problems stub

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

## Hardware notes (16GB RAM / Iris Xe)

| Spec | Guidance |
|------|----------|
| ~16GB RAM + shared ~2GB GPU | **Never** run two LLMs concurrently — Auto is sequential |
| Prefer Q4 / ≤8B | Skip 14B+ on this class of machine |
| Keep prompts tight | Use Fast/Balanced profiles; attach only needed `@file`s |

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

---

## Notes

- Paths are sandboxed to the open workspace.
- HTTPS remotes only (no SSH key UI yet).
- Motion respects `prefers-reduced-motion`.
- Tokens and secrets stay out of git (see `.gitignore` for `.env`).

## License

Private / unpublished terms unless a `LICENSE` file is added. Copyright © Steve-IX contributors.
