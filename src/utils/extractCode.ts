export interface CodeBlock {
  language: string;
  code: string;
}

const FENCE_RE = /```([\w+-]*)\n([\s\S]*?)```/g;

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(FENCE_RE.source, "g");
  while ((match = re.exec(markdown)) !== null) {
    blocks.push({
      language: match[1] || "plaintext",
      code: match[2].replace(/\n$/, ""),
    });
  }
  return blocks;
}

export function lastCodeBlock(markdown: string): CodeBlock | null {
  const blocks = extractCodeBlocks(markdown);
  return blocks.length ? blocks[blocks.length - 1] : null;
}
