/**
 * Safety-allowlist and status-parsing tests. NO DEVICE REQUIRED.
 *
 * These are device-free because `hid-darwin.ts` resolves its IOKit symbols
 * lazily: constructing a transport touches no native code, and the allowlist is
 * checked BEFORE the "is the device open?" guard precisely so that a forbidden
 * method is unreachable whether or not hardware is attached.
 *
 * This is the ported version of the spike's `demo-roundtrip.ts` safety
 * assertion, which needed a device to run. Being device-free is the point: a
 * regression that opened `sys.bootloader` must fail CI, not wait for someone to
 * plug a macropad in.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_METHODS,
  CODEX_MICRO_PRODUCT_ID,
  CODEX_MICRO_VENDOR_ID,
  CodexMicroTransport,
  ForbiddenMethodError,
  parseDeviceStatus,
} from "./rpc-transport.js";

/**
 * Everything on this channel that can brick, reflash, or rewrite the device.
 * If a future edit widens `ALLOWED_METHODS`, this list is what catches it.
 */
const DESTRUCTIVE_METHODS = [
  "sys.bootloader",
  "sys.selftest",
  "sys.reset",
  "fs.write",
  "fs.read",
  "fs.remove",
  "wl_device_programmer.start",
  "wl_device_programmer.write",
  "wl_device_programmer.finish",
];

describe("safety allowlist", () => {
  it("permits exactly the four methods this plugin needs, and nothing else", () => {
    expect([...ALLOWED_METHODS].toSorted()).toEqual([
      "device.status",
      "sys.version",
      "v.oai.rgbcfg",
      "v.oai.thstatus",
    ]);
  });

  it("refuses every destructive method before it can reach the wire", async () => {
    const transport = new CodexMicroTransport();
    for (const method of DESTRUCTIVE_METHODS) {
      await expect(transport.request(method)).rejects.toBeInstanceOf(ForbiddenMethodError);
      expect(() => transport.notify(method)).toThrow(ForbiddenMethodError);
    }
  });

  it("checks the allowlist BEFORE the open check, so it cannot be bypassed by state", async () => {
    // A closed transport rejects everything - but a forbidden method must fail
    // with ForbiddenMethodError specifically, proving the allowlist ran first
    // and the method never got as far as being encoded.
    const transport = new CodexMicroTransport();
    expect(transport.isOpen).toBe(false);

    await expect(transport.request("sys.bootloader")).rejects.toThrow(ForbiddenMethodError);
    await expect(transport.request("sys.version")).rejects.toThrow(/transport is not open/);
  });

  it("names the destructive surface in the error, so widening it is a conscious act", async () => {
    const transport = new CodexMicroTransport();
    await expect(transport.request("fs.write")).rejects.toThrow(/safety allowlist/);
    await expect(transport.request("fs.write")).rejects.toThrow(/deliberate code change/);
  });

  it("never sends a report while refusing", async () => {
    const transport = new CodexMicroTransport();
    await expect(transport.request("sys.bootloader")).rejects.toThrow(ForbiddenMethodError);
    expect(transport.setReportCount).toBe(0);
  });
});

describe("device identity constants", () => {
  it("targets the Codex Micro's USB ids", () => {
    expect(CODEX_MICRO_VENDOR_ID).toBe(0x30_3a);
    expect(CODEX_MICRO_PRODUCT_ID).toBe(0x83_60);
  });
});

describe("parseDeviceStatus", () => {
  it("maps the firmware's snake_case reply onto the identity fields", () => {
    // Verbatim shape observed live on firmware v0.4.1.
    expect(
      parseDeviceStatus({
        version: "v0.4.1",
        profile_index: 0,
        layer_index: 1,
        battery: 100,
        is_charging: false,
      }),
    ).toEqual({
      version: "v0.4.1",
      profileIndex: 0,
      layerIndex: 1,
      battery: 100,
      isCharging: false,
    });
  });

  it("degrades field by field rather than throwing on an unexpected reply", () => {
    // A firmware that renames a field must cost us battery display, not the
    // connection: `connect()` treats any parsed reply as proof of life.
    expect(parseDeviceStatus({ version: "v9.0.0" })).toEqual({ version: "v9.0.0" });
    expect(parseDeviceStatus({ battery: "full" })).toEqual({});
    expect(parseDeviceStatus(null)).toEqual({});
    expect(parseDeviceStatus("nope")).toEqual({});
    expect(parseDeviceStatus(undefined)).toEqual({});
  });

  it("keeps a zero battery distinguishable from an absent one", () => {
    expect(parseDeviceStatus({ battery: 0 }).battery).toBe(0);
    expect(parseDeviceStatus({}).battery).toBeUndefined();
  });
});
