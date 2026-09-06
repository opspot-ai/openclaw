/**
 * Pure device-header presentation: battery, the compact connection pill, and
 * the navigation icon. Kept free of DOM and host so the reference's
 * "Connected · 100%" line is testable with no device attached.
 */
import { t } from "../i18n/index.ts";
import type { MacropadDeviceStatus } from "./types.ts";

/** Below this the battery reads as a warning rather than a neutral fact. */
export const MACROPAD_LOW_BATTERY_PERCENT = 20;

export type BatteryPresentation = {
  percent: number;
  charging: boolean;
  /** `100%`, or `100% · Charging` while on power. */
  label: string;
  tone: "ok" | "warn";
};

/**
 * Battery is optional in the contract: older firmware and non-Micro devices
 * report none, and `0` is a real reading rather than an absent one.
 */
export function presentBattery(device: MacropadDeviceStatus | null): BatteryPresentation | null {
  if (!device?.connected || typeof device.batteryPercent !== "number") {
    return null;
  }
  const percent = Math.max(0, Math.min(100, Math.round(device.batteryPercent)));
  const charging = device.charging === true;
  return {
    percent,
    charging,
    label: charging ? `${percent}% · ${t("macropad.device.charging")}` : `${percent}%`,
    // Charging means the level is recovering, so a low reading is not a warning.
    tone: !charging && percent <= MACROPAD_LOW_BATTERY_PERCENT ? "warn" : "ok",
  };
}

/** Fill fraction for the battery glyph, 0..1. */
export function batteryFill(percent: number): number {
  return Math.max(0, Math.min(100, percent)) / 100;
}

export type DevicePill = { text: string; tone: "ok" | "warn" | "off" };

/**
 * The reference's status pill, as one line.
 *
 * Colton pointed at `Codex Micro · Connected · 100%`; the product name is
 * already the page heading, so the pill carries the two live facts.
 */
export function presentDevicePill(
  device: MacropadDeviceStatus | null,
  connected: boolean,
): DevicePill {
  if (!connected) {
    return { text: t("macropad.state.disconnected"), tone: "off" };
  }
  if (!device?.connected) {
    return { text: t("macropad.device.disconnected"), tone: "off" };
  }
  const battery = presentBattery(device);
  const text = battery
    ? `${t("macropad.device.connected")} · ${battery.label}`
    : t("macropad.device.connected");
  return { text, tone: battery?.tone === "warn" ? "warn" : "ok" };
}

/**
 * Navigation icon.
 *
 * A nav entry renders exactly one icon and one text span with no badge slot, so
 * the icon is the only live signal the sidebar can carry. It changes only on a
 * real state transition — never per battery percent, which would re-register
 * the entry on every reading.
 */
export function navIconForDevice(
  device: MacropadDeviceStatus | null,
  connected: boolean,
): "layoutGrid" | "plug" | "shieldAlert" {
  if (!connected || !device?.connected) {
    return "plug";
  }
  return device.inputPermissionRequired ? "shieldAlert" : "layoutGrid";
}
