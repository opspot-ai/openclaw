import { describe, expect, it } from "vitest";
import { MACROPAD_EFFECTS, MACROPAD_SLOT_COUNT } from "../contract.js";
import { MACROPAD_SESSION_COLOR_RGB } from "./colors.js";
import {
  assertFullFrame,
  composeBlankFrame,
  composeFrame,
  framesEqual,
  renderSlotFrame,
  type MacropadFullFrame,
  type MacropadLighting,
  type MacropadSlotShadow,
} from "./frame-compositor.js";

const LIGHTING: MacropadLighting = {
  brightness: 0.8,
  idleBrightness: 0.15,
  colorThinking: 0x4c_8d_ff,
  colorAwaitingApproval: 0xff_b0_20,
  colorError: 0xff_4d_4d,
  useSessionColors: true,
};

function bound(overrides: Partial<MacropadSlotShadow> & { index: number }): MacropadSlotShadow {
  return {
    activity: "idle",
    pinned: false,
    sessionKey: `session-${overrides.index}`,
    ...overrides,
  };
}

describe("full-frame repaint", () => {
  it("emits every slot when given none", () => {
    const frame = composeFrame([], LIGHTING);

    expect(frame).toHaveLength(MACROPAD_SLOT_COUNT);
    for (const key of frame) {
      expect(key).toEqual({ color: 0x00_00_00, brightness: 0, effect: MACROPAD_EFFECTS.off });
    }
  });

  it("widens a partial update to the full frame instead of writing three keys", () => {
    // The bug this whole module exists to prevent: describing only slot 2 must
    // still produce six frames, with the other five explicitly dark.
    const frame = composeFrame([bound({ index: 2, activity: "thinking" })], LIGHTING);

    expect(frame).toHaveLength(MACROPAD_SLOT_COUNT);
    expect(frame[2]?.effect).toBe(MACROPAD_EFFECTS.shallowBreath);
    for (const index of [0, 1, 3, 4, 5]) {
      expect(frame[index]).toEqual({
        color: 0x00_00_00,
        brightness: 0,
        effect: MACROPAD_EFFECTS.off,
      });
    }
  });

  it("places slots by their index, not their array position", () => {
    const frame = composeFrame(
      [bound({ index: 5, activity: "error" }), bound({ index: 0, activity: "thinking" })],
      LIGHTING,
    );

    expect(frame[0]?.color).toBe(LIGHTING.colorThinking);
    expect(frame[5]?.color).toBe(LIGHTING.colorError);
    expect(frame[1]?.brightness).toBe(0);
  });

  it("ignores slots outside the addressable range rather than growing the frame", () => {
    // Firmware ids 6-16 acknowledge and light nothing, so a stray index must not
    // lengthen the array and shift every real key by one.
    const frame = composeFrame(
      [bound({ index: 9, activity: "error" }), bound({ index: -1, activity: "error" })],
      LIGHTING,
    );

    expect(frame).toHaveLength(MACROPAD_SLOT_COUNT);
    expect(frame.every((key) => key.effect === MACROPAD_EFFECTS.off)).toBe(true);
  });

  it("blanks the whole device on teardown", () => {
    const frame = composeBlankFrame(LIGHTING);

    expect(frame).toHaveLength(MACROPAD_SLOT_COUNT);
    expect(frame.every((key) => key.brightness === 0)).toBe(true);
  });

  it("is type-level impossible to hand a partial frame to a full-frame consumer", () => {
    const takesFullFrame = (frame: MacropadFullFrame): number => frame.length;

    const fiveKeys = [1, 2, 3, 4, 5].map(() => ({ color: 0, brightness: 0, effect: 0 }));
    const sixKeys = Array.from({ length: MACROPAD_SLOT_COUNT }, () => ({
      color: 0,
      brightness: 0,
      effect: 0,
    }));

    // @ts-expect-error a five-key array is not a MacropadFullFrame
    takesFullFrame(fiveKeys);
    // @ts-expect-error even a correctly sized array lacks the compositor's brand
    takesFullFrame(sixKeys);

    expect(takesFullFrame(composeFrame([], LIGHTING))).toBe(MACROPAD_SLOT_COUNT);
  });

  it("rejects a partial frame at runtime once the brand has been erased", () => {
    expect(() => {
      assertFullFrame([{ color: 0, brightness: 0, effect: 0 }]);
    }).toThrow(/refusing a partial frame of 1/u);
    expect(() => {
      assertFullFrame(composeFrame([], LIGHTING));
    }).not.toThrow();
  });
});

