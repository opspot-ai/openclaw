import type { ControlUiAction, ControlUiHost } from "openclaw/plugin-sdk/control-ui";
import type { MacropadClient } from "./api/client.ts";
import { t } from "./i18n/index.ts";
import { nextBindRequest, resolveBindState, resolveSessionActionState } from "./lib/binding.ts";
import type { MacropadStore } from "./lib/device-store.ts";

/**
 * Session-menu entry.
 *
 * `resolve` runs synchronously against plugin-owned state, which is why
 * `activate` wires `store.subscribe(host.ui.invalidate)`: without it the label
 * would keep advertising a key the session no longer owns.
 */
export function createMacropadSessionAction(
  store: MacropadStore,
  client: MacropadClient,
  host: ControlUiHost,
): ControlUiAction {
  return {
    id: "bind-key",
    label: t("macropad.action.bind"),
    placement: "session",
    // `resolve` receives no host, so the connection comes from the closure.
    resolve: (context) => {
      const state = store.state;
      return resolveSessionActionState(
        resolveBindState({
          connected: host.connection.connected,
          device: state.device,
          slots: state.slots,
          sessionKey: context.sessionKey,
        }),
        host.connection.canWrite,
      );
    },
    run: async (context) => {
      const state = store.state;
      const request = nextBindRequest(
        resolveBindState({
          connected: context.host.connection.connected,
          device: state.device,
          slots: state.slots,
          sessionKey: context.sessionKey,
        }),
        { sessionKey: context.sessionKey, agentId: context.agentId },
      );
      if (!request || context.signal.aborted) {
        return;
      }
      await (request.operation === "slots.unbind"
        ? client.invoke("slots.unbind", request.input)
        : client.invoke("slots.bind", request.input));
    },
  };
}
