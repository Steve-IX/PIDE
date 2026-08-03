import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2,
  Pencil,
} from "lucide-react";
import type { FileNode } from "../types";
import { useIdeStore } from "../stores/ideStore";
import { fileName } from "../services/fs";
import ViewHeader from "./ui/ViewHeader";
import IconButton from "./ui/IconButton";

function fileIcon(name: string) {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (ext === "py" || ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "rs") {
    return FileCode2;
  }
  return FileText;
}

function TreeNode({
  node,
  depth,
  renamingPath,
  renameValue,
  onRenameValue,
  onCommitRename,
  onCancelRename,
  onOpen,
  onContext,
  onStartRename,
}: {
  node: FileNode;
  depth: number;
  renamingPath: string | null;
  renameValue: string;
  onRenameValue: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpen: (path: string) => void;
  onContext: (e: React.MouseEvent, node: FileNode) => void;
  onStartRename: (node: FileNode) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const activePath = useIdeStore((s) => s.activePath);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renaming = renamingPath === node.path;

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const pad = 8 + depth * 12;

  if (renaming) {
    return (
      <div className="px-1 py-0.5" style={{ paddingLeft: pad }}>
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => onRenameValue(e.target.value)}
          onBlur={() => onCommitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancelRename();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-pide-input border border-pide-focus rounded px-1.5 py-0.5 text-[13px]
            text-pide-input-fg outline-none"
        />
      </div>
    );
  }

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          className="w-full text-left py-1 pr-2 flex items-center gap-1.5 text-[13px] text-pide-sidebar-fg
            hover:bg-pide-list-hover rounded-sm transition-colors duration-150 group"
          style={{ paddingLeft: pad }}
          onClick={() => setOpen((v) => !v)}
          onContextMenu={(e) => onContext(e, node)}
          onDoubleClick={() => onStartRename(node)}
        >
          {open ? (
            <ChevronDown size={14} className="shrink-0 text-pide-muted" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-pide-muted" />
          )}
          <Folder size={14} className="shrink-0 text-[var(--pide-symbolIcon-folderForeground,#dcb67a)]" />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {open &&
          (node.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameValue={onRenameValue}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onOpen={onOpen}
              onContext={onContext}
              onStartRename={onStartRename}
            />
          ))}
      </div>
    );
  }

  const active = activePath === node.path;
  const Icon = fileIcon(node.name);
  return (
    <button
      type="button"
      className={`w-full text-left py-1 pr-2 flex items-center gap-1.5 text-[13px] truncate rounded-sm transition-colors duration-150 ${
        active
          ? "bg-pide-list-active text-pide-fg"
          : "text-pide-muted hover:bg-pide-list-hover hover:text-pide-fg"
      }`}
      style={{ paddingLeft: pad + 14 }}
      onClick={() => onOpen(node.path)}
      onContextMenu={(e) => onContext(e, node)}
      onDoubleClick={() => onStartRename(node)}
      title={node.path}
    >
      <Icon size={14} className="shrink-0 opacity-80" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

interface MenuState {
  x: number;
  y: number;
  node: FileNode | null;
}

export default function ExplorerPane() {
  const tree = useIdeStore((s) => s.tree);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const openWorkspace = useIdeStore((s) => s.openWorkspace);
  const refreshTree = useIdeStore((s) => s.refreshTree);
  const openFile = useIdeStore((s) => s.openFile);
  const setCreateFileDialog = useIdeStore((s) => s.setCreateFileDialog);
  const createNewFolder = useIdeStore((s) => s.createNewFolder);
  const renameEntry = useIdeStore((s) => s.renameEntry);
  const deleteEntry = useIdeStore((s) => s.deleteEntry);
  const requestPrompt = useIdeStore((s) => s.requestPrompt);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameOriginal = useRef("");

  function parentForNew(node: FileNode | null): string {
    if (!node) return workspacePath;
    return node.isDir ? node.path : node.path.replace(/[/\\][^/\\]+$/, "") || workspacePath;
  }

  function onContext(e: React.MouseEvent, node: FileNode | null) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  }

  function closeMenu() {
    setMenu(null);
    setMenuPos(null);
  }

  useLayoutEffect(() => {
    if (!menu) return;
    const w = 200;
    const h = 200;
    const left = Math.min(menu.x, window.innerWidth - w - 8);
    const top = Math.min(menu.y, window.innerHeight - h - 8);
    setMenuPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function startRename(node: FileNode) {
    if (node.path === workspacePath) return;
    renameOriginal.current = fileName(node.path);
    setRenameValue(fileName(node.path));
    setRenamingPath(node.path);
    closeMenu();
  }

  async function commitRename() {
    if (!renamingPath) return;
    const next = renameValue.trim();
    const path = renamingPath;
    setRenamingPath(null);
    if (!next || next === renameOriginal.current) return;
    await renameEntry(path, next);
  }

  async function askNewFolder(parentDir: string) {
    const name = await requestPrompt({
      title: "New folder",
      message: "Enter a folder name",
      placeholder: "folder-name",
      confirmLabel: "Create",
    });
    if (name) await createNewFolder(parentDir, name);
  }

  return (
    <div className="h-full flex flex-col bg-pide-sidebar" onClick={closeMenu}>
      <ViewHeader
        title="Explorer"
        actions={
          <>
            <IconButton
              title="New File"
              disabled={!workspacePath}
              onClick={() =>
                setCreateFileDialog({
                  parentDir: workspacePath,
                  initialName: "untitled.txt",
                  content: "",
                })
              }
            >
              <FilePlus size={14} />
            </IconButton>
            <IconButton
              title="New Folder"
              disabled={!workspacePath}
              onClick={() => void askNewFolder(workspacePath)}
            >
              <FolderPlus size={14} />
            </IconButton>
            <IconButton title="Open Folder" onClick={() => void openWorkspace()}>
              <FolderOpen size={14} />
            </IconButton>
            {workspacePath ? (
              <IconButton title="Refresh" onClick={() => void refreshTree()}>
                <RefreshCw size={14} />
              </IconButton>
            ) : null}
          </>
        }
      />

      <div
        className="flex-1 overflow-auto py-1"
        onContextMenu={(e) => onContext(e, tree)}
      >
        {!tree ? (
          <div className="px-4 py-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-pide-list-hover flex items-center justify-center">
              <FolderOpen size={22} className="text-pide-muted" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-pide-fg">No folder open</p>
              <p className="text-xs text-pide-muted leading-relaxed">
                Open a workspace to browse and edit files.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void openWorkspace()}
              className="px-4 py-2 rounded-lg bg-pide-button hover:bg-pide-button-hover text-pide-button-fg text-sm
                font-medium transition-colors duration-150"
            >
              Open Folder
            </button>
          </div>
        ) : (
          <>
            <div
              className="mx-2 mb-1 px-2 py-1.5 rounded-md bg-black/15 border border-transparent
                text-[11px] font-semibold tracking-wide text-pide-muted truncate"
              title={workspacePath}
            >
              {tree.name.toUpperCase()}
            </div>
            {(tree.children ?? []).length === 0 && (
              <div className="px-4 py-6 text-center space-y-3">
                <p className="text-xs text-pide-muted">This folder is empty.</p>
                <button
                  type="button"
                  className="text-sm text-pide-link hover:opacity-90 transition-colors duration-150"
                  onClick={() =>
                    setCreateFileDialog({
                      parentDir: workspacePath,
                      initialName: "untitled.txt",
                      content: "",
                    })
                  }
                >
                  New File…
                </button>
              </div>
            )}
            {(tree.children ?? []).map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={0}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onRenameValue={setRenameValue}
                onCommitRename={() => void commitRename()}
                onCancelRename={() => setRenamingPath(null)}
                onOpen={(p) => void openFile(p)}
                onContext={onContext}
                onStartRename={startRename}
              />
            ))}
          </>
        )}
      </div>

      {menu &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[180] min-w-[188px] rounded-lg border border-pide-widget-border bg-pide-widget
              shadow-2xl py-1 text-[13px] pide-fade-in overflow-hidden"
            style={{ left: menuPos.left, top: menuPos.top }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem
              label="New File…"
              onClick={() => {
                setCreateFileDialog({
                  parentDir: parentForNew(menu.node),
                  initialName: "untitled.txt",
                  content: "",
                });
                closeMenu();
              }}
            />
            <MenuItem
              label="New Folder…"
              onClick={() => {
                closeMenu();
                void askNewFolder(parentForNew(menu.node));
              }}
            />
            {menu.node && menu.node.path !== workspacePath ? (
              <>
                <div className="my-1 border-t border-pide-sidebar-border" />
                <MenuItem
                  label="Rename…"
                  icon={<Pencil size={13} />}
                  onClick={() => startRename(menu.node!)}
                />
                <MenuItem
                  label="Delete"
                  icon={<Trash2 size={13} />}
                  danger
                  onClick={() => {
                    const path = menu.node!.path;
                    closeMenu();
                    void deleteEntry(path);
                  }}
                />
              </>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
  icon,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 ${
        danger
          ? "text-pide-error hover:bg-pide-list-hover"
          : "text-pide-fg hover:bg-pide-list-hover"
      }`}
      onClick={onClick}
    >
      {icon ? <span className="opacity-70">{icon}</span> : <span className="w-[13px]" />}
      <span className="flex-1">{label}</span>
    </button>
  );
}