describe("activity lighting", () => {
  it("renders unbound keys fully dark", () => {
    expect(renderSlotFrame({ index: 0, activity: "unbound", pinned: false }, LIGHTING)).toEqual({
      color: 0x00_00_00,
      brightness: 0,
      effect: MACROPAD_EFFECTS.off,
    });
  });

  it("dims idle keys and leaves active keys at full brightness", () => {
    const idle = renderSlotFrame(bound({ index: 0, activity: "idle" }), LIGHTING);
    const thinking = renderSlotFrame(bound({ index: 0, activity: "thinking" }), LIGHTING);

    expect(idle.brightness).toBe(LIGHTING.idleBrightness);
    expect(idle.effect).toBe(MACROPAD_EFFECTS.solid);
    expect(thinking.brightness).toBe(LIGHTING.brightness);
    expect(thinking.effect).toBe(MACROPAD_EFFECTS.shallowBreath);
  });

  it("gives awaiting-approval its own colour and a pulse that demands attention", () => {
    const frame = renderSlotFrame(bound({ index: 0, activity: "awaiting-approval" }), LIGHTING);

    expect(frame).toEqual({
      color: LIGHTING.colorAwaitingApproval,
      brightness: LIGHTING.brightness,
      effect: MACROPAD_EFFECTS.breath,
    });
  });

  it("holds error keys steady rather than pulsing", () => {
    const frame = renderSlotFrame(bound({ index: 0, activity: "error" }), LIGHTING);

    expect(frame).toEqual({
      color: LIGHTING.colorError,
      brightness: LIGHTING.brightness,
      effect: MACROPAD_EFFECTS.solid,
    });
  });

  it("clamps out-of-range brightness from a hand-edited config", () => {
    const frame = renderSlotFrame(bound({ index: 0, activity: "thinking" }), {
      ...LIGHTING,
      brightness: 4,
    });

    expect(frame.brightness).toBe(1);
  });
});

describe("session tinting", () => {
  it("uses the session's sidebar colour for ambient states", () => {
    const slot = bound({ index: 0, activity: "thinking", sessionColor: "purple" });

    expect(renderSlotFrame(slot, LIGHTING).color).toBe(MACROPAD_SESSION_COLOR_RGB.purple);
    expect(renderSlotFrame({ ...slot, activity: "idle" }, LIGHTING).color).toBe(
      MACROPAD_SESSION_COLOR_RGB.purple,
    );
  });

  it("keeps alarm states on their status colour so they stay recognisable", () => {
    // A session tinted pink must not turn its approval key pink; the operator
    // reads colour, not slot position, to know a key needs them.
    const slot = bound({ index: 0, activity: "awaiting-approval", sessionColor: "pink" });

    expect(renderSlotFrame(slot, LIGHTING).color).toBe(LIGHTING.colorAwaitingApproval);
    expect(renderSlotFrame({ ...slot, activity: "error" }, LIGHTING).color).toBe(
      LIGHTING.colorError,
    );
  });

  it("falls back to the status colour when tinting is off", () => {
    const slot = bound({ index: 0, activity: "thinking", sessionColor: "green" });

    expect(renderSlotFrame(slot, { ...LIGHTING, useSessionColors: false }).color).toBe(
      LIGHTING.colorThinking,
    );
  });

  it("falls back when the session carries a tint this build does not know", () => {
    const slot = bound({ index: 0, activity: "thinking", sessionColor: "chartreuse" });

    expect(renderSlotFrame(slot, LIGHTING).color).toBe(LIGHTING.colorThinking);
  });
});

describe("framesEqual", () => {
  it("lets the repaint loop skip an unchanged frame", () => {
    const slots = [bound({ index: 1, activity: "thinking" })];

    expect(framesEqual(composeFrame(slots, LIGHTING), composeFrame(slots, LIGHTING))).toBe(true);
  });

  it("detects a change in any single key", () => {
    const before = composeFrame([bound({ index: 1, activity: "thinking" })], LIGHTING);
    const after = composeFrame([bound({ index: 1, activity: "error" })], LIGHTING);

    expect(framesEqual(before, after)).toBe(false);
  });

  it("treats differently sized frames as unequal", () => {
    expect(framesEqual(composeFrame([], LIGHTING), [])).toBe(false);
  });
});
