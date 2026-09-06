import { nothing, render } from "lit";
import type { ControlUiView } from "openclaw/plugin-sdk/control-ui";
import { formatMacropadError, type MacropadClient } from "../../api/client.ts";
import type { MacropadStore } from "../../lib/device-store.ts";
import { mirrorWidth, presentSlots } from "../../lib/slot-presentation.ts";
import { renderMacropad } from "./view.ts";

/** Mode A routing: `/plugin?plugin=macropad&id=macropad`. `path` is ignored here. */
export function macropadPageTarget() {
  return { id: "macropad" };
}

export function createMacropadPage(store: MacropadStore, client: MacropadClient): ControlUiView {
  return (container, initialContext) => {
    const host = initialContext.host;
    let disposed = false;
    let queued = false;
    let busy = false;
    let actionError: string | null = null;

    const requestUpdate = () => {
      if (disposed || queued) {
        return;
      }
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed) {
          update();
        }
      });
    };

    /** Serialize writes: two binds racing would fight over the same key. */
    const run = (work: () => Promise<unknown>) => {
      if (busy || disposed || !host.connection.connected) {
        return;
      }
      busy = true;
      actionError = null;
      requestUpdate();
      void work()
        .catch((error: unknown) => {
          if (!disposed) {
            actionError = formatMacropadError(error);
          }
        })
        .finally(() => {
          busy = false;
          requestUpdate();
        });
    };

    const update = () => {
      const state = store.state;
      render(
        renderMacropad({
          device: state.device,
          slots: presentSlots(state.slots, mirrorWidth(state.device)),
          sessions: host.sessions.rows,
          error: actionError ?? state.error,
          loaded: state.loaded,
          connected: host.connection.connected,
          canWrite: host.connection.canWrite,
          busy,
          onBind: (index, sessionKey) => {
            const session = host.sessions.rows.find((row) => row.key === sessionKey);
            run(() =>
              client.invoke("slots.bind", {
                sessionKey,
                ...(session?.agentId ? { agentId: session.agentId } : {}),
                index,
              }),
            );
          },
          onUnbind: (index) => run(() => client.invoke("slots.unbind", { index })),
          onIdentify: () => run(() => client.invoke("device.identify", {})),
        }),
        container,
      );
    };

    const unsubscribeStore = store.subscribe(requestUpdate);
    const unsubscribeHost = host.subscribe(requestUpdate);
    update();
    return {
      // The console reads only host and store state; page params carry nothing.
      update() {
        requestUpdate();
      },
      dispose() {
        disposed = true;
        unsubscribeStore();
        unsubscribeHost();
        render(nothing, container);
      },
    };
  };
}
