/**
 * Live hardware proof for the Codex Micro driver. REQUIRES THE DEVICE.
 *
 * Runs entirely through the PLUGIN's code path - `createCodexMicroTransport`
 * (which `extensions/macropad/index.ts:createDeviceTransport` is a one-line
 * delegation to), the plugin's `composeFrame`, and the `DeviceTransport`
 * methods `device-link.ts` itself calls. Nothing here reaches into the proving
 * spike, and nothing here talks to IOKit directly.
 *
 *   node --import ./scripts/tsx.mjs \
 *     extensions/macropad/src/devices/codex-micro/live-proof.mts
 *
 *   HOLD_MS=15000 node --import ... live-proof.mts   # longer look at the keys
 *
 * What it proves, in the only currency this device accepts:
 *  - `connect()` resolved, which happens ONLY after a parsed `device.status`
 *    round-trip. Firmware and battery in the printed identity came off the wire.
 *  - `setFrame()` resolved, which happens ONLY after the firmware's own
 *    `{"ok":1}` acknowledgement of `v.oai.thstatus`. The trace prints it.
 *  - The kernel's `SetReportCount` climbed by the number of reports we sent.
 *    IOKit counts these itself, so this is corroboration from outside our
 *    process rather than our own bookkeeping agreeing with itself.
 *
 * `IOHIDDeviceSetReport` returns success for frames this firmware then silently
 * drops, so a write completing is NOT evidence. Only the replies are.
 */
import { execFileSync } from "node:child_process";
import {
  composeBlankFrame,
  composeFrame,
  type MacropadLighting,
  type MacropadSlotShadow,
} from "../../frame-compositor.js";
import { createCodexMicroTransport } from "./index.js";

const HOLD_MS = Number(process.env.HOLD_MS ?? 5000);

/**
 * IOKit's own report counters for the device, read out of `ioreg`.
 *
 * Independent corroboration: the kernel counts reports that actually crossed
 * into the HID stack, so a delta here cannot be produced by our code lying to
 * itself. Ported from the spike's `kernel-counters.ts`.
 */
function readKernelCounters(productName = "Codex Micro"): {
  setReportCount: number | null;
  inputReportCount: number | null;
} {
  let out: string;
  try {
    out = execFileSync("ioreg", ["-c", "IOHIDDevice", "-r", "-l"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return { setReportCount: null, inputReportCount: null };
  }
  const lines = out.split("\n");
  const start = lines.findIndex((line) => line.includes(`"Product" = "${productName}"`));
  if (start === -1) {
    return { setReportCount: null, inputReportCount: null };
  }
  const window = lines
    .slice(Math.max(0, start - 400), Math.min(lines.length, start + 400))
    .join("\n");
  const pick = (key: string): number | null => {
    const match = window.match(new RegExp(`"${key}"\\s*=\\s*(\\d+)`, "u"));
    return match ? Number(match[1]) : null;
  };
  return { setReportCount: pick("SetReportCount"), inputReportCount: pick("InputReportCount") };
}

const LIGHTING: MacropadLighting = {
  brightness: 1,
  idleBrightness: 0.25,
  // Magenta is deliberately not a colour any default profile paints, so what
  // you see on the keys can only have come from this run.
  colorThinking: 0xff_00_ff,
  colorAwaitingApproval: 0x00_ff_ff,
  colorError: 0xff_00_00,
  useSessionColors: false,
};

/** Four bound keys and two deliberately left unbound, to show the dark ids repaint too. */
const SLOTS: MacropadSlotShadow[] = [
  { index: 0, activity: "thinking", pinned: false, sessionKey: "proof:0" },
  { index: 1, activity: "awaiting-approval", pinned: false, sessionKey: "proof:1" },
  { index: 2, activity: "idle", pinned: false, sessionKey: "proof:2" },
  { index: 3, activity: "error", pinned: false, sessionKey: "proof:3" },
];

const trace: string[] = [];

async function main(): Promise<number> {
  const transport = createCodexMicroTransport({
    debug: (message) => {
      trace.push(message);
      console.log(`  [trace] ${message}`);
    },
  });

  if (!transport) {
    console.error(
      "INERT: createCodexMicroTransport returned undefined. " +
        "Not macOS, koffi cannot reach IOKit, no Codex Micro attached, or this is a test runtime.",
    );
    return 1;
  }
  console.log("factory        : returned a DeviceTransport");

  console.log("\n-- connect (resolves only on a parsed device.status round-trip) --");
  const identity = await transport.connect();
  console.log(`identity       : ${JSON.stringify(identity)}`);
  console.log(`connected      : ${transport.connected}`);

  const before = readKernelCounters();
  console.log(
    `kernel before  : SetReportCount=${before.setReportCount} InputReportCount=${before.inputReportCount}`,
  );

  console.log('\n-- setFrame (resolves only on the firmware\'s {"ok":1}) --');
  const frame = composeFrame(SLOTS, LIGHTING);
  await transport.setFrame(frame);
  console.log(`setFrame       : resolved; ${SLOTS.length} lit + ${6 - SLOTS.length} dark keys`);

  console.log(`\n-- holding ${HOLD_MS}ms; look at the device --`);
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS));

  console.log("\n-- restore (the same blank frame device-link paints on teardown) --");
  await transport.setFrame(composeBlankFrame(LIGHTING));
  console.log("restore        : resolved");

  const after = readKernelCounters();
  console.log(
    `kernel after   : SetReportCount=${after.setReportCount} InputReportCount=${after.inputReportCount}`,
  );
  if (before.setReportCount !== null && after.setReportCount !== null) {
    console.log(`kernel delta   : SetReportCount +${after.setReportCount - before.setReportCount}`);
  }

  await transport.close();
  console.log(`closed         : connected=${transport.connected}`);

  const acks = trace.filter((line) => line.startsWith("<- "));
  console.log(`\nparsed replies : ${acks.length}`);
  for (const ack of acks) {
    console.log(`  ${ack}`);
  }
  return acks.some((line) => line.includes('{"ok":1}')) ? 0 : 2;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error("FAILED:", error);
    process.exit(1);
  });
