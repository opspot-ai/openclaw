import { describe, expect, it } from "vitest";
import {
  clampBrightness,
  MACROPAD_SESSION_COLOR_IDS,
  MACROPAD_SESSION_COLOR_RGB,
  parseHexColor,
  resolveSessionColor,
} from "./colors.js";

describe("parseHexColor", () => {
  it("packs a #RRGGBB string into a single integer", () => {
    expect(parseHexColor("#4C8DFF")).toBe(0x4c_8d_ff);
    expect(parseHexColor("4c8dff")).toBe(0x4c_8d_ff);
    expect(parseHexColor("  #FFFFFF  ")).toBe(0xff_ff_ff);
    expect(parseHexColor("#000000")).toBe(0);
  });

  it("returns undefined rather than throwing on anything malformed", () => {
    // Colours come from user config; one bad string must degrade to a default,
    // not take the device down.
    for (const value of ["#fff", "#12345g", "blue", "", "#1234567", undefined]) {
      expect(parseHexColor(value)).toBeUndefined();
    }
  });
});

describe("resolveSessionColor", () => {
  it("resolves every named sidebar tint", () => {
    for (const id of MACROPAD_SESSION_COLOR_IDS) {
      expect(resolveSessionColor(id)).toBe(MACROPAD_SESSION_COLOR_RGB[id]);
    }
  });

  it("normalises case and surrounding whitespace", () => {
    expect(resolveSessionColor("  PURPLE ")).toBe(MACROPAD_SESSION_COLOR_RGB.purple);
  });

  it("returns undefined for a tint this build does not know", () => {
    expect(resolveSessionColor("chartreuse")).toBeUndefined();
    expect(resolveSessionColor(undefined)).toBeUndefined();
    expect(resolveSessionColor("")).toBeUndefined();
  });

  it("covers exactly the eight ids core defines", () => {
    // Pins the local copy of SESSION_COLOR_IDS: a ninth tint upstream should
    // show up here as a failing count, not as a silently dark key.
    expect([...MACROPAD_SESSION_COLOR_IDS]).toEqual([
      "red",
      "blue",
      "green",
      "yellow",
      "purple",
      "orange",
      "pink",
      "cyan",
    ]);
    expect(Object.keys(MACROPAD_SESSION_COLOR_RGB)).toHaveLength(MACROPAD_SESSION_COLOR_IDS.length);
  });

  it("keeps every tint inside the device's 24-bit colour range", () => {
    for (const value of Object.values(MACROPAD_SESSION_COLOR_RGB)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xff_ff_ff);
    }
  });
});

describe("clampBrightness", () => {
  it("passes through in-range values", () => {
    expect(clampBrightness(0)).toBe(0);
    expect(clampBrightness(0.42)).toBe(0.42);
    expect(clampBrightness(1)).toBe(1);
  });

  it("clamps out-of-range values", () => {
    expect(clampBrightness(-3)).toBe(0);
    expect(clampBrightness(7)).toBe(1);
  });

  it("treats a non-finite value as dark", () => {
    expect(clampBrightness(Number.NaN)).toBe(0);
    expect(clampBrightness(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
