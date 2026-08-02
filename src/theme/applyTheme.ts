import {
  colorKeyToCssSuffix,
  WORKBENCH_COLOR_KEYS,
  type PideThemeDocument,
  type TokenColorRule,
  type UiDensity,
} from "./tokens";

export const MONACO_THEME_ID = "pide-theme";

/** Minimal Monaco theme shape — avoid depending on monaco-editor types package. */
export interface MonacoThemeData {
  base: "vs" | "vs-dark" | "hc-black";
  inherit: boolean;
  rules: Array<{
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
  }>;
  colors: Record<string, string | undefined>;
}

export interface XtermThemePayload {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent?: string;
  selectionBackground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface AppliedTheme {
  document: PideThemeDocument;
  mergedColors: Record<string, string>;
  monaco: MonacoThemeData;
  xterm: XtermThemePayload;
}

function tokenColorsToMonacoRules(
  tokenColors: TokenColorRule[] | undefined,
): MonacoThemeData["rules"] {
  if (!tokenColors?.length) return [];
  const rules: MonacoThemeData["rules"] = [];
  for (const entry of tokenColors) {
    const scopes = entry.scope
      ? Array.isArray(entry.scope)
        ? entry.scope
        : [entry.scope]
      : [];
    const fg = entry.settings.foreground?.replace(/^#/, "");
    const fontStyle = entry.settings.fontStyle;
    for (const scope of scopes) {
      const token = scope.split(".").slice(0, 2).join(".") || scope;
      rules.push({
        token,
        foreground: fg,
        fontStyle: fontStyle || undefined,
      });
      if (scope !== token) {
        rules.push({
          token: scope,
          foreground: fg,
          fontStyle: fontStyle || undefined,
        });
      }
    }
  }
  return rules;
}

function monacoBase(type: PideThemeDocument["type"]): "vs" | "vs-dark" | "hc-black" {
  if (type === "light") return "vs";
  if (type === "hc") return "hc-black";
  return "vs-dark";
}

export function mergeThemeColors(
  base: PideThemeDocument,
  overrides?: Record<string, string> | null,
): Record<string, string> {
  const merged: Record<string, string> = { ...base.colors };
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === "string" && v.trim()) merged[k] = v.trim();
    }
  }
  return merged;
}

export function buildMonacoTheme(
  doc: PideThemeDocument,
  colors: Record<string, string>,
): MonacoThemeData {
  return {
    base: monacoBase(doc.type),
    inherit: true,
    rules: tokenColorsToMonacoRules(doc.tokenColors),
    colors: {
      "editor.background": colors["editor.background"] ?? "#000000",
      "editor.foreground": colors["editor.foreground"] ?? "#ffffff",
      "editor.lineHighlightBackground":
        colors["editor.lineHighlightBackground"] ?? "#00000000",
      "editor.selectionBackground":
        colors["editor.selectionBackground"] ?? "#264f7840",
      "editor.inactiveSelectionBackground":
        colors["editor.inactiveSelectionBackground"] ?? "#264f7820",
      "editorCursor.foreground": colors["editorCursor.foreground"] ?? "#ffffff",
      "editorWhitespace.foreground":
        colors["editorWhitespace.foreground"] ?? "#ffffff20",
      "editorLineNumber.foreground":
        colors["editorLineNumber.foreground"] ?? "#858585",
      "editorLineNumber.activeForeground":
        colors["editorLineNumber.activeForeground"] ?? "#c6c6c6",
      "editorWidget.background": colors["editorWidget.background"],
      "editorWidget.border": colors["editorWidget.border"],
      focusBorder: colors["focusBorder"],
    },
  };
}

export function buildXtermTheme(colors: Record<string, string>): XtermThemePayload {
  return {
    background: colors["terminal.background"] ?? colors["editor.background"] ?? "#000",
    foreground: colors["terminal.foreground"] ?? colors["editor.foreground"] ?? "#fff",
    cursor: colors["terminalCursor.foreground"] ?? colors["editorCursor.foreground"] ?? "#fff",
    selectionBackground: colors["editor.selectionBackground"],
    black: colors["terminal.ansiBlack"] ?? "#000",
    red: colors["terminal.ansiRed"] ?? "#f00",
    green: colors["terminal.ansiGreen"] ?? "#0f0",
    yellow: colors["terminal.ansiYellow"] ?? "#ff0",
    blue: colors["terminal.ansiBlue"] ?? "#00f",
    magenta: colors["terminal.ansiMagenta"] ?? "#f0f",
    cyan: colors["terminal.ansiCyan"] ?? "#0ff",
    white: colors["terminal.ansiWhite"] ?? "#fff",
    brightBlack: colors["terminal.ansiBrightBlack"] ?? "#888",
    brightRed: colors["terminal.ansiBrightRed"] ?? "#f88",
    brightGreen: colors["terminal.ansiBrightGreen"] ?? "#8f8",
    brightYellow: colors["terminal.ansiBrightYellow"] ?? "#ff8",
    brightBlue: colors["terminal.ansiBrightBlue"] ?? "#88f",
    brightMagenta: colors["terminal.ansiBrightMagenta"] ?? "#f8f",
    brightCyan: colors["terminal.ansiBrightCyan"] ?? "#8ff",
    brightWhite: colors["terminal.ansiBrightWhite"] ?? "#fff",
  };
}

export function applyCssVariables(
  colors: Record<string, string>,
  density: UiDensity = "default",
): void {
  const root = document.documentElement;
  root.dataset.density = density;

  const keys = new Set<string>([
    ...WORKBENCH_COLOR_KEYS,
    ...Object.keys(colors),
  ]);

  for (const key of keys) {
    const value = colors[key];
    if (!value) continue;
    const suffix = colorKeyToCssSuffix(key);
    root.style.setProperty(`--pide-${suffix}`, value);
    root.style.setProperty(`--vscode-${suffix}`, value);
  }

  root.style.setProperty("--bg-app", colors["editor.background"] ?? "#0d1118");
  root.style.setProperty("--bg-panel", colors["sideBar.background"] ?? "#11151e");
  root.style.setProperty(
    "--bg-elevated",
    colors["editorWidget.background"] ?? colors["sideBar.background"] ?? "#151b27",
  );
  root.style.setProperty("--border", colors["sideBar.border"] ?? "#1a2030");
  root.style.setProperty("--accent", colors["button.background"] ?? "#3d7eff");
  root.style.setProperty(
    "--accent-hover",
    colors["button.hoverBackground"] ?? colors["button.background"] ?? "#5b91ff",
  );
  root.style.setProperty("--text", colors["foreground"] ?? "#d7dde8");
  root.style.setProperty(
    "--text-muted",
    colors["descriptionForeground"] ?? "#8b95a8",
  );
}

export function applyThemeDocument(
  doc: PideThemeDocument,
  overrides?: Record<string, string> | null,
  density: UiDensity = "default",
): AppliedTheme {
  const mergedColors = mergeThemeColors(doc, overrides);
  applyCssVariables(mergedColors, density);
  document.documentElement.dataset.themeType = doc.type;

  return {
    document: doc,
    mergedColors,
    monaco: buildMonacoTheme(doc, mergedColors),
    xterm: buildXtermTheme(mergedColors),
  };
}
