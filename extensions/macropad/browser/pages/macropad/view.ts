import { html, nothing, type TemplateResult } from "lit";
import { renderBatteryGlyph } from "../../components/battery-glyph.ts";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { presentBattery, presentDevicePill } from "../../lib/device-presentation.ts";
import {
  sessionDisplayLabel,
  slotDisplayLabel,
  type SlotPresentation,
} from "../../lib/slot-presentation.ts";
import type { MacropadDeviceStatus, MacropadSession } from "../../lib/types.ts";

export type MacropadViewProps = {
  device: MacropadDeviceStatus | null;
  slots: readonly SlotPresentation[];
  sessions: readonly MacropadSession[];
  error: string | null;
  loaded: boolean;
  connected: boolean;
  canWrite: boolean;
  /** A write is in flight; controls stay visible but inert to avoid double-binds. */
  busy: boolean;
  onBind: (index: number, sessionKey: string) => void;
  onUnbind: (index: number) => void;
  onIdentify: () => void;
};

type StatusTone = "ok" | "warn" | "off";

function statusRow(
  label: string,
  value: unknown,
  options: { help?: string; tone?: StatusTone } = {},
): TemplateResult {
  return html`<div class="macropad-status__row">
    <span class="macropad-status__label">
      <span>${label}</span>
      ${options.help ? html`<span class="macropad-status__help">${options.help}</span>` : nothing}
    </span>
    <span
      class="macropad-status__value ${options.tone ? `macropad-status__value--${options.tone}` : ""}"
      >${value}</span
    >
  </div>`;
}

function renderDeviceStatus(props: MacropadViewProps): TemplateResult {
  const device = props.device;
  const connected = Boolean(device?.connected);
  // Input Monitoring is a capability flag, never a connection failure: output
  // lighting works without it, so it gets its own row rather than a red banner.
  const inputBlocked = connected && device?.inputPermissionRequired === true;
  const battery = presentBattery(device);
  return html`<div class="macropad-status">
    ${statusRow(
      t("macropad.device.connection"),
      connected
        ? html`${icons.check}<span>${t("macropad.device.connected")}</span>`
        : html`${icons.plug}<span
              >${props.connected ? t("macropad.device.disconnected") : t("macropad.state.disconnected")}</span
            >`,
      {
        tone: connected ? "ok" : "off",
        help: connected ? undefined : (device?.lastError ?? t("macropad.device.searching")),
      },
    )}
    ${
      connected && device?.product
        ? statusRow(t("macropad.device.product"), device.product)
        : nothing
    }
    ${connected && device?.serial ? statusRow(t("macropad.device.serial"), device.serial) : nothing}
    ${
      connected && device?.firmware
        ? statusRow(t("macropad.device.firmware"), device.firmware)
        : nothing
    }
    ${connected ? statusRow(t("macropad.device.keys"), String(device?.slotCount ?? 0)) : nothing}
    ${
      battery
        ? statusRow(
            t("macropad.device.battery"),
            html`${renderBatteryGlyph(battery)}<span>${battery.label}</span>`,
            {
              tone: battery.tone,
              help: battery.tone === "warn" ? t("macropad.device.batteryLow") : undefined,
            },
          )
        : nothing
    }
    ${
      connected
        ? statusRow(
            t("macropad.device.inputMonitoring"),
            inputBlocked
              ? html`${icons.shieldAlert}<span>${t("macropad.device.inputRequired")}</span>`
              : html`${icons.check}<span>${t("macropad.device.inputGranted")}</span>`,
            {
              tone: inputBlocked ? "warn" : "ok",
              help: inputBlocked ? t("macropad.device.inputHelp") : undefined,
            },
          )
        : nothing
    }
  </div>`;
}

