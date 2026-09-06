/**
 * Pure presentation for the key mirror. No DOM, no host, no network: the
 * mirror has to be reviewable and testable with no device attached, because CI
 * never has one.
 */
import { MACROPAD_SLOT_COUNT } from "../../contract.ts";
import type {
  MacropadDeviceStatus,
  MacropadKeyFrame,
  MacropadSession,
  MacropadSlot,
  MacropadSlotActivity,
} from "./types.ts";

/** Firmware effect ids that animate. A still swatch would misreport these. */
const ANIMATED_EFFECTS = new Set([2, 3, 4, 5, 6]);

const DARK_FRAME: MacropadKeyFrame = { color: 0x00_00_00, brightness: 0, effect: 0 };

export type SlotPresentation = {
  index: number;
  /** One-based, for humans. Key ids stay zero-based everywhere else. */
  number: number;
  activity: MacropadSlotActivity;
  bound: boolean;
  pinned: boolean;
  animated: boolean;
  sessionKey?: string;
  agentId?: string;
  label?: string;
  /** `#rrggbb`, already dimmed by the frame's brightness. */
  swatch: string;
  /** Undimmed hue, for borders and focus rings that must stay legible. */
  hue: string;
  frame: MacropadKeyFrame;
};

/** Packed 0xRRGGBB to CSS. The device takes one integer, browsers do not. */
export function formatSlotColor(color: number): string {
  const clamped = Math.max(0, Math.min(0xff_ff_ff, Math.trunc(color)));
  return `#${clamped.toString(16).padStart(6, "0")}`;
}

/**
 * Apply brightness to a colour for display.
 *
 * The device dims by driving the LED, so a swatch that ignores `brightness`
 * would show an idle key as bright as a working one — the exact distinction
 * the mirror exists to make.
 */
export function applyBrightness(color: number, brightness: number): string {
  const scale = Math.max(0, Math.min(1, brightness));
  const channel = (shift: number) =>
    Math.round(((Math.trunc(color) >> shift) & 0xff) * scale) & 0xff;
  return formatSlotColor((channel(16) << 16) | (channel(8) << 8) | channel(0));
}

/**
 * Expand the backend's sparse slot list into a fixed-width mirror.
 *
 * The device repaints full frames and the contract allows a short list, so the
 * page must render every physical key even when the backend reports none.
 */
export function presentSlots(
  slots: readonly MacropadSlot[],
  slotCount = MACROPAD_SLOT_COUNT,
): SlotPresentation[] {
  const width = Math.max(0, Math.min(MACROPAD_SLOT_COUNT, Math.trunc(slotCount)));
  const byIndex = new Map(slots.map((slot) => [slot.index, slot]));
  return Array.from({ length: width }, (_, index) => {
    const slot = byIndex.get(index);
    const frame = slot?.frame ?? DARK_FRAME;
    return {
      index,
      number: index + 1,
      activity: slot?.activity ?? "unbound",
      bound: Boolean(slot?.sessionKey),
      pinned: slot?.pinned ?? false,
      animated: ANIMATED_EFFECTS.has(frame.effect),
      sessionKey: slot?.sessionKey,
      agentId: slot?.agentId,
      label: slot?.label,
      swatch: applyBrightness(frame.color, frame.brightness),
      hue: formatSlotColor(frame.color),
      frame,
    };
  });
}

/** Slot count to mirror: what the device reports, falling back to the contract. */
export function mirrorWidth(device: MacropadDeviceStatus | null): number {
  if (!device?.connected) {
    return MACROPAD_SLOT_COUNT;
  }
  return device.slotCount > 0 ? Math.min(device.slotCount, MACROPAD_SLOT_COUNT) : 0;
}

/** Best human name for a session, falling back through the row's title fields. */
export function sessionDisplayLabel(session: MacropadSession): string {
  return (
    session.label?.trim() ||
    session.derivedTitle?.trim() ||
    session.displayName?.trim() ||
    session.key
  );
}

/** Name shown on a key: the backend's label wins, then the live session row. */
export function slotDisplayLabel(
  slot: SlotPresentation,
  sessions: readonly MacropadSession[],
): string | undefined {
  if (slot.label?.trim()) {
    return slot.label.trim();
  }
  if (!slot.sessionKey) {
    return undefined;
  }
  const session = sessions.find((row) => row.key === slot.sessionKey);
  return session ? sessionDisplayLabel(session) : slot.sessionKey;
}
