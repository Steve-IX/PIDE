import { Parser, Language, type Tree, type Node } from "web-tree-sitter";

const WASM_BASE = "/tree-sitter";

/** Monaco language ids with dedicated grammars. */
const LANG_WASM: Record<string, string> = {
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  python: "tree-sitter-python.wasm",
  rust: "tree-sitter-rust.wasm",
};

const SCOPE_TYPES: Record<string, Set<string>> = {
  javascript: new Set([
    "function_declaration",
    "function_expression",
    "arrow_function",
    "method_definition",
    "class_declaration",
    "generator_function_declaration",
  ]),
  typescript: new Set([
    "function_declaration",
    "function_expression",
    "arrow_function",
    "method_definition",
    "class_declaration",
    "generator_function_declaration",
    "interface_declaration",
    "type_alias_declaration",
  ]),
  python: new Set(["function_definition", "class_definition", "async_function_definition"]),
  rust: new Set(["function_item", "impl_item", "mod_item", "struct_item", "enum_item", "trait_item"]),
};

const IMPORT_TYPES: Record<string, Set<string>> = {
  javascript: new Set(["import_statement"]),
  typescript: new Set(["import_statement"]),
  python: new Set(["import_statement", "import_from_statement"]),
  rust: new Set(["use_declaration", "extern_crate_declaration"]),
};

const PREFIX_MAX = 550;
const SUFFIX_MAX = 280;
const FALLBACK_LINES_BEFORE = 40;
const FALLBACK_LINES_AFTER = 20;

export interface FimContext {
  prefix: string;
  suffix: string;
  /** true when Tree-sitter scope trim was used */
  trimmed: boolean;
}

let initPromise: Promise<void> | null = null;
let parser: Parser | null = null;
const languages = new Map<string, Language>();
const trees = new Map<string, { languageId: string; tree: Tree; text: string }>();

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile(path: string) {
        if (path.endsWith(".wasm")) {
          // Runtime asks for web-tree-sitter.wasm; we vendor as tree-sitter.wasm
          if (path.includes("web-tree-sitter") || path === "tree-sitter.wasm") {
            return `${WASM_BASE}/tree-sitter.wasm`;
          }
          return `${WASM_BASE}/${path.split("/").pop()}`;
        }
        return path;
      },
    }).then(() => {
      parser = new Parser();
    });
  }
  return initPromise;
}

async function loadLanguage(languageId: string): Promise<Language | null> {
  const file = LANG_WASM[languageId];
  if (!file) return null;
  const cached = languages.get(languageId);
  if (cached) return cached;
  await ensureInit();
  const lang = await Language.load(`${WASM_BASE}/${file}`);
  languages.set(languageId, lang);
  return lang;
}

export function supportsAstTrim(languageId: string): boolean {
  return languageId in LANG_WASM;
}

function findEnclosingScope(node: Node, languageId: string): Node {
  const types = SCOPE_TYPES[languageId];
  let cur: Node | null = node;
  let best: Node | null = null;
  while (cur) {
    if (types?.has(cur.type)) best = cur;
    cur = cur.parent;
  }
  return best ?? node;
}

function collectImports(root: Node, languageId: string, source: string): string {
  const types = IMPORT_TYPES[languageId];
  if (!types) return "";
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (types.has(n.type)) {
      parts.push(source.slice(n.startIndex, n.endIndex));
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  };
  walk(root);
  return parts.join("\n");
}

function clampPrefix(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(s.length - max);
}

function clampSuffix(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function lineWindowFallback(text: string, offset: number): FimContext {
  const lines = text.split("\n");
  let pos = 0;
  let lineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + (i < lines.length - 1 ? 1 : 0);
    if (pos + lineLen > offset) {
      lineIdx = i;
      break;
    }
    pos += lineLen;
    lineIdx = i;
  }
  const start = Math.max(0, lineIdx - FALLBACK_LINES_BEFORE);
  const end = Math.min(lines.length - 1, lineIdx + FALLBACK_LINES_AFTER);
  let startOffset = 0;
  for (let i = 0; i < start; i++) startOffset += lines[i].length + 1;
  let endOffset = startOffset;
  for (let i = start; i <= end; i++) {
    endOffset += lines[i].length + (i < lines.length - 1 ? 1 : 0);
  }
  const windowText = text.slice(startOffset, endOffset);
  const local = Math.max(0, Math.min(offset - startOffset, windowText.length));
  return {
    prefix: clampPrefix(windowText.slice(0, local), PREFIX_MAX),
    suffix: clampSuffix(windowText.slice(local), SUFFIX_MAX),
    trimmed: false,
  };
}

/**
 * Parse buffer and extract FIM prefix/suffix (AST scope + imports when available).
 */
export async function buildFimContext(args: {
  bufferKey: string;
  languageId: string;
  text: string;
  cursorOffset: number;
}): Promise<FimContext> {
  const { bufferKey, languageId, text, cursorOffset } = args;
  const offset = Math.max(0, Math.min(cursorOffset, text.length));

  if (!supportsAstTrim(languageId)) {
    return lineWindowFallback(text, offset);
  }

  try {
    await ensureInit();
    const lang = await loadLanguage(languageId);
    if (!lang || !parser) return lineWindowFallback(text, offset);

    parser.setLanguage(lang);
    const prev = trees.get(bufferKey);
    let tree: Tree;

    if (prev && prev.languageId === languageId && prev.text !== text) {
      prev.tree.delete();
      tree = parser.parse(text)!;
    } else if (prev && prev.languageId === languageId && prev.text === text) {
      tree = prev.tree;
    } else {
      if (prev) prev.tree.delete();
      tree = parser.parse(text)!;
    }

    trees.set(bufferKey, { languageId, tree, text });

    const named =
      tree.rootNode.namedDescendantForIndex(offset) ??
      tree.rootNode.descendantForIndex(offset);
    if (!named) return lineWindowFallback(text, offset);

    const scope = findEnclosingScope(named, languageId);
    const imports = collectImports(tree.rootNode, languageId, text);

    const scopeStart = scope.startIndex;
    const scopeEnd = scope.endIndex;
    const inScopePrefix = text.slice(scopeStart, offset);
    const inScopeSuffix = text.slice(offset, scopeEnd);

    let prefix = imports ? `${imports}\n\n${inScopePrefix}` : inScopePrefix;
    prefix = clampPrefix(prefix, PREFIX_MAX);
    const suffix = clampSuffix(inScopeSuffix, SUFFIX_MAX);

    return { prefix, suffix, trimmed: true };
  } catch {
    return lineWindowFallback(text, offset);
  }
}

/** Drop cached tree when a tab closes. */
export function disposeAstBuffer(bufferKey: string): void {
  const prev = trees.get(bufferKey);
  if (prev) {
    prev.tree.delete();
    trees.delete(bufferKey);
  }
}
