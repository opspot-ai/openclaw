import { describe, expect, it } from "vitest";
import { resolveMacropadConfig } from "./config.js";

describe("resolveMacropadConfig", () => {
  it("matches the manifest defaults when nothing is configured", () => {
    expect(resolveMacropadConfig(undefined)).toEqual({
      enabled: true,
      autoBind: true,
      resyncIntervalMs: 10_000,
      lighting: {
        brightness: 0.8,
        idleBrightness: 0.15,
        colorThinking: 0x4c_8d_ff,
        colorAwaitingApproval: 0xff_b0_20,
        colorError: 0xff_4d_4d,
        useSessionColors: true,
      },
    });
  });

  it("reads a fully specified config", () => {
    const config = resolveMacropadConfig({
      enabled: false,
      deviceSerial: "CM2-1234",
      autoBind: false,
      brightness: 0.5,
      idleBrightness: 0.05,
      resyncIntervalSeconds: 30,
      colorThinking: "#112233",
      colorAwaitingApproval: "#445566",
      colorError: "#778899",
      useSessionColors: false,
    });

    expect(config).toEqual({
      enabled: false,
      deviceSerial: "CM2-1234",
      autoBind: false,
      resyncIntervalMs: 30_000,
      lighting: {
        brightness: 0.5,
        idleBrightness: 0.05,
        colorThinking: 0x11_22_33,
        colorAwaitingApproval: 0x44_55_66,
        colorError: 0x77_88_99,
        useSessionColors: false,
      },
    });
  });

  it("clamps a resync interval outside the manifest's bounds", () => {
    // A zero-second resync would hammer USB; a ten-minute one would leave drift
    // visible for minutes. Both are clamped rather than rejected.
    expect(resolveMacropadConfig({ resyncIntervalSeconds: 0 }).resyncIntervalMs).toBe(1_000);
    expect(resolveMacropadConfig({ resyncIntervalSeconds: 9_999 }).resyncIntervalMs).toBe(120_000);
  });

  it("clamps brightness values a hand-edited config put out of range", () => {
    const config = resolveMacropadConfig({ brightness: 5, idleBrightness: -2 });

    expect(config.lighting.brightness).toBe(1);
    expect(config.lighting.idleBrightness).toBe(0);
  });

  it("falls back to the default colour when a hex string is malformed", () => {
    expect(resolveMacropadConfig({ colorError: "not-a-colour" }).lighting.colorError).toBe(
      0xff_4d_4d,
    );
  });

  it("treats a blank device serial as auto-detect", () => {
    expect(resolveMacropadConfig({ deviceSerial: "   " }).deviceSerial).toBeUndefined();
    expect(resolveMacropadConfig({ deviceSerial: " CM2-9 " }).deviceSerial).toBe("CM2-9");
  });

  it("ignores values of the wrong type instead of throwing", () => {
    const config = resolveMacropadConfig({
      enabled: "yes",
      autoBind: 1,
      brightness: "bright",
      resyncIntervalSeconds: "soon",
      useSessionColors: null,
    });

    expect(config).toMatchObject({
      enabled: true,
      autoBind: true,
      resyncIntervalMs: 10_000,
    });
    expect(config.lighting.brightness).toBe(0.8);
    expect(config.lighting.useSessionColors).toBe(true);
  });

  it("survives a non-object config", () => {
    expect(resolveMacropadConfig("nonsense").enabled).toBe(true);
    expect(resolveMacropadConfig(null).enabled).toBe(true);
  });
});
