import type { ControlUiHost } from "openclaw/plugin-sdk/control-ui";

let activeHost: ControlUiHost | undefined;

export function bindMacropadHost(host: ControlUiHost): () => void {
  activeHost = host;
  return () => {
    if (activeHost === host) {
      activeHost = undefined;
    }
  };
}

export function macropadLocale(): string {
  return (
    activeHost?.locale ||
    (typeof document === "undefined" ? "en" : document.documentElement.lang) ||
    "en"
  );
}
