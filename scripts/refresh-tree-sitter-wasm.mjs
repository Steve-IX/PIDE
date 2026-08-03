/**
 * Refresh vendored Tree-sitter WASM assets under public/tree-sitter/.
 * Run after upgrading web-tree-sitter or tree-sitter-wasms:
 *   node scripts/refresh-tree-sitter-wasm.mjs
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "public", "tree-sitter");
mkdirSync(destDir, { recursive: true });

const parserSrc = join(root, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm");
if (!existsSync(parserSrc)) {
  console.error("Missing web-tree-sitter.wasm — run npm install first");
  process.exit(1);
}
copyFileSync(parserSrc, join(destDir, "tree-sitter.wasm"));

const grammars = ["javascript", "typescript", "python", "rust"];
const outDir = join(root, "node_modules", "tree-sitter-wasms", "out");
for (const name of grammars) {
  const src = join(outDir, `tree-sitter-${name}.wasm`);
  if (!existsSync(src)) {
    console.error(`Missing ${src} — install tree-sitter-wasms`);
    process.exit(1);
  }
  copyFileSync(src, join(destDir, `tree-sitter-${name}.wasm`));
}

console.log("Updated public/tree-sitter/:", ["tree-sitter.wasm", ...grammars.map((g) => `tree-sitter-${g}.wasm`)].join(", "));
