import { useMemo, useState } from "react";
import { useIdeStore } from "../stores/ideStore";
import GitHubAuthButton from "./GitHubAuthButton";
import ViewHeader from "./ui/ViewHeader";
import {
  importThemeDocument,
  listAllThemes,
  parseThemeJson,
  QUICK_OVERRIDE_KEYS,
  removeImportedTheme,
} from "../theme";
import type { PerfProfile, UiDensity } from "../types";
import { PERF_PROFILES, resolvePerfConfig } from "../services/perfProfiles";

export default function SettingsPane() {
  const settings = useIdeStore((s) => s.settings);
  const updateSettings = useIdeStore((s) => s.updateSettings);
  const refreshOllama = useIdeStore((s) => s.refreshOllama);
  const pushToast = useIdeStore((s) => s.pushToast);

  const [advancedJson, setAdvancedJson] = useState(() =>
    JSON.stringify(settings.colorCustomizations ?? {}, null, 2),
  );
  const [themesVersion, setThemesVersion] = useState(0);
  const themes = useMemo(() => listAllThemes(), [themesVersion]);

  function importThemeFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.jsonc,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const cleaned = text.replace(/^\uFEFF/, "").replace(/\/\/.*$/gm, "");
        const raw = JSON.parse(cleaned) as unknown;
        const doc = parseThemeJson(raw, file.name.replace(/\.jsonc?$/i, ""));
        const id = importThemeDocument(doc);
        updateSettings({ themeId: id });
        setThemesVersion((v) => v + 1);
        pushToast("success", `Imported theme: ${doc.name}`);
      } catch (e) {
        pushToast("error", e instanceof Error ? e.message : String(e));
      }
    };
    input.click();
  }

  function setOverride(key: string, value: string) {
    const next = { ...settings.colorCustomizations };
    if (!value.trim()) delete next[key];
    else next[key] = value.trim();
    updateSettings({ colorCustomizations: next });
    setAdvancedJson(JSON.stringify(next, null, 2));
  }

  function applyAdvancedJson() {
    try {
      const parsed = JSON.parse(advancedJson) as Record<string, string>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Overrides must be a JSON object of color keys");
      }
      updateSettings({ colorCustomizations: parsed });
      pushToast("success", "Color customizations applied");
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : String(e));
    }
  }

  function resetOverrides() {
    updateSettings({ colorCustomizations: {} });
    setAdvancedJson("{}");
    pushToast("info", "Color overrides cleared");
  }

  function removeCurrentImport() {
    if (!settings.themeId.startsWith("imported:")) return;
    removeImportedTheme(settings.themeId);
    updateSettings({ themeId: "pide-dark" });
    setThemesVersion((v) => v + 1);
    pushToast("info", "Imported theme removed");
  }

  return (
    <div className="h-full flex flex-col bg-pide-sidebar">
      <ViewHeader title="Settings" />
      <div className="p-3 text-sm text-pide-sidebar-fg space-y-4 overflow-auto">
        <div className="space-y-2">
          <span className="text-xs text-pide-muted uppercase tracking-wide">Appearance</span>

          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">Color theme</span>
            <select
              value={settings.themeId}
              onChange={(e) => updateSettings({ themeId: e.target.value })}
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm transition-colors duration-150"
            >
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => importThemeFile()}
              className="px-2 py-1 rounded bg-pide-button hover:bg-pide-button-hover text-pide-button-fg text-xs transition-colors duration-150"
            >
              Import theme JSON…
            </button>
            {settings.themeId.startsWith("imported:") && (
              <button
                type="button"
                onClick={removeCurrentImport}
                className="px-2 py-1 rounded bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)] text-xs transition-colors duration-150"
              >
                Remove imported
              </button>
            )}
            <button
              type="button"
              onClick={resetOverrides}
              className="px-2 py-1 rounded bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)] text-xs transition-colors duration-150"
            >
              Reset overrides
            </button>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">
              UI font size ({settings.uiFontSize}px)
            </span>
            <input
              type="range"
              min={11}
              max={16}
              value={settings.uiFontSize}
              onChange={(e) => updateSettings({ uiFontSize: Number(e.target.value) })}
              className="w-full"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">Density</span>
            <select
              value={settings.uiDensity}
              onChange={(e) =>
                updateSettings({ uiDensity: e.target.value as UiDensity })
              }
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm"
            >
              <option value="default">Default</option>
              <option value="compact">Compact</option>
            </select>
          </label>

          <div className="space-y-1.5 pt-1">
            <span className="text-xs text-pide-muted">Quick color overrides</span>
            {QUICK_OVERRIDE_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-[11px]">
                <span className="w-[9.5rem] shrink-0 truncate font-mono text-pide-muted" title={key}>
                  {key.split(".").pop()}
                </span>
                <input
                  type="color"
                  value={
                    (settings.colorCustomizations[key] || "#3d7eff").slice(0, 7)
                  }
                  onChange={(e) => setOverride(key, e.target.value)}
                  className="h-7 w-10 shrink-0 bg-transparent border-0 cursor-pointer"
                />
                <input
                  value={settings.colorCustomizations[key] ?? ""}
                  onChange={(e) => setOverride(key, e.target.value)}
                  placeholder="(theme default)"
                  className="flex-1 min-w-0 bg-pide-input border border-pide-input-border rounded px-1.5 py-1 text-pide-input-fg font-mono text-[11px]"
                />
              </label>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">Advanced overrides (JSON)</span>
            <textarea
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-[11px] font-mono"
            />
            <button
              type="button"
              onClick={applyAdvancedJson}
              className="px-2 py-1 rounded bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)] text-xs"
            >
              Apply JSON
            </button>
          </label>
        </div>

        <div className="space-y-2 pt-2 border-t border-pide-sidebar-border">
          <span className="text-xs text-pide-muted uppercase tracking-wide">
            LLM performance
          </span>
          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">Profile</span>
            <select
              value={settings.perfProfile}
              onChange={(e) =>
                updateSettings({ perfProfile: e.target.value as PerfProfile })
              }
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm"
            >
              {(Object.keys(PERF_PROFILES) as PerfProfile[]).map((id) => (
                <option key={id} value={id}>
                  {PERF_PROFILES[id].label} — {PERF_PROFILES[id].description}
                </option>
              ))}
            </select>
          </label>
          {(() => {
            const p = resolvePerfConfig(settings.perfProfile, {
              maxHistoryMessages: settings.maxHistoryMessages,
              maxAttachChars: settings.maxAttachChars,
              keepAlive: settings.ollamaKeepAlive,
              numGpu: settings.ollamaNumGpu,
            });
            return (
              <p className="text-[11px] text-pide-muted leading-relaxed">
                Effective: ctx {p.options.num_ctx}, max reply {p.options.num_predict},
                history {p.maxHistoryMessages} msgs, attach ≤{p.maxAttachChars} chars,
                keep_alive {p.keepAlive}
              </p>
            );
          })()}
          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">
              Max history messages (0 = profile default)
            </span>
            <input
              type="number"
              min={0}
              max={64}
              value={settings.maxHistoryMessages}
              onChange={(e) =>
                updateSettings({ maxHistoryMessages: Number(e.target.value) || 0 })
              }
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">
              Max attach chars (0 = profile default)
            </span>
            <input
              type="number"
              min={0}
              max={100000}
              step={500}
              value={settings.maxAttachChars}
              onChange={(e) =>
                updateSettings({ maxAttachChars: Number(e.target.value) || 0 })
              }
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">Keep-alive (empty = profile)</span>
            <input
              value={settings.ollamaKeepAlive}
              onChange={(e) => updateSettings({ ollamaKeepAlive: e.target.value })}
              placeholder="30m"
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm font-mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">
              GPU layers override (blank = Ollama default)
            </span>
            <input
              type="number"
              min={0}
              placeholder="auto"
              value={settings.ollamaNumGpu ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                updateSettings({
                  ollamaNumGpu: v === "" ? null : Math.max(0, Number(v) || 0),
                });
              }}
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-pide-muted uppercase tracking-wide">Ollama base URL</span>
          <input
            value={settings.ollamaBaseUrl}
            onChange={(e) => updateSettings({ ollamaBaseUrl: e.target.value })}
            onBlur={() => void refreshOllama()}
            className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm transition-colors duration-150"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-pide-muted uppercase tracking-wide">
            Editor font size ({settings.editorFontSize}px)
          </span>
          <input
            type="range"
            min={11}
            max={22}
            value={settings.editorFontSize}
            onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) })}
            className="w-full"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.attachActiveFile}
            onChange={(e) => updateSettings({ attachActiveFile: e.target.checked })}
          />
          Attach active file to chat context
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.saveAfterApply}
            onChange={(e) => updateSettings({ saveAfterApply: e.target.checked })}
          />
          Save after apply / create
        </label>

        <div className="space-y-2 pt-2 border-t border-pide-sidebar-border">
          <span className="text-xs text-pide-muted uppercase tracking-wide">GitHub</span>
          <label className="block space-y-1">
            <span className="text-xs text-pide-muted">OAuth Client ID (Device Flow)</span>
            <input
              value={settings.githubClientId}
              onChange={(e) => updateSettings({ githubClientId: e.target.value })}
              placeholder="Ov23…"
              className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-sm font-mono transition-colors duration-150"
            />
          </label>
          <p className="text-[11px] text-pide-muted leading-relaxed">
            Create a GitHub OAuth App with Device Flow enabled. No client secret needed for
            public native apps. Leave empty to use a Personal Access Token instead.
          </p>
          <GitHubAuthButton />
        </div>

        <p className="text-xs text-pide-muted leading-relaxed">
          Settings persist in localStorage. Themes and color overrides are local to this
          machine. GitHub tokens use the OS keyring.
        </p>
      </div>
    </div>
  );
}
