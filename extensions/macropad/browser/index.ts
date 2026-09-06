import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { MACROPAD_PLUGIN_ID } from "../contract.ts";
import { createMacropadClient } from "./api/client.ts";
import { bindMacropadHost } from "./host.ts";
import { t } from "./i18n/index.ts";
import { navIconForDevice } from "./lib/device-presentation.ts";
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
    // A nav entry renders one icon and one text span with no badge slot, so the
    // icon is the only live signal the sidebar can carry. Re-register only when
    // the icon actually changes — never per battery reading.
    let navigation: { icon: string; dispose: () => void } | undefined;
    const syncNavigation = () => {
      const icon = navIconForDevice(store.state.device, host.connection.connected);
      if (navigation?.icon === icon) {
        return;
      }
      navigation?.dispose();
      navigation = {
        icon,
        // Verified against the host icon registry; an unknown name would
        // silently fall back to `puzzle`.
        dispose: host.ui.registerNavigation({
          id: "macropad",
          label: t("macropad.title"),
          page: macropadPageTarget(),
          icon,
          order: 20,
        }),
      };
    };
    const registrations = [
      host.ui.registerPage({
        id: "macropad",
        label: t("macropad.title"),
        mount: createMacropadPage(store, client),
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
      store.subscribe(syncNavigation),
      host.subscribe(syncNavigation),
      startMacropadSync(client, store),
    ];
    syncNavigation();
    return () => {
      for (const dispose of registrations.toReversed()) {
        dispose();
      }
      navigation?.dispose();
      navigation = undefined;
      store.dispose();
      unbind();
    };
  },
});