function renderKey(props: MacropadViewProps, slot: SlotPresentation): TemplateResult {
  const label = slotDisplayLabel(slot, props.sessions);
  const disabled = !props.canWrite || props.busy || !props.connected;
  return html`<div
    class="macropad-key ${slot.bound ? "macropad-key--bound" : ""}"
    style=${`--macropad-key-swatch:${slot.swatch};--macropad-key-hue:${slot.hue}`}
  >
    <div class="macropad-key__head">
      <span class="macropad-key__number"
        >${t("macropad.keys.keyLabel", { number: slot.number })}</span
      >
      ${
        slot.pinned
          ? html`<span class="macropad-key__pin" title=${t("macropad.keys.pinnedTitle")}
              >${icons.pin}</span
            >`
          : nothing
      }
    </div>
    <div
      class="macropad-key__cap ${slot.animated ? "macropad-key__cap--animated" : ""}"
      role="img"
      aria-label=${`${t("macropad.keys.keyLabel", { number: slot.number })} — ${t(`macropad.effect.${slot.frame.effect}`)} ${slot.hue}`}
    ></div>
    <div class="macropad-key__session ${label ? "" : "macropad-key__session--empty"}">
      ${label ?? t("macropad.keys.noSession")}
    </div>
    ${
      // A dark, unbound key needs no activity caption; its emptiness is the state.
      slot.activity === "unbound"
        ? nothing
        : html`<div class="macropad-key__activity">${t(`macropad.activity.${slot.activity}`)}</div>`
    }
    <div class="macropad-key__controls">
      <select
        class="macropad-key__select"
        aria-label=${t("macropad.keys.bindTo", { number: slot.number })}
        .value=${slot.sessionKey ?? ""}
        ?disabled=${disabled}
        @change=${(event: Event) => {
          // SAFETY: Lit binds this listener only to the select element above.
          const next = (event.target as HTMLSelectElement).value;
          if (!next) {
            props.onUnbind(slot.index);
            return;
          }
          props.onBind(slot.index, next);
        }}
      >
        <option value="">${t("macropad.keys.noSession")}</option>
        ${props.sessions.map(
          (session) =>
            html`<option value=${session.key} ?selected=${session.key === slot.sessionKey}>
              ${sessionDisplayLabel(session)}
            </option>`,
        )}
      </select>
      <button
        class="macropad-key__unbind"
        type="button"
        title=${t("macropad.keys.unbind")}
        aria-label=${`${t("macropad.keys.unbind")} — ${t("macropad.keys.keyLabel", { number: slot.number })}`}
        ?disabled=${disabled || !slot.bound}
        @click=${() => props.onUnbind(slot.index)}
      >
        ${icons.x}
      </button>
    </div>
  </div>`;
}

export function renderMacropad(props: MacropadViewProps): TemplateResult {
  const hasDevice = Boolean(props.device?.connected);
  // The reference's `Codex Micro · Connected · 100%`, minus the product name
  // the page heading already carries.
  const pill = presentDevicePill(props.device, props.connected);
  const headerBattery = presentBattery(props.device);
  return html`<div class="macropad">
    ${props.error ? html`<div class="callout danger" role="alert">${props.error}</div>` : nothing}
    <section class="macropad-section">
      <div class="macropad-section__title">
        <span>${t("macropad.device.heading")}</span>
        <span class="macropad-pill macropad-pill--${pill.tone}">
          ${headerBattery ? renderBatteryGlyph(headerBattery) : nothing}
          <span>${pill.text}</span>
        </span>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          title=${t("macropad.identifyHelp")}
          ?disabled=${!hasDevice || !props.canWrite || props.busy}
          @click=${() => props.onIdentify()}
        >
          ${icons.zap}<span>${t("macropad.identify")}</span>
        </button>
      </div>
      ${renderDeviceStatus(props)}
    </section>
    <section class="macropad-section">
      <div class="macropad-section__title"><span>${t("macropad.keys.heading")}</span></div>
      ${
        hasDevice && props.slots.length > 0
          ? html`<div class="macropad-keys">
              ${props.slots.map((slot) => renderKey(props, slot))}
            </div>`
          : html`<div class="empty-state">
              ${
                !props.connected
                  ? t("macropad.state.disconnected")
                  : props.loaded
                    ? t("macropad.state.noDevice")
                    : t("macropad.state.loading")
              }
            </div>`
      }
    </section>
  </div>`;
}
