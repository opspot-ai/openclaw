import { html, nothing, render } from "lit";
import type { ControlUiAccessory } from "openclaw/plugin-sdk/control-ui";
import { formatMacropadError, type MacropadClient } from "./api/client.ts";
import { icons } from "./components/icons.ts";
import { t } from "./i18n/index.ts";
import { nextBindRequest, resolveBindState } from "./lib/binding.ts";
import type { MacropadStore } from "./lib/device-store.ts";
import { applyBrightness } from "./lib/slot-presentation.ts";

/**
 * The Micro button, per session.
 *
 * `"session-header"` is the only accessory placement, and it is suppressed in
 * compact mode — so this is a per-session chip rather than a global pill: the
 * control sits where the session it acts on already is.
 */
export function createMacropadSessionAccessory(
  store: MacropadStore,
  client: MacropadClient,
): ControlUiAccessory["mount"] {
  return (container, initialContext) => {
    const host = initialContext.host;
    let context = initialContext;
    let disposed = false;
    let busy = false;

    const draw = () => {
      const state = store.state;
      const bind = resolveBindState({
        connected: context.presented && host.connection.connected,
        device: state.device,
        slots: state.slots,
        sessionKey: context.props.sessionKey,
      });
      if (bind.kind === "unavailable" || !host.connection.canWrite) {
        render(nothing, container);
        return;
      }
      const slot =
        bind.kind === "bound" ? state.slots.find((entry) => entry.index === bind.index) : undefined;
      const swatch = slot ? applyBrightness(slot.frame.color, slot.frame.brightness) : undefined;
      const label =
        bind.kind === "bound"
          ? t("macropad.accessory.unbind", { number: bind.index + 1 })
          : bind.kind === "blocked"
            ? t("macropad.action.allPinned")
            : t("macropad.accessory.bind");
      render(
        html`<button
          class="macropad-session-chip"
          type="button"
          style=${swatch ? `--macropad-key-swatch:${swatch}` : nothing}
          aria-label=${label}
          title=${label}
          ?disabled=${busy || bind.kind === "blocked"}
          @click=${() => {
            if (disposed || busy || context.signal.aborted || !host.connection.connected) {
              return;
            }
            const request = nextBindRequest(bind, {
              sessionKey: context.props.sessionKey,
              agentId: context.props.agentId,
            });
            if (!request) {
              return;
            }
            busy = true;
            draw();
            void (
              request.operation === "slots.unbind"
                ? client.invoke("slots.unbind", request.input)
                : client.invoke("slots.bind", request.input)
            )
              .catch((error: unknown) => {
                // A failed bind must not leave a lying chip; surface it in the title.
                if (!disposed) {
                  container.title = formatMacropadError(error);
                }
              })
              .finally(() => {
                busy = false;
                if (!disposed) {
                  draw();
                }
              });
          }}
        >
          ${
            bind.kind === "bound"
              ? html`<span class="macropad-session-chip__dot"></span>
                  <span class="macropad-session-chip__key"
                    >${t("macropad.keys.keyLabel", { number: bind.index + 1 })}</span
                  >
                  <span class="macropad-session-chip__activity"
                    >${t(`macropad.activity.${bind.activity}`)}</span
                  >`
              : html`${icons.layoutGrid}<span class="macropad-session-chip__key"
                    >${t("macropad.accessory.bind")}</span
                  >`
          }
        </button>`,
        container,
      );
    };

    const stopHost = host.subscribe(draw);
    const stopStore = store.subscribe(draw);
    draw();
    return {
      update(next) {
        context = next;
        draw();
      },
      dispose() {
        disposed = true;
        stopHost();
        stopStore();
        render(nothing, container);
      },
    };
  };
}
