/**
 * Lighting frame-model unit tests. NO DEVICE REQUIRED.
 *
 * The point of these is the full-frame-repaint trap: prove that the API cannot
 * express a partial update, and that what goes on the wire is always six keys.
 *
 * Ported from the proving spike, plus coverage for `fullFrameToParams`, which
 * is the new joint between the plugin's branded `MacropadFullFrame` and this
 * firmware's `v.oai.thstatus` params.
 */
import { describe, expect, it } from "vitest";
import { MACROPAD_EFFECTS } from "../../../contract.js";
import { composeBlankFrame, composeFrame, type MacropadLighting } from "../../frame-compositor.js";
import {
  AGENT_KEY_COUNT,
  ALL_OFF,
  frameFromColors,
  frameToParams,
  fullFrameToParams,
  type KeyFrame,
  LightingError,
  NEUTRAL,
  rgb,
  uniformFrame,
  validateFrame,
  withKey,
} from "./lighting.js";

const LIGHTING: MacropadLighting = {
  brightness: 0.8,
  idleBrightness: 0.2,
  colorThinking: 0x44_88_ff,
  colorAwaitingApproval: 0xff_aa_00,
  colorError: 0xff_00_00,
  useSessionColors: false,
};

describe("colour packing", () => {
  it("packs channels into a single 0xRRGGBB int", () => {
    expect(rgb(0xff, 0x00, 0x00)).toBe(0xff_00_00);
    expect(rgb(0x00, 0xff, 0x00)).toBe(0x00_ff_00);
    expect(rgb(0x12, 0x34, 0x56)).toBe(0x12_34_56);
  });
});

