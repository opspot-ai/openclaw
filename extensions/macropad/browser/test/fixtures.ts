import { MACROPAD_SLOT_COUNT } from "../../contract.ts";
import type { MacropadDeviceStatus, MacropadSlot } from "../lib/types.ts";

export function createDeviceStatus(
  overrides: Partial<MacropadDeviceStatus> = {},
): MacropadDeviceStatus {
  return {
    connected: true,
    serial: "441BF6D10AB4",
    firmware: "0.6.0",
    product: "Codex Micro",
    slotCount: MACROPAD_SLOT_COUNT,
    inputPermissionRequired: false,
    ...overrides,
  };
}

export function createSlot(index: number, overrides: Partial<MacropadSlot> = {}): MacropadSlot {
  return {
    index,
    activity: "idle",
    frame: { color: 0x4c_8d_ff, brightness: 0.8, effect: 1 },
    pinned: false,
    ...overrides,
  };
}

/** A full board of bound sessions, `pinned` deciding whether it may be evicted. */
export function createFullSlots(pinned: boolean): MacropadSlot[] {
  return Array.from({ length: MACROPAD_SLOT_COUNT }, (_, index) =>
    createSlot(index, { sessionKey: `agent:main:chat:${index}`, pinned }),
  );
}
