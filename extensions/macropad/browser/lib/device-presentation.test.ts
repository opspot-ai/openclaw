import { describe, expect, it } from "vitest";
import { createDeviceStatus } from "../test/fixtures.ts";
import {
  batteryFill,
  MACROPAD_LOW_BATTERY_PERCENT,
  navIconForDevice,
  presentBattery,
  presentDevicePill,
} from "./device-presentation.ts";

describe("presentBattery", () => {
  it("reports a percentage the device sends", () => {
    expect(presentBattery(createDeviceStatus({ batteryPercent: 100 }))).toEqual({
      percent: 100,
      charging: false,
      label: "100%",
      tone: "ok",
    });
  });

  it("treats a zero reading as real rather than absent", () => {
    expect(presentBattery(createDeviceStatus({ batteryPercent: 0 }))?.percent).toBe(0);
    expect(presentBattery(createDeviceStatus({ batteryPercent: 0 }))?.tone).toBe("warn");
  });

  it("returns nothing when the device reports no battery", () => {
    expect(presentBattery(createDeviceStatus())).toBeNull();
    expect(presentBattery(null)).toBeNull();
  });

  it("returns nothing for a disconnected device, whatever it last reported", () => {
    expect(presentBattery(createDeviceStatus({ connected: false, batteryPercent: 80 }))).toBeNull();
  });

  it("warns at or below the low threshold", () => {
    expect(
      presentBattery(createDeviceStatus({ batteryPercent: MACROPAD_LOW_BATTERY_PERCENT }))?.tone,
    ).toBe("warn");
    expect(
      presentBattery(createDeviceStatus({ batteryPercent: MACROPAD_LOW_BATTERY_PERCENT + 1 }))
        ?.tone,
    ).toBe("ok");
  });

  it("does not warn while charging, because the level is recovering", () => {
    const battery = presentBattery(createDeviceStatus({ batteryPercent: 5, charging: true }));
    expect(battery?.tone).toBe("ok");
    expect(battery?.label).toBe("5% · Charging");
  });

  it("clamps and rounds a value outside the reportable range", () => {
    expect(presentBattery(createDeviceStatus({ batteryPercent: 140 }))?.percent).toBe(100);
    expect(presentBattery(createDeviceStatus({ batteryPercent: -5 }))?.percent).toBe(0);
  });
});

describe("batteryFill", () => {
  it("maps percent onto a 0..1 fill", () => {
    expect(batteryFill(0)).toBe(0);
    expect(batteryFill(50)).toBe(0.5);
    expect(batteryFill(100)).toBe(1);
    expect(batteryFill(250)).toBe(1);
  });
});

describe("presentDevicePill", () => {
  it("reads as the reference's status line when the device reports a battery", () => {
    expect(presentDevicePill(createDeviceStatus({ batteryPercent: 100 }), true)).toEqual({
      text: "Connected · 100%",
      tone: "ok",
    });
  });

  it("omits the battery clause when the device reports none", () => {
    expect(presentDevicePill(createDeviceStatus(), true)).toEqual({
      text: "Connected",
      tone: "ok",
    });
  });

  it("carries a low battery through to the pill's tone", () => {
    expect(presentDevicePill(createDeviceStatus({ batteryPercent: 4 }), true).tone).toBe("warn");
  });

  it("distinguishes a missing device from a missing Gateway", () => {
    expect(presentDevicePill(createDeviceStatus({ connected: false }), true)).toEqual({
      text: "Not connected",
      tone: "off",
    });
    expect(presentDevicePill(createDeviceStatus(), false)).toEqual({
      text: "Connect to the Gateway to reach the macropad.",
      tone: "off",
    });
  });
});

describe("navIconForDevice", () => {
  it("shows a keypad when the device is usable", () => {
    expect(navIconForDevice(createDeviceStatus(), true)).toBe("layoutGrid");
  });

  it("shows a plug when there is no device or no Gateway", () => {
    expect(navIconForDevice(null, true)).toBe("plug");
    expect(navIconForDevice(createDeviceStatus({ connected: false }), true)).toBe("plug");
    expect(navIconForDevice(createDeviceStatus(), false)).toBe("plug");
  });

  it("flags a lapsed Input Monitoring grant in the sidebar", () => {
    expect(navIconForDevice(createDeviceStatus({ inputPermissionRequired: true }), true)).toBe(
      "shieldAlert",
    );
  });

  it("ignores the battery level, which must not churn the registration", () => {
    expect(navIconForDevice(createDeviceStatus({ batteryPercent: 3 }), true)).toBe("layoutGrid");
  });
});
