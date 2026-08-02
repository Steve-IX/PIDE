import { languageFromPath } from "./language";

export interface FileProposal {
  id: string;
  path: string;
  language: string;
  code: string;
  selected: boolean;
}

const FENCE_RE =
  /(?:(?:^|\n)(?:#{1,3}\s*`?([^\n`]+?)`?\s*\n|<!--\s*path:\s*([^\n]+?)\s*-->\s*\n|\/\/\s*path:\s*([^\n]+?)\s*\n|#\s*path:\s*([^\n]+?)\s*\n))?```([\w+-]*)\n([\s\S]*?)```/g;

function cleanPath(raw: string, workspaceHint?: string): string {
  let p = raw.trim().replace(/^[`"'<]+|[>`"']+$/g, "");
  p = p.replace(/^path:\s*/i, "").trim();
  if (workspaceHint && (p.startsWith("./") || !p.includes(":") && !p.startsWith("/") && !p.includes("\\"))) {
    // keep relative; store will join
  }
  return p;
}

export function parseFileProposals(markdown: string): FileProposal[] {
  const proposals: FileProposal[] = [];
  const re = new RegExp(FENCE_RE.source, "g");
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(markdown)) !== null) {
    const pathHint = match[1] || match[2] || match[3] || match[4] || "";
    const lang = match[5] || "plaintext";
    const code = match[6].replace(/\n$/, "");
    if (!code.trim()) continue;

    // Also check first line of code for path comment
    let path = pathHint ? cleanPath(pathHint) : "";
    const first = code.split("\n")[0] ?? "";
    const inline =
      first.match(/^\/\/\s*path:\s*(.+)$/i) ||
      first.match(/^#\s*path:\s*(.+)$/i) ||
      first.match(/^<!--\s*path:\s*(.+)\s*-->$/i);
    if (inline) {
      path = cleanPath(inline[1]);
    }

    if (!path) {
      // single unlabeled block — skip multi-proposal list (handled by Apply last)
      continue;
    }

    proposals.push({
      id: `prop-${i++}-${path}`,
      path,
      language: languageFromPath(path) || lang || "plaintext",
      code: inline ? code.split("\n").slice(1).join("\n") : code,
      selected: true,
    });
  }
  return proposals;
}
