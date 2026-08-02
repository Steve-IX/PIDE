import { applyThemeDocument, type AppliedTheme, MONACO_THEME_ID } from "./applyTheme";
import { getBuiltinFallback, resolveThemeId } from "./registry";
import type { UiDensity } from "./tokens";

export { MONACO_THEME_ID };
export type { AppliedTheme };

let lastApplied: AppliedTheme | null = null;
const listeners = new Set<(applied: AppliedTheme) => void>();

export function getLastAppliedTheme(): AppliedTheme | null {
  return lastApplied;
}

export function subscribeTheme(listener: (applied: AppliedTheme) => void): () => void {
  listeners.add(listener);
  if (lastApplied) listener(lastApplied);
  return () => {
    listeners.delete(listener);
  };
}

export function applyPideTheme(
  themeId: string,
  colorCustomizations?: Record<string, string> | null,
  density: UiDensity = "default",
): AppliedTheme {
  const doc = resolveThemeId(themeId) ?? getBuiltinFallback();
  const applied = applyThemeDocument(doc, colorCustomizations, density);
  lastApplied = applied;
  for (const l of listeners) l(applied);
  return applied;
}

export {
  listAllThemes,
  listBuiltinThemes,
  parseThemeJson,
  importThemeDocument,
  removeImportedTheme,
} from "./registry";
export { QUICK_OVERRIDE_KEYS } from "./tokens";
