import { DEFAULT_SETTINGS, type AppSettings } from "../types";

const KEY = "pide.settings.v1";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS, agentModels: { ...DEFAULT_SETTINGS.agentModels } };
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      agentModels: {
        ...DEFAULT_SETTINGS.agentModels,
        ...(parsed.agentModels ?? {}),
      },
      enabledModels: Array.isArray(parsed.enabledModels)
        ? parsed.enabledModels
        : DEFAULT_SETTINGS.enabledModels,
      colorCustomizations: {
        ...DEFAULT_SETTINGS.colorCustomizations,
        ...(parsed.colorCustomizations ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, agentModels: { ...DEFAULT_SETTINGS.agentModels } };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
