import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadSettings } from "./utils/settings";
import { applyPideTheme } from "./theme";

const settings = loadSettings();
applyPideTheme(settings.themeId, settings.colorCustomizations, settings.uiDensity);
document.documentElement.style.setProperty(
  "--pide-ui-font-size",
  `${settings.uiFontSize}px`,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
