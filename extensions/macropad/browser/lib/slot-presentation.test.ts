import { describe, expect, it } from "vitest";
import { MACROPAD_SLOT_COUNT } from "../../contract.ts";
import { createDeviceStatus, createSlot } from "../test/fixtures.ts";
import {
  applyBrightness,
  formatSlotColor,
  mirrorWidth,
  presentSlots,
  sessionDisplayLabel,
  slotDisplayLabel,
} from "./slot-presentation.ts";

describe("formatSlotColor", () => {
  it("pads packed integers to six hex digits", () => {
    expect(formatSlotColor(0x00_00_ff)).toBe("#0000ff");
    expect(formatSlotColor(0xff_b0_20)).toBe("#ffb020");
    expect(formatSlotColor(0)).toBe("#000000");
  });

  it("clamps values outside the device's 24-bit range", () => {
    expect(formatSlotColor(-1)).toBe("#000000");
    expect(formatSlotColor(0x1_00_00_00)).toBe("#ffffff");
  });
});

describe("applyBrightness", () => {
  it("dims each channel so an idle key does not read as a working one", () => {
    expect(applyBrightness(0xff_ff_ff, 1)).toBe("#ffffff");
    expect(applyBrightness(0xff_ff_ff, 0.5)).toBe("#808080");
    expect(applyBrightness(0xff_ff_ff, 0)).toBe("#000000");
  });

  it("keeps channels independent", () => {
    expect(applyBrightness(0x40_80_c0, 0.5)).toBe("#204060");
  });

  it("clamps brightness rather than overflowing a channel", () => {
    expect(applyBrightness(0x80_80_80, 5)).toBe("#808080");
    expect(applyBrightness(0x80_80_80, -1)).toBe("#000000");
  });
});

describe("presentSlots", () => {
  it("fills the mirror to full width when the backend reports nothing", () => {
    const slots = presentSlots([], MACROPAD_SLOT_COUNT);
    expect(slots).toHaveLength(MACROPAD_SLOT_COUNT);
    expect(slots.map((slot) => slot.activity)).toEqual(Array(MACROPAD_SLOT_COUNT).fill("unbound"));
    expect(slots.every((slot) => slot.swatch === "#000000" && !slot.bound)).toBe(true);
  });

  it("numbers keys from one for humans while keeping zero-based indexes", () => {
    const slots = presentSlots([], 3);
    expect(slots.map((slot) => [slot.index, slot.number])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("places sparse slots at their own index rather than in arrival order", () => {
    const slots = presentSlots([createSlot(4, { sessionKey: "agent:main:chat:x" })], 6);
    expect(slots[4]?.bound).toBe(true);
    expect(slots[4]?.sessionKey).toBe("agent:main:chat:x");
    expect(slots[0]?.bound).toBe(false);
  });

  it("marks animated firmware effects and leaves solid ones still", () => {
    const animated = presentSlots([
      createSlot(0, { frame: { color: 1, brightness: 1, effect: 4 } }),
    ]);
    const solid = presentSlots([createSlot(0, { frame: { color: 1, brightness: 1, effect: 1 } })]);
    expect(animated[0]?.animated).toBe(true);
    expect(solid[0]?.animated).toBe(false);
  });

  it("never renders more keys than the contract allows", () => {
    expect(presentSlots([], 99)).toHaveLength(MACROPAD_SLOT_COUNT);
    expect(presentSlots([], -1)).toHaveLength(0);
  });

  it("reports the undimmed hue alongside the dimmed swatch", () => {
    const [slot] = presentSlots([
      createSlot(0, { frame: { color: 0xff_00_00, brightness: 0.25, effect: 1 } }),
    ]);
    expect(slot?.hue).toBe("#ff0000");
    expect(slot?.swatch).toBe("#400000");
  });
});

describe("mirrorWidth", () => {
  it("falls back to the contract slot count with no device", () => {
    expect(mirrorWidth(null)).toBe(MACROPAD_SLOT_COUNT);
    expect(mirrorWidth(createDeviceStatus({ connected: false }))).toBe(MACROPAD_SLOT_COUNT);
  });

  it("follows a connected device that exposes fewer keys", () => {
    expect(mirrorWidth(createDeviceStatus({ slotCount: 4 }))).toBe(4);
    expect(mirrorWidth(createDeviceStatus({ slotCount: 0 }))).toBe(0);
  });

  it("caps a device that claims more keys than the contract models", () => {
    expect(mirrorWidth(createDeviceStatus({ slotCount: 16 }))).toBe(MACROPAD_SLOT_COUNT);
  });
});

describe("session labels", () => {
  it("prefers an explicit label, then derived and display names, then the key", () => {
    expect(sessionDisplayLabel({ key: "k", label: "Deploy", derivedTitle: "Other" })).toBe(
      "Deploy",
    );
    expect(sessionDisplayLabel({ key: "k", derivedTitle: "Derived" })).toBe("Derived");
    expect(sessionDisplayLabel({ key: "k", displayName: "Shown" })).toBe("Shown");
    expect(sessionDisplayLabel({ key: "agent:main:chat:1" })).toBe("agent:main:chat:1");
  });

  it("ignores whitespace-only titles", () => {
    expect(sessionDisplayLabel({ key: "k", label: "   ", derivedTitle: "Derived" })).toBe(
      "Derived",
    );
  });

  it("lets the backend label win over the live session row", () => {
    const [slot] = presentSlots([createSlot(0, { sessionKey: "k", label: "Backend label" })]);
    expect(slotDisplayLabel(slot!, [{ key: "k", label: "Row label" }])).toBe("Backend label");
  });

  it("falls back to the session row, then to the raw key", () => {
    const [bound] = presentSlots([createSlot(0, { sessionKey: "k" })]);
    expect(slotDisplayLabel(bound!, [{ key: "k", label: "Row label" }])).toBe("Row label");
    expect(slotDisplayLabel(bound!, [])).toBe("k");
  });

  it("returns nothing for an unbound key", () => {
    const [unbound] = presentSlots([]);
    expect(slotDisplayLabel(unbound!, [])).toBeUndefined();
  });
});
