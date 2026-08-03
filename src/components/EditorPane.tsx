import { useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useIdeStore } from "../stores/ideStore";
import TabBar from "./TabBar";
import Breadcrumbs from "./Breadcrumbs";
import DebugToolbar from "./DebugToolbar";
import { MONACO_THEME_ID, getLastAppliedTheme, subscribeTheme } from "../theme";
import type { AppliedTheme } from "../theme/applyTheme";
import { registerGhostTextProvider } from "../services/ghostTextProvider";
import { bindMonacoClipboard } from "../services/clipboard";

let monacoThemeReady = false;

function applyMonacoFromTheme(applied: AppliedTheme) {
  void loader.init().then((monaco) => {
    monaco.editor.defineTheme(
      MONACO_THEME_ID,
      applied.monaco as Parameters<typeof monaco.editor.defineTheme>[1],
    );
    monaco.editor.setTheme(MONACO_THEME_ID);
    monacoThemeReady = true;
  });
}

export default function EditorPane() {
  const tabs = useIdeStore((s) => s.tabs);
  const activePath = useIdeStore((s) => s.activePath);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const updateActiveContent = useIdeStore((s) => s.updateActiveContent);
  const saveActiveFile = useIdeStore((s) => s.saveActiveFile);
  const setMonacoEditor = useIdeStore((s) => s.setMonacoEditor);
  const openWorkspace = useIdeStore((s) => s.openWorkspace);
  const setCreateFileDialog = useIdeStore((s) => s.setCreateFileDialog);
  const setPaletteMode = useIdeStore((s) => s.setPaletteMode);
  const fontSize = useIdeStore((s) => s.settings.editorFontSize);
  const reloadActiveFromDisk = useIdeStore((s) => s.reloadActiveFromDisk);
  const revealRequest = useIdeStore((s) => s.revealRequest);
  const clearReveal = useIdeStore((s) => s.clearReveal);
  const monacoEditor = useIdeStore((s) => s.monacoEditor);
  const breakpoints = useIdeStore((s) => s.breakpoints);
  const toggleBreakpoint = useIdeStore((s) => s.toggleBreakpoint);
  const debugStoppedPath = useIdeStore((s) => s.debugStoppedPath);
  const debugStoppedLine = useIdeStore((s) => s.debugStoppedLine);
  const ghostDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const bpClickDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const monacoApiRef = useRef<typeof import("monaco-editor") | null>(null);

  const active = tabs.find((t) => t.path === activePath);

  useEffect(() => {
    return subscribeTheme((applied) => {
      applyMonacoFromTheme(applied);
    });
  }, []);

  useEffect(() => {
    return () => {
      ghostDisposableRef.current?.dispose();
      ghostDisposableRef.current = null;
      bpClickDisposableRef.current?.dispose();
      bpClickDisposableRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ed = monacoEditor as MonacoEditor.IStandaloneCodeEditor | null;
    const monaco = monacoApiRef.current;
    if (!ed || !monaco || !activePath) {
      if (ed) {
        decorationIdsRef.current = ed.deltaDecorations(decorationIdsRef.current, []);
      }
      return;
    }
    const lines = breakpoints[activePath] ?? [];
    const decs: MonacoEditor.IModelDeltaDecoration[] = lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: "pide-bp-glyph",
        glyphMarginHoverMessage: { value: "Breakpoint" },
      },
    }));
    const stoppedMatch =
      debugStoppedPath &&
      debugStoppedLine &&
      (debugStoppedPath === activePath ||
        debugStoppedPath.replace(/\\/g, "/").endsWith(activePath.replace(/\\/g, "/")) ||
        activePath.replace(/\\/g, "/").endsWith(debugStoppedPath.replace(/\\/g, "/")));
    if (stoppedMatch && debugStoppedLine) {
      decs.push({
        range: new monaco.Range(debugStoppedLine, 1, debugStoppedLine, 1),
        options: {
          isWholeLine: true,
          className: "pide-debug-line",
          glyphMarginClassName: "pide-debug-glyph",
        },
      });
    }
    decorationIdsRef.current = ed.deltaDecorations(decorationIdsRef.current, decs);
  }, [
    monacoEditor,
    activePath,
    breakpoints,
    debugStoppedPath,
    debugStoppedLine,
  ]);

  useEffect(() => {
    if (!revealRequest || !monacoEditor || activePath !== revealRequest.path) return;
    const editor = monacoEditor as {
      revealLineInCenter: (line: number) => void;
      setPosition: (pos: { lineNumber: number; column: number }) => void;
      focus: () => void;
    };
    editor.revealLineInCenter(revealRequest.line);
    editor.setPosition({
      lineNumber: revealRequest.line,
      column: revealRequest.column,
    });
    editor.focus();
    clearReveal();
  }, [revealRequest, monacoEditor, activePath, clearReveal]);

  return (
    <div className="h-full flex flex-col min-w-0 bg-pide-editor text-pide-editor-fg">
      <TabBar />
      <Breadcrumbs />
      {workspacePath ? <DebugToolbar /> : null}
      {!workspacePath ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6 pide-fade-in">
            <h1 className="text-4xl font-semibold tracking-tight text-pide-fg mb-2">
              PIDE
            </h1>
            <p className="text-pide-muted text-sm mb-6 leading-relaxed">
              Local-first IDE for Ollama. Open a folder to start editing, then chat with your
              models on the right.
            </p>
            <button
              type="button"
              onClick={() => void openWorkspace()}
              className="px-4 py-2 rounded bg-pide-button hover:bg-pide-button-hover text-pide-button-fg text-sm transition-colors duration-150"
            >
              Open Folder
            </button>
            <p className="mt-6 text-xs text-pide-muted opacity-70">
              Ctrl+P Quick Open · Ctrl+Shift+P Commands · Ctrl+L Chat · Ctrl+` Terminal
            </p>
          </div>
        </div>
      ) : !active ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6 pide-fade-in">
            <h2 className="text-xl font-medium text-pide-fg mb-2">Workspace ready</h2>
            <p className="text-pide-muted text-sm mb-6 leading-relaxed">
              Open a file from the explorer, create a new one, or use Quick Open.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                type="button"
                onClick={() =>
                  setCreateFileDialog({
                    parentDir: workspacePath,
                    initialName: "untitled.txt",
                    content: "",
                  })
                }
                className="px-3 py-1.5 rounded bg-pide-button hover:bg-pide-button-hover text-pide-button-fg text-sm transition-colors duration-150"
              >
                New File
              </button>
              <button
                type="button"
                onClick={() => setPaletteMode("quickOpen")}
                className="px-3 py-1.5 rounded bg-[var(--pide-button-secondaryBackground)] hover:bg-pide-list-hover text-[var(--pide-button-secondaryForeground)] text-sm transition-colors duration-150"
              >
                Quick Open (Ctrl+P)
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="h-8 px-3 flex items-center justify-between border-b border-pide-sidebar-border text-xs text-pide-muted bg-pide-editor">
            <span className="truncate" title={active.path}>
              {active.path}
            </span>
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void reloadActiveFromDisk()}
                className="px-2 py-0.5 rounded bg-[var(--pide-button-secondaryBackground)] hover:bg-pide-list-hover text-pide-fg transition-colors duration-150"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={() => void saveActiveFile()}
                className="px-2 py-0.5 rounded bg-[var(--pide-button-secondaryBackground)] hover:bg-pide-list-hover text-pide-fg transition-colors duration-150"
              >
                Save{active.dirty ? " *" : ""}
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              theme={monacoThemeReady ? MONACO_THEME_ID : "vs-dark"}
              path={active.path}
              language={active.language}
              value={active.content}
              onChange={(v) => updateActiveContent(v ?? "")}
              onMount={(editor, monaco) => {
                setMonacoEditor(editor);
                monacoApiRef.current = monaco;
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                  void saveActiveFile();
                });
                bindMonacoClipboard(editor, monaco);
                const last = getLastAppliedTheme();
                if (last) {
                  monaco.editor.defineTheme(
                    MONACO_THEME_ID,
                    last.monaco as Parameters<typeof monaco.editor.defineTheme>[1],
                  );
                  monaco.editor.setTheme(MONACO_THEME_ID);
                  monacoThemeReady = true;
                }
                ghostDisposableRef.current?.dispose();
                ghostDisposableRef.current = registerGhostTextProvider(monaco, () => ({
                  settings: useIdeStore.getState().settings,
                  activePath: useIdeStore.getState().activePath,
                }));
                bpClickDisposableRef.current?.dispose();
                bpClickDisposableRef.current = editor.onMouseDown((e) => {
                  if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                    return;
                  }
                  const line = e.target.position?.lineNumber;
                  const path = useIdeStore.getState().activePath;
                  if (line && path) toggleBreakpoint(path, line);
                });
              }}
              options={{
                fontSize,
                fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
                minimap: { enabled: true },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
                renderWhitespace: "selection",
                smoothScrolling: true,
                cursorBlinking: "smooth",
                find: { addExtraSpaceOnTop: false },
                formatOnPaste: true,
                inlineSuggest: { enabled: true },
                glyphMargin: true,
                lineNumbersMinChars: 3,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
