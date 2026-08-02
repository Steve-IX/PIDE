const LANG_TO_EXT: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  markdown: "md",
  html: "html",
  css: "css",
  scss: "scss",
  python: "py",
  rust: "rs",
  go: "go",
  java: "java",
  kotlin: "kt",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  php: "php",
  ruby: "rb",
  shell: "sh",
  bash: "sh",
  powershell: "ps1",
  sql: "sql",
  yaml: "yml",
  xml: "xml",
  plaintext: "txt",
};

export function extensionFromLanguage(lang: string): string {
  const key = lang.toLowerCase().trim();
  return LANG_TO_EXT[key] ?? (key || "txt");
}

export function suggestFileName(lang: string, base = "untitled"): string {
  const ext = extensionFromLanguage(lang);
  return `${base}.${ext}`;
}
