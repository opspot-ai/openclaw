/**
 * Id-correlation unit tests. NO DEVICE REQUIRED.
 *
 * Ported from the proving spike. The timeout cases use an injected fake clock
 * rather than `vi.useFakeTimers`, because the correlator takes its timer
 * functions as options and asserting on the injected pair proves the wiring as
 * well as the behaviour.
 */
import { describe, expect, it } from "vitest";
import { Correlator, RpcError, RpcTimeoutError } from "./correlator.js";
import { MAX_RPC_ID } from "./framing.js";

/** Deterministic fake clock so timeout tests do not depend on wall time. */
function fakeTimers() {
  let seq = 0;
  const pendingTimers = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    setTimeoutFn: (fn: () => void, ms: number) => {
      const handle = ++seq;
      pendingTimers.set(handle, { fn, at: now + ms });
      return handle;
    },
    clearTimeoutFn: (handle: unknown) => {
      pendingTimers.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of Array.from(pendingTimers)) {
        if (timer.at <= now) {
          pendingTimers.delete(handle);
          timer.fn();
        }
      }
    },
    get count() {
      return pendingTimers.size;
    },
  };
}

describe("Correlator", () => {
  it("resolves the matching request with its result", async () => {
    const correlator = new Correlator();
    const id = correlator.allocateId();
    const pending = correlator.register(id, "sys.version", 1000);
    expect(correlator.inFlight).toBe(1);

    expect(correlator.settle(id, { version: "v0.4.1" })).toBe(true);
    await expect(pending).resolves.toEqual({ version: "v0.4.1" });
    expect(correlator.inFlight, "settled request must be removed").toBe(0);
  });

  it("resolves concurrent requests independently without cross-wiring them", async () => {
    const correlator = new Correlator();
    const a = correlator.allocateId();
    const b = correlator.allocateId();
    expect(a).not.toBe(b);

    const pendingA = correlator.register(a, "sys.version", 1000);
    const pendingB = correlator.register(b, "device.status", 1000);

    // Settle out of order on purpose.
    correlator.settle(b, "B");
    correlator.settle(a, "A");

    await expect(pendingA).resolves.toBe("A");
    await expect(pendingB).resolves.toBe("B");
  });

  it("rejects with RpcError carrying the device payload", async () => {
    const correlator = new Correlator();
    const id = correlator.allocateId();
    const pending = correlator.register(id, "v.oai.thstatus", 1000);
    correlator.settle(id, undefined, { code: -32602, message: "bad params" });

    await expect(pending).rejects.toBeInstanceOf(RpcError);
    await pending.catch((error: unknown) => {
      expect((error as RpcError).rpcError).toEqual({ code: -32602, message: "bad params" });
    });
  });

  it("treats a null error field as success, not failure", async () => {
    const correlator = new Correlator();
    const id = correlator.allocateId();
    const pending = correlator.register(id, "sys.version", 1000);
    correlator.settle(id, "ok", null);
    await expect(pending).resolves.toBe("ok");
  });

  it("returns false for an unmatched response instead of throwing", () => {
    const correlator = new Correlator();
    // Simulates a late reply, or a reply to the ChatGPT app on this shared device.
    expect(correlator.settle(742, { stray: true })).toBe(false);
  });

  it("rejects with RpcTimeoutError and frees the id", async () => {
    const timers = fakeTimers();
    const correlator = new Correlator(timers);
    const id = correlator.allocateId();
    const pending = correlator.register(id, "device.status", 2000);

    timers.advance(1999);
    expect(correlator.inFlight, "must still be pending just before the deadline").toBe(1);

    timers.advance(2);
    await expect(pending).rejects.toBeInstanceOf(RpcTimeoutError);
    await pending.catch((error: unknown) => {
      expect((error as RpcTimeoutError).id).toBe(id);
      // The message must teach the trap, because this is the failure people hit.
      expect((error as Error).message).toMatch(/does NOT prove delivery/);
    });
    expect(correlator.inFlight).toBe(0);
  });

  it("cancels the timeout on settle so a resolved request cannot later time out", async () => {
    const timers = fakeTimers();
    const correlator = new Correlator(timers);
    const id = correlator.allocateId();
    const pending = correlator.register(id, "sys.version", 1000);

    correlator.settle(id, "fast");
    await expect(pending).resolves.toBe("fast");

    expect(timers.count, "timer must be cleared on settle").toBe(0);
    timers.advance(5000); // must not throw or produce an unhandled rejection
  });

  it("ignores a late reply arriving after a timeout rather than mis-delivering it", async () => {
    const timers = fakeTimers();
    const correlator = new Correlator(timers);
    const id = correlator.allocateId();
    const pending = correlator.register(id, "sys.version", 500);

    timers.advance(600);
    await expect(pending).rejects.toBeInstanceOf(RpcTimeoutError);

    expect(correlator.settle(id, "too late")).toBe(false);
  });
});

describe("Correlator id ring", () => {
  it("keeps allocated ids inside the firmware-legal [0, 999) range across a full lap", () => {
    const correlator = new Correlator({ startId: 990 });
    for (let i = 0; i < MAX_RPC_ID * 2; i++) {
      const id = correlator.allocateId();
      expect(Number.isInteger(id) && id >= 0 && id < MAX_RPC_ID, `id ${id} out of range`).toBe(
        true,
      );
    }
  });

  it("ACCEPTANCE: skips ids still in flight when lapping the ring rather than reusing them", () => {
    const timers = fakeTimers();
    const correlator = new Correlator({ startId: 0, ...timers });

    // Hold id 5 open for the whole test.
    const held = 5;
    for (let i = 0; i < held; i++) {
      correlator.allocateId();
    }
    const holdId = correlator.allocateId();
    expect(holdId).toBe(held);
    const holdPromise = correlator.register(holdId, "held", 10_000);
    holdPromise.catch(() => undefined);

    // Walk all the way around the ring back to 5.
    const seen: number[] = [];
    for (let i = 0; i < MAX_RPC_ID; i++) {
      seen.push(correlator.allocateId());
    }

    expect(seen.includes(held), "an in-flight id must never be handed out again").toBe(false);
    expect(seen.includes(4) && seen.includes(6), "neighbouring ids must still be usable").toBe(
      true,
    );
    expect(correlator.hasPending(held)).toBe(true);
  });

  it("rejects registering an id that is already in flight", () => {
    const correlator = new Correlator();
    const id = correlator.allocateId();
    correlator.register(id, "a", 10_000).catch(() => undefined);
    expect(() => correlator.register(id, "b", 1000)).toThrow(/already in flight/);
  });

  it("drops a registration on cancel without settling it", () => {
    const timers = fakeTimers();
    const correlator = new Correlator(timers);
    const id = correlator.allocateId();
    const pending = correlator.register(id, "sys.version", 1000);
    pending.catch(() => undefined);

    correlator.cancel(id);
    expect(correlator.inFlight).toBe(0);
    expect(timers.count, "cancel must clear the timer").toBe(0);
    timers.advance(5000); // must not fire
  });

  it("settles every in-flight request on rejectAll", async () => {
    const correlator = new Correlator();
    const ids = [correlator.allocateId(), correlator.allocateId(), correlator.allocateId()];
    const pendings = ids.map((id) => correlator.register(id, "sys.version", 10_000));

    correlator.rejectAll("transport closed");
    expect(correlator.inFlight).toBe(0);
    for (const pending of pendings) {
      await expect(pending).rejects.toThrow(/transport closed/);
    }
  });
});
