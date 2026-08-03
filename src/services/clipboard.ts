/** Native clipboard via Tauri plugin, with web clipboard fallback. */

export async function clipboardWrite(text: string): Promise<void> {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  } catch {
    /* fall through */
  }
  await navigator.clipboard.writeText(text);
}

export async function clipboardRead(): Promise<string> {
  try {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  } catch {
    /* fall through */
  }
  return navigator.clipboard.readText();
}

type MonacoNs = typeof import("monaco-editor");
type CodeEditor = import("monaco-editor").editor.IStandaloneCodeEditor;

/** Wire Cut/Copy/Paste for Monaco (Tauri webview-safe). */
export function bindMonacoClipboard(editor: CodeEditor, monaco: MonacoNs): void {
  const copySel = async () => {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel) return;
    if (sel.isEmpty()) {
      const line = model.getLineContent(sel.startLineNumber);
      await clipboardWrite(line + model.getEOL());
      return;
    }
    await clipboardWrite(model.getValueInRange(sel));
  };

  const cutSel = async () => {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel) return;
    if (sel.isEmpty()) {
      const lineNumber = sel.startLineNumber;
      const maxCol = model.getLineMaxColumn(lineNumber);
      const range =
        lineNumber < model.getLineCount()
          ? new monaco.Range(lineNumber, 1, lineNumber + 1, 1)
          : new monaco.Range(lineNumber, 1, lineNumber, maxCol);
      await clipboardWrite(model.getValueInRange(range));
      editor.executeEdits("pide-cut", [{ range, text: "" }]);
      return;
    }
    await clipboardWrite(model.getValueInRange(sel));
    editor.executeEdits("pide-cut", [{ range: sel, text: "" }]);
  };

  const pasteAt = async () => {
    let text = "";
    try {
      text = await clipboardRead();
    } catch {
      return;
    }
    if (!text) return;
    const sel = editor.getSelection();
    const pos = editor.getPosition();
    if (!sel && !pos) return;
    const range = sel
      ? sel
      : new monaco.Range(pos!.lineNumber, pos!.column, pos!.lineNumber, pos!.column);
    editor.focus();
    editor.executeEdits("pide-paste", [{ range, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
  };

  editor.addAction({
    id: "pide.clipboard.copy",
    label: "Copy",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
    contextMenuGroupId: "9_cutcopypaste",
    contextMenuOrder: 1.1,
    run: () => void copySel(),
  });
  editor.addAction({
    id: "pide.clipboard.cut",
    label: "Cut",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX],
    contextMenuGroupId: "9_cutcopypaste",
    contextMenuOrder: 1.05,
    run: () => void cutSel(),
  });
  editor.addAction({
    id: "pide.clipboard.paste",
    label: "Paste",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV],
    contextMenuGroupId: "9_cutcopypaste",
    contextMenuOrder: 1.2,
    run: () => void pasteAt(),
  });
}