describe("frame construction", () => {
  it("produces exactly six independent key states from uniformFrame", () => {
    const frame = uniformFrame({
      color: 0x00_ff_00,
      brightness: 0.5,
      effect: MACROPAD_EFFECTS.solid,
    });
    expect(frame).toHaveLength(AGENT_KEY_COUNT);
    // Must not alias one object six times, or mutating one key would change all.
    expect(frame[0]).not.toBe(frame[1]);
  });

  it("maps six colours onto six keys with frameFromColors", () => {
    const frame = frameFromColors([0x1, 0x2, 0x3, 0x4, 0x5, 0x6], { brightness: 0.8 });
    expect(frame.map((key) => key.color)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(frame.every((key) => key.brightness === 0.8)).toBe(true);
  });

  it("keeps ALL_OFF and NEUTRAL valid six-key frames", () => {
    validateFrame(ALL_OFF);
    validateFrame(NEUTRAL);
    expect(frameToParams(ALL_OFF)).toHaveLength(6);
  });
});

describe("the full-frame repaint trap", () => {
  it("ACCEPTANCE: always carries all six ids 0..5, in order", () => {
    const params = frameToParams(
      uniformFrame({ color: 0xff_00_ff, brightness: 1, effect: MACROPAD_EFFECTS.solid }),
    );
    expect(params).toHaveLength(6);
    expect(params.map((param) => param.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("emits the exact vendor wire keys {id,c,b,e,s,sk,sa}", () => {
    const params = frameToParams(
      uniformFrame({
        color: 0x00_ff_88,
        brightness: 0.6,
        effect: MACROPAD_EFFECTS.breath,
        speed: 0.25,
      }),
    );
    expect(params[0]).toEqual({
      id: 0,
      c: 0x00_ff_88,
      b: 0.6,
      e: MACROPAD_EFFECTS.breath,
      s: 0.25,
      sk: 0,
      sa: 0,
    });
  });

  it("defaults optional speed/sk/sa to 0 rather than omitting them", () => {
    const param = frameToParams(ALL_OFF)[0]!;
    expect(param.s).toBe(0);
    expect(param.sk).toBe(0);
    expect(param.sa).toBe(0);
  });

  it("ACCEPTANCE: rejects a partial frame with a message naming the repaint semantics", () => {
    const partial = [
      { color: 0xff_00_00, brightness: 1, effect: MACROPAD_EFFECTS.solid },
      { color: 0x00_ff_00, brightness: 1, effect: MACROPAD_EFFECTS.solid },
    ] as unknown as KeyFrame;

    expect(() => validateFrame(partial)).toThrow(LightingError);
    expect(() => validateFrame(partial)).toThrow(/full-frame repaint/);
    expect(() => validateFrame(partial)).toThrow(/NOT preserved/);
  });

  it("rejects an over-long frame too", () => {
    const seven = [...uniformFrame(NEUTRAL[0]), { ...NEUTRAL[0] }] as unknown as KeyFrame;
    expect(() => validateFrame(seven)).toThrow(LightingError);
  });

  it("returns a COMPLETE frame from withKey, so one changed key still repaints all six", () => {
    const base = uniformFrame({
      color: 0x00_00_00,
      brightness: 0.2,
      effect: MACROPAD_EFFECTS.solid,
    });
    const next = withKey(base, 3, {
      color: 0xff_00_00,
      brightness: 1,
      effect: MACROPAD_EFFECTS.solid,
    });

    expect(next).toHaveLength(AGENT_KEY_COUNT);
    expect(next[3]!.color).toBe(0xff_00_00);
    // The other five must retain their previous state, not go dark.
    for (const index of [0, 1, 2, 4, 5]) {
      expect(next[index]!.color).toBe(0x00_00_00);
      expect(next[index]!.brightness).toBe(0.2);
    }
    expect(frameToParams(next)).toHaveLength(6);
  });

  it("does not mutate the frame withKey was given", () => {
    const base = uniformFrame({
      color: 0x11_11_11,
      brightness: 0.3,
      effect: MACROPAD_EFFECTS.solid,
    });
    withKey(base, 0, { color: 0xff_ff_ff, brightness: 1, effect: MACROPAD_EFFECTS.solid });
    expect(base[0]!.color, "input frame must be untouched").toBe(0x11_11_11);
  });

  it("rejects ids outside the six Agent Keys", () => {
    expect(() => withKey(ALL_OFF, 6, NEUTRAL[0])).toThrow(RangeError);
    expect(() => withKey(ALL_OFF, -1, NEUTRAL[0])).toThrow(RangeError);
    expect(() => withKey(ALL_OFF, 1.5, NEUTRAL[0])).toThrow(RangeError);
  });
});

describe("validation", () => {
  it("rejects out-of-range brightness and speed", () => {
    expect(() =>
      validateFrame(uniformFrame({ color: 0, brightness: 1.5, effect: MACROPAD_EFFECTS.solid })),
    ).toThrow(/brightness/);
    expect(() =>
      validateFrame(
        uniformFrame({ color: 0, brightness: 1, effect: MACROPAD_EFFECTS.solid, speed: 9 }),
      ),
    ).toThrow(/speed/);
  });

  it("rejects an out-of-range colour", () => {
    expect(() =>
      validateFrame(
        uniformFrame({ color: 0x1_00_00_00, brightness: 1, effect: MACROPAD_EFFECTS.solid }),
      ),
    ).toThrow(/packed RGB/);
  });

  it("rejects an unknown effect code", () => {
    expect(() =>
      validateFrame(uniformFrame({ color: 0, brightness: 1, effect: 99 as never })),
    ).toThrow(/unknown effect/);
  });

  it("validates every documented effect code", () => {
    for (const effect of Object.values(MACROPAD_EFFECTS)) {
      validateFrame(uniformFrame({ color: 0x01_02_03, brightness: 0.5, effect }));
    }
  });
});

describe("fullFrameToParams", () => {
  it("serialises a composed frame into six ordered params", () => {
    const frame = composeFrame(
      [
        { index: 0, activity: "thinking", pinned: false, sessionKey: "a" },
        { index: 4, activity: "awaiting-approval", pinned: true, sessionKey: "b" },
      ],
      LIGHTING,
    );
    const params = fullFrameToParams(frame);

    expect(params).toHaveLength(AGENT_KEY_COUNT);
    expect(params.map((param) => param.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(params[0]!.c).toBe(LIGHTING.colorThinking);
    expect(params[0]!.e).toBe(MACROPAD_EFFECTS.shallowBreath);
    expect(params[4]!.c).toBe(LIGHTING.colorAwaitingApproval);
    expect(params[4]!.e).toBe(MACROPAD_EFFECTS.breath);
  });

  it("ACCEPTANCE: emits the three unbound keys as explicitly dark, never as omissions", () => {
    // The whole reason `composeFrame` walks every slot: an omitted id is not
    // "unchanged" on this firmware, it is dark. Proving the dark keys are
    // PRESENT in the params is proving the repaint is complete.
    const frame = composeFrame(
      [{ index: 2, activity: "thinking", pinned: false, sessionKey: "only" }],
      LIGHTING,
    );
    const params = fullFrameToParams(frame);

    expect(params).toHaveLength(AGENT_KEY_COUNT);
    for (const index of [0, 1, 3, 4, 5]) {
      expect(params[index]!.b).toBe(0);
      expect(params[index]!.e).toBe(MACROPAD_EFFECTS.off);
    }
    expect(params[2]!.b).toBe(LIGHTING.brightness);
  });

  it("serialises the teardown blank frame as six dark keys", () => {
    const params = fullFrameToParams(composeBlankFrame(LIGHTING));
    expect(params).toHaveLength(AGENT_KEY_COUNT);
    expect(params.every((param) => param.b === 0 && param.e === MACROPAD_EFFECTS.off)).toBe(true);
  });

  it("refuses a partial frame that reached the seam with its brand stripped", () => {
    // The brand cannot survive a JSON round-trip or a plugin boundary, so the
    // runtime backstop has to hold on its own.
    const partial = [
      { color: 0, brightness: 0, effect: MACROPAD_EFFECTS.off },
    ] as unknown as Parameters<typeof fullFrameToParams>[0];
    expect(() => fullFrameToParams(partial)).toThrow(/refusing a partial frame/);
  });
});
