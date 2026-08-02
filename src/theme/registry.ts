import type { PideThemeDocument } from "./tokens";
import { BUILTIN_THEME_IDS, type BuiltinThemeId } from "./tokens";
import pideDark from "./themes/pide-dark.json" with { type: "json" };
import pideLight from "./themes/pide-light.json" with { type: "json" };
import pideHc from "./themes/pide-hc.json" with { type: "json" };

const BUILTINS: Record<BuiltinThemeId, PideThemeDocument> = {
  "pide-dark": pideDark as PideThemeDocument,
  "pide-light": pideLight as PideThemeDocument,
  "pide-hc": pideHc as PideThemeDocument,
};

const IMPORTED_KEY = "pide.themes.v1";

export interface ImportedThemeEntry {
  id: string;
  document: PideThemeDocument;
}

export function listBuiltinThemes(): Array<{ id: BuiltinThemeId; name: string }> {
  return BUILTIN_THEME_IDS.map((id) => ({
    id,
    name: BUILTINS[id].name,
  }));
}

export function loadImportedThemes(): ImportedThemeEntry[] {
  try {
    const raw = localStorage.getItem(IMPORTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ImportedThemeEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveImportedThemes(entries: ImportedThemeEntry[]): void {
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(entries));
}

export function resolveThemeId(themeId: string): PideThemeDocument | null {
  if ((BUILTIN_THEME_IDS as readonly string[]).includes(themeId)) {
    return BUILTINS[themeId as BuiltinThemeId];
  }
  if (themeId.startsWith("imported:")) {
    const id = themeId.slice("imported:".length);
    const found = loadImportedThemes().find((t) => t.id === id);
    return found?.document ?? null;
  }
  return BUILTINS["pide-dark"];
}

export function listAllThemes(): Array<{ id: string; name: string }> {
  const imported = loadImportedThemes().map((t) => ({
    id: `imported:${t.id}`,
    name: t.document.name,
  }));
  return [...listBuiltinThemes(), ...imported];
}

/** Normalize a VS Code / PIDE theme JSON blob. */
export function parseThemeJson(raw: unknown, fallbackName: string): PideThemeDocument {
  if (!raw || typeof raw !== "object") {
    throw new Error("Theme file must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const colors = (obj.colors ?? {}) as PideThemeDocument["colors"];
  if (!colors || typeof colors !== "object") {
    throw new Error("Theme must include a colors object");
  }
  const typeRaw = String(obj.type ?? "dark");
  const type: PideThemeDocument["type"] =
    typeRaw === "light" || typeRaw === "hc" ? typeRaw : "dark";
  const name = String(obj.name ?? fallbackName);
  const tokenColors = Array.isArray(obj.tokenColors)
    ? (obj.tokenColors as PideThemeDocument["tokenColors"])
    : undefined;
  return { name, type, colors, tokenColors };
}

export function importThemeDocument(
  doc: PideThemeDocument,
  preferredId?: string,
): string {
  const slug =
    preferredId ||
    doc.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    `theme-${Date.now()}`;
  const entries = loadImportedThemes().filter((e) => e.id !== slug);
  entries.push({ id: slug, document: doc });
  saveImportedThemes(entries);
  return `imported:${slug}`;
}

export function removeImportedTheme(themeId: string): void {
  if (!themeId.startsWith("imported:")) return;
  const id = themeId.slice("imported:".length);
  saveImportedThemes(loadImportedThemes().filter((e) => e.id !== id));
}

export function getBuiltinFallback(): PideThemeDocument {
  return BUILTINS["pide-dark"];
}
