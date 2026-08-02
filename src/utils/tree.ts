import type { FileNode } from "../types";

export function flattenFiles(node: FileNode | null): FileNode[] {
  if (!node) return [];
  const out: FileNode[] = [];
  const walk = (n: FileNode) => {
    if (!n.isDir) {
      out.push(n);
      return;
    }
    for (const child of n.children ?? []) walk(child);
  };
  if (node.isDir) {
    for (const child of node.children ?? []) walk(child);
  } else {
    out.push(node);
  }
  return out;
}

export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return -1;
    score += 10 - Math.min(9, idx - ti);
    ti = idx + 1;
  }
  return score;
}
