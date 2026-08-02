import { useState } from "react";
import { FilePlus, FolderPlus, RefreshCw, FolderOpen } from "lucide-react";
import type { FileNode } from "../types";
import { useIdeStore } from "../stores/ideStore";
import { fileName } from "../services/fs";
import ViewHeader from "./ui/ViewHeader";
import IconButton from "./ui/IconButton";

function TreeNode({
  node,
  depth,
  onOpen,
  onContext,
}: {
  node: FileNode;
  depth: number;
  onOpen: (path: string) => void;
  onContext: (e: React.MouseEvent, node: FileNode) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const activePath = useIdeStore((s) => s.activePath);

  if (node.isDir) {
    return (
      <div>
        <button
          className="w-full text-left px-2 py-0.5 flex items-center gap-1 text-[13px] text-pide-sidebar-fg hover:bg-pide-list-hover transition-colors duration-150"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen((v) => !v)}
          onContextMenu={(e) => onContext(e, node)}
        >
          <span className="text-pide-muted w-3 inline-block">{open ? "▾" : "▸"}</span>
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          (node.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpen={onOpen}
              onContext={onContext}
            />
          ))}
      </div>
    );
  }

  const active = activePath === node.path;
  return (
    <button
      className={`w-full text-left py-0.5 text-[13px] truncate transition-colors duration-150 ${
        active
          ? "bg-pide-list-active text-pide-fg"
          : "text-pide-muted hover:bg-pide-list-hover hover:text-pide-fg"
      }`}
      style={{ paddingLeft: 20 + depth * 12, paddingRight: 8 }}
      onClick={() => onOpen(node.path)}
      onContextMenu={(e) => onContext(e, node)}
      title={node.path}
    >
      {node.name}
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

  const [menu, setMenu] = useState<MenuState | null>(null);

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
              onClick={() => {
                const name = window.prompt("Folder name");
                if (name?.trim()) void createNewFolder(workspacePath, name.trim());
              }}
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
          <div className="px-3 py-4 text-sm text-pide-muted leading-relaxed">
            <p className="mb-3">No folder open.</p>
            <button
              type="button"
              onClick={() => void openWorkspace()}
              className="px-3 py-1.5 rounded bg-pide-button hover:bg-pide-button-hover text-pide-button-fg text-sm transition-colors duration-150"
            >
              Open Folder
            </button>
          </div>
        ) : (
          <>
            <div
              className="px-3 py-1 text-[11px] text-pide-muted truncate"
              title={workspacePath}
            >
              {tree.name}
            </div>
            {(tree.children ?? []).length === 0 && (
              <div className="px-3 py-3 text-xs text-pide-muted space-y-2">
                <p>This folder is empty.</p>
                <button
                  type="button"
                  className="text-pide-link hover:opacity-90 transition-colors duration-150"
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
                onOpen={(p) => void openFile(p)}
                onContext={onContext}
              />
            ))}
          </>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-[80] min-w-[160px] bg-pide-widget border border-pide-widget-border rounded-md shadow-xl py-1 text-sm"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-pide-list-hover text-pide-fg transition-colors duration-150"
            onClick={() => {
              setCreateFileDialog({
                parentDir: parentForNew(menu.node),
                initialName: "untitled.txt",
                content: "",
              });
              closeMenu();
            }}
          >
            New File…
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-pide-list-hover text-pide-fg transition-colors duration-150"
            onClick={() => {
              const name = window.prompt("Folder name");
              if (name?.trim()) void createNewFolder(parentForNew(menu.node), name.trim());
              closeMenu();
            }}
          >
            New Folder…
          </button>
          {menu.node && menu.node.path !== workspacePath && (
            <>
              <div className="my-1 border-t border-pide-sidebar-border" />
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-pide-list-hover text-pide-fg transition-colors duration-150"
                onClick={() => {
                  const next = window.prompt("Rename to", fileName(menu.node!.path));
                  if (next?.trim()) void renameEntry(menu.node!.path, next.trim());
                  closeMenu();
                }}
              >
                Rename…
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-pide-list-hover text-pide-error transition-colors duration-150"
                onClick={() => {
                  void deleteEntry(menu.node!.path);
                  closeMenu();
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
