import { fileName } from "./fs";

export type RunnerHint = {
  /** Shell line to send to the PTY (PowerShell-friendly). */
  command: string;
  label: string;
};

function psQuote(path: string): string {
  // Single-quoted PowerShell literal; escape embedded single quotes.
  return `'${path.replace(/'/g, "''")}'`;
}

function findCargoRoot(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const srcIdx = normalized.toLowerCase().lastIndexOf("/src/");
  if (srcIdx > 0) {
    return normalized.slice(0, srcIdx).replace(/\//g, "\\");
  }
  return null;
}

/**
 * Build a host-shell command to run/compile the active file.
 * Tools must already be on PATH — PIDE does not bundle compilers.
 */
export function buildRunCommand(args: {
  path: string;
  language: string;
}): RunnerHint | null {
  const { path, language } = args;
  const name = fileName(path);
  const q = psQuote(path);
  const lang = language.toLowerCase();

  if (lang === "python" || name.endsWith(".py")) {
    return { label: "Python", command: `python -u ${q}` };
  }

  if (lang === "javascript" || name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")) {
    return { label: "Node", command: `node ${q}` };
  }

  if (lang === "typescript" || name.endsWith(".ts") || name.endsWith(".tsx")) {
    // Prefer tsx when available; fall back to node (may fail on raw TS).
    return {
      label: "TypeScript",
      command: `if (Get-Command npx -ErrorAction SilentlyContinue) { npx --yes tsx ${q} } else { node ${q} }`,
    };
  }

  if (lang === "rust" || name.endsWith(".rs")) {
    const crate = findCargoRoot(path);
    if (crate) {
      return {
        label: "Cargo",
        command: `Set-Location ${psQuote(crate)}; cargo run`,
      };
    }
    const out = psQuote(path.replace(/\.rs$/i, ".exe"));
    return {
      label: "rustc",
      command: `rustc ${q} -o ${out}; if ($LASTEXITCODE -eq 0) { & ${out} }`,
    };
  }

  if (lang === "go" || name.endsWith(".go")) {
    return { label: "Go", command: `go run ${q}` };
  }

  if (lang === "c" || name.endsWith(".c")) {
    const out = psQuote(path.replace(/\.c$/i, ".exe"));
    return {
      label: "gcc",
      command: `gcc ${q} -o ${out}; if ($LASTEXITCODE -eq 0) { & ${out} }`,
    };
  }

  if (lang === "cpp" || name.endsWith(".cpp") || name.endsWith(".cc") || name.endsWith(".cxx")) {
    const out = psQuote(path.replace(/\.(cpp|cc|cxx)$/i, ".exe"));
    return {
      label: "g++",
      command: `g++ ${q} -o ${out}; if ($LASTEXITCODE -eq 0) { & ${out} }`,
    };
  }

  if (lang === "powershell" || name.endsWith(".ps1")) {
    return { label: "PowerShell", command: `& ${q}` };
  }

  if (lang === "shell" || name.endsWith(".sh")) {
    return { label: "Shell", command: `bash ${q}` };
  }

  if (lang === "ruby" || name.endsWith(".rb")) {
    return { label: "Ruby", command: `ruby ${q}` };
  }

  if (lang === "php" || name.endsWith(".php")) {
    return { label: "PHP", command: `php ${q}` };
  }

  if (lang === "java" || name.endsWith(".java")) {
    const dir = psQuote(path.replace(/[/\\][^/\\]+$/, "") || ".");
    const base = name.replace(/\.java$/i, "");
    return {
      label: "Java",
      command: `Set-Location ${dir}; javac ${psQuote(name)}; if ($LASTEXITCODE -eq 0) { java ${base} }`,
    };
  }

  if (lang === "csharp" || name.endsWith(".cs")) {
    return {
      label: "dotnet",
      command: `if (Test-Path '*.csproj') { dotnet run } else { dotnet script ${q} }`,
    };
  }

  if (lang === "lua" || name.endsWith(".lua")) {
    return { label: "Lua", command: `lua ${q}` };
  }

  if (lang === "perl" || name.endsWith(".pl") || name.endsWith(".pm")) {
    return { label: "Perl", command: `perl ${q}` };
  }

  if (lang === "r" || name.endsWith(".r") || name.endsWith(".R")) {
    return { label: "R", command: `Rscript ${q}` };
  }

  if (lang === "julia" || name.endsWith(".jl")) {
    return { label: "Julia", command: `julia ${q}` };
  }

  if (lang === "kotlin" || name.endsWith(".kt")) {
    return {
      label: "Kotlin",
      command: `kotlinc ${q} -include-runtime -d out.jar; if ($LASTEXITCODE -eq 0) { java -jar out.jar }`,
    };
  }

  if (lang === "swift" || name.endsWith(".swift")) {
    return { label: "Swift", command: `swift ${q}` };
  }

  if (lang === "zig" || name.endsWith(".zig")) {
    return { label: "Zig", command: `zig run ${q}` };
  }

  if (lang === "elixir" || name.endsWith(".exs") || name.endsWith(".ex")) {
    return { label: "Elixir", command: `elixir ${q}` };
  }

  if (lang === "haskell" || name.endsWith(".hs")) {
    return { label: "Haskell", command: `runhaskell ${q}` };
  }

  if (lang === "scala" || name.endsWith(".scala")) {
    return { label: "Scala", command: `scala ${q}` };
  }

  if (lang === "dart" || name.endsWith(".dart")) {
    return { label: "Dart", command: `dart run ${q}` };
  }

  if (name.endsWith(".bat") || name.endsWith(".cmd")) {
    return { label: "Batch", command: `& ${q}` };
  }

  return null;
}
