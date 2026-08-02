/** Curated VS Code Theme Color API keys used by PIDE workbench chrome. */
export const WORKBENCH_COLOR_KEYS = [
  "foreground",
  "descriptionForeground",
  "errorForeground",
  "focusBorder",
  "contrastBorder",
  "contrastActiveBorder",
  "selection.background",
  "widget.shadow",
  "activityBar.background",
  "activityBar.foreground",
  "activityBar.inactiveForeground",
  "activityBar.border",
  "activityBar.activeBorder",
  "activityBarBadge.background",
  "activityBarBadge.foreground",
  "sideBar.background",
  "sideBar.foreground",
  "sideBar.border",
  "sideBarTitle.foreground",
  "sideBarSectionHeader.background",
  "sideBarSectionHeader.foreground",
  "list.hoverBackground",
  "list.activeSelectionBackground",
  "list.activeSelectionForeground",
  "list.inactiveSelectionBackground",
  "list.focusBackground",
  "editor.background",
  "editor.foreground",
  "editor.lineHighlightBackground",
  "editor.selectionBackground",
  "editor.inactiveSelectionBackground",
  "editorCursor.foreground",
  "editorWhitespace.foreground",
  "editorLineNumber.foreground",
  "editorLineNumber.activeForeground",
  "editorGroupHeader.tabsBackground",
  "editorGroup.border",
  "tab.activeBackground",
  "tab.activeForeground",
  "tab.inactiveBackground",
  "tab.inactiveForeground",
  "tab.border",
  "tab.activeBorderTop",
  "panel.background",
  "panel.border",
  "panelTitle.activeForeground",
  "panelTitle.inactiveForeground",
  "statusBar.background",
  "statusBar.foreground",
  "statusBar.border",
  "statusBar.noFolderBackground",
  "statusBarItem.hoverBackground",
  "titleBar.activeBackground",
  "titleBar.activeForeground",
  "button.background",
  "button.foreground",
  "button.hoverBackground",
  "button.secondaryBackground",
  "button.secondaryForeground",
  "input.background",
  "input.foreground",
  "input.border",
  "input.placeholderForeground",
  "dropdown.background",
  "dropdown.foreground",
  "dropdown.border",
  "badge.background",
  "badge.foreground",
  "scrollbarSlider.background",
  "scrollbarSlider.hoverBackground",
  "scrollbarSlider.activeBackground",
  "editorWidget.background",
  "editorWidget.border",
  "quickInput.background",
  "quickInput.foreground",
  "quickInputList.focusBackground",
  "notifications.background",
  "notifications.foreground",
  "notifications.border",
  "notificationCenterHeader.background",
  "textLink.foreground",
  "terminal.background",
  "terminal.foreground",
  "terminal.ansiBlack",
  "terminal.ansiRed",
  "terminal.ansiGreen",
  "terminal.ansiYellow",
  "terminal.ansiBlue",
  "terminal.ansiMagenta",
  "terminal.ansiCyan",
  "terminal.ansiWhite",
  "terminal.ansiBrightBlack",
  "terminal.ansiBrightRed",
  "terminal.ansiBrightGreen",
  "terminal.ansiBrightYellow",
  "terminal.ansiBrightBlue",
  "terminal.ansiBrightMagenta",
  "terminal.ansiBrightCyan",
  "terminal.ansiBrightWhite",
  "terminalCursor.foreground",
  "gitDecoration.modifiedResourceForeground",
  "gitDecoration.untrackedResourceForeground",
  "gitDecoration.deletedResourceForeground",
] as const;

export type WorkbenchColorKey = (typeof WORKBENCH_COLOR_KEYS)[number];

export type UiDensity = "default" | "compact";

export const BUILTIN_THEME_IDS = ["pide-dark", "pide-light", "pide-hc"] as const;
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number];

export interface TokenColorRule {
  name?: string;
  scope?: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

export interface PideThemeDocument {
  name: string;
  type: "dark" | "light" | "hc";
  colors: Partial<Record<WorkbenchColorKey, string>> & Record<string, string>;
  tokenColors?: TokenColorRule[];
}

/** Keys exposed as quick color pickers in Settings. */
export const QUICK_OVERRIDE_KEYS: WorkbenchColorKey[] = [
  "activityBar.background",
  "sideBar.background",
  "editor.background",
  "statusBar.background",
  "button.background",
  "focusBorder",
  "tab.activeBackground",
  "panel.background",
  "input.background",
  "list.activeSelectionBackground",
  "activityBar.activeBorder",
  "textLink.foreground",
];

/** Convert VS Code key `activityBar.background` → CSS var name suffix `activityBar-background`. */
export function colorKeyToCssSuffix(key: string): string {
  return key.replace(/\./g, "-");
}
