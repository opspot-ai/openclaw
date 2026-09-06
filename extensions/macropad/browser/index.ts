import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { MACROPAD_PLUGIN_ID } from "../contract.ts";
import { createMacropadClient } from "./api/client.ts";
import { bindMacropadHost } from "./host.ts";
import { t } from "./i18n/index.ts";
import { createMacropadStore, startMacropadSync } from "./lib/device-store.ts";
import { createMacropadPage, macropadPageTarget } from "./pages/macropad/macropad-page.ts";
import { createMacropadSessionAccessory } from "./session-accessory.ts";
import { createMacropadSessionAction } from "./session-action.ts";
import "./styles/macropad.css";

export default defineControlUiPlugin({
  id: MACROPAD_PLUGIN_ID,
  activate(host) {
    const unbind = bindMacropadHost(host);
    const store = createMacropadStore();
    const client = createMacropadClient(host);
    const registrations = [
      host.ui.registerPage({
        id: "macropad",
        label: t("macropad.title"),
        mount: createMacropadPage(store, client),
      }),
      host.ui.registerNavigation({
        id: "macropad",
        label: t("macropad.title"),
        page: macropadPageTarget(),
        // Verified against the host icon registry; an unknown name would
        // silently fall back to `puzzle`.
        icon: "layoutGrid",
        order: 20,
      }),
      host.ui.registerAccessory({
        id: "bound-key",
        placement: "session-header",
        mount: createMacropadSessionAccessory(store, client),
      }),
      host.ui.registerAction(createMacropadSessionAction(store, client, host)),
      // `resolve` is synchronous and reads plugin state, so contributions must
      // be re-presented whenever that state moves.
      store.subscribe(host.ui.invalidate),
      startMacropadSync(client, store),
    ];
    return () => {
      for (const dispose of registrations.toReversed()) {
        dispose();
      }
      store.dispose();
      unbind();
    };
  },
});
