/**
 * Factory-gate tests. NO DEVICE REQUIRED, AND MUST PASS ON EVERY PLATFORM -
 * including a developer machine with a real macropad plugged in.
 *
 * The inert path is the behaviour most installs will ever exercise: this plugin
 * is bundled, so the overwhelming majority of Gateways run it with no macropad
 * attached, and on machines where IOKit does not exist at all. Getting this
 * wrong is not a missing feature, it is a crash loop in someone else's Gateway.
 */
import { describe, expect, it } from "vitest";
import { isDarwinHidAvailable, koffiVersion } from "./hid-darwin.js";
import { createCodexMicroTransport } from "./index.js";
import { findCodexMicro } from "./rpc-transport.js";

describe("createCodexMicroTransport", () => {
  it("returns a value rather than throwing, whatever this machine is", () => {
    // The contract is `DeviceTransport | undefined`. A throw here would take
    // out `device-link.openConnection`, which does not guard the factory call.
    expect(() => createCodexMicroTransport({})).not.toThrow();
    expect(() => createCodexMicroTransport({ deviceSerial: "NOPE-0000" })).not.toThrow();
  });

  it("never opens hardware from a test runner, even with a device attached", () => {
    // This is what keeps the suite hermetic and keeps `plugin-entry.test.ts`
    // honest: its "inert with no device attached" assertions must hold on a
    // machine that does have one, or CI and local disagree.
    expect(createCodexMicroTransport({})).toBeUndefined();
  });

  it("is inert on every non-macOS platform", () => {
    if (process.platform === "darwin") {
      return;
    }
    expect(isDarwinHidAvailable()).toBe(false);
  });

  it("exposes koffi without loading IOKit at import time", () => {
    // Importing this module must never trigger the native framework load; that
    // is what makes the whole port testable off-macOS.
    expect(typeof koffiVersion()).toBe("string");
  });
});

describe("device presence", () => {
  it("matches no device for a serial nothing can have", () => {
    // Enumeration only - it opens nothing and writes nothing, so this is safe
    // to run with the real macropad attached. It is the check that decides
    // inertness for a configured `deviceSerial` that is not plugged in.
    if (!isDarwinHidAvailable()) {
      return;
    }
    expect(findCodexMicro({ serialNumber: "NO-SUCH-SERIAL-0000" })).toBeNull();
  });
});
