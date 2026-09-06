import { describe, expect, it } from "vitest";
import { createDeviceStatus, createFullSlots, createSlot } from "../test/fixtures.ts";
import {
  findSlotForSession,
  nextBindRequest,
  nextFreeSlotIndex,
  resolveBindState,
  resolveSessionActionState,
} from "./binding.ts";

const SESSION = "agent:main:chat:deploy";

describe("nextFreeSlotIndex", () => {
  it("returns the lowest key holding no session", () => {
    expect(nextFreeSlotIndex([createSlot(0, { sessionKey: "a" })], 6)).toBe(1);
    expect(nextFreeSlotIndex([createSlot(1, { sessionKey: "a" })], 6)).toBe(0);
  });

  it("ignores keys that exist but hold nothing", () => {
    expect(nextFreeSlotIndex([createSlot(0), createSlot(1)], 6)).toBe(0);
  });

  it("returns null once every key inside the mirror is taken", () => {
    expect(nextFreeSlotIndex(createFullSlots(false), 6)).toBeNull();
  });

  it("respects a narrower mirror than the slots it was handed", () => {
    const slots = [createSlot(0, { sessionKey: "a" }), createSlot(1, { sessionKey: "b" })];
    expect(nextFreeSlotIndex(slots, 2)).toBeNull();
    expect(nextFreeSlotIndex(slots, 3)).toBe(2);
  });
});

describe("findSlotForSession", () => {
  it("matches on session key and tolerates an absent key", () => {
    const slots = [createSlot(2, { sessionKey: SESSION })];
    expect(findSlotForSession(slots, SESSION)?.index).toBe(2);
    expect(findSlotForSession(slots, "other")).toBeUndefined();
    expect(findSlotForSession(slots, undefined)).toBeUndefined();
  });
});

describe("resolveBindState", () => {
  it("is unavailable while the Gateway is disconnected", () => {
    expect(
      resolveBindState({
        connected: false,
        device: createDeviceStatus(),
        slots: [],
        sessionKey: SESSION,
      }),
    ).toEqual({ kind: "unavailable", reason: "disconnected" });
  });

  it("is unavailable with no device, even on a live Gateway", () => {
    for (const device of [null, createDeviceStatus({ connected: false })]) {
      expect(resolveBindState({ connected: true, device, slots: [], sessionKey: SESSION })).toEqual(
        {
          kind: "unavailable",
          reason: "no-device",
        },
      );
    }
  });

  it("is unavailable when a connected device exposes no keys", () => {
    expect(
      resolveBindState({
        connected: true,
        device: createDeviceStatus({ slotCount: 0 }),
        slots: [],
        sessionKey: SESSION,
      }),
    ).toEqual({ kind: "unavailable", reason: "no-device" });
  });

  it("reports the key a session already owns", () => {
    expect(
      resolveBindState({
        connected: true,
        device: createDeviceStatus(),
        slots: [createSlot(3, { sessionKey: SESSION, pinned: true, activity: "thinking" })],
        sessionKey: SESSION,
      }),
    ).toEqual({ kind: "bound", index: 3, pinned: true, activity: "thinking" });
  });

  it("targets the lowest free key when one exists", () => {
    expect(
      resolveBindState({
        connected: true,
        device: createDeviceStatus(),
        slots: [createSlot(0, { sessionKey: "other" })],
        sessionKey: SESSION,
      }),
    ).toEqual({ kind: "unbound", targetIndex: 1 });
  });

  it("stays bindable with a full board of unpinned keys, deferring to LRU eviction", () => {
    expect(
      resolveBindState({
        connected: true,
        device: createDeviceStatus(),
        slots: createFullSlots(false),
        sessionKey: SESSION,
      }),
    ).toEqual({ kind: "unbound", targetIndex: null });
  });

  it("blocks only when every key is both taken and pinned", () => {
    expect(
      resolveBindState({
        connected: true,
        device: createDeviceStatus(),
        slots: createFullSlots(true),
        sessionKey: SESSION,
      }),
    ).toEqual({ kind: "blocked", reason: "all-pinned" });
  });

  it("ignores slots the device no longer exposes", () => {
    // A six-slot binding table against a four-key device: keys 4 and 5 are gone,
    // so the board is full and pinned even though two rows look free.
    const slots = [
      ...Array.from({ length: 4 }, (_, index) =>
        createSlot(index, { sessionKey: `s${index}`, pinned: true }),
      ),
      createSlot(4),
      createSlot(5),
    ];
    expect(
      resolveBindState({
        connected: true,
        device: createDeviceStatus({ slotCount: 4 }),
        slots,
        sessionKey: SESSION,
      }),
    ).toEqual({ kind: "blocked", reason: "all-pinned" });
  });
});

describe("nextBindRequest", () => {
  const bound = { kind: "bound", index: 2, pinned: false, activity: "idle" } as const;

  it("releases the key a bound session owns", () => {
    expect(nextBindRequest(bound, { sessionKey: SESSION })).toEqual({
      operation: "slots.unbind",
      input: { index: 2 },
    });
  });

  it("claims the targeted key, carrying the agent when known", () => {
    expect(
      nextBindRequest(
        { kind: "unbound", targetIndex: 4 },
        { sessionKey: SESSION, agentId: "main" },
      ),
    ).toEqual({
      operation: "slots.bind",
      input: { sessionKey: SESSION, agentId: "main", index: 4 },
    });
  });

  it("omits the index so the backend evicts its LRU key", () => {
    expect(
      nextBindRequest({ kind: "unbound", targetIndex: null }, { sessionKey: SESSION }),
    ).toEqual({ operation: "slots.bind", input: { sessionKey: SESSION } });
  });

  it("offers nothing when the state has no action", () => {
    expect(
      nextBindRequest({ kind: "blocked", reason: "all-pinned" }, { sessionKey: SESSION }),
    ).toBeNull();
    expect(
      nextBindRequest({ kind: "unavailable", reason: "no-device" }, { sessionKey: SESSION }),
    ).toBeNull();
  });

  it("offers nothing without a session to bind", () => {
    expect(nextBindRequest(bound, { sessionKey: undefined })).toBeNull();
  });
});

describe("resolveSessionActionState", () => {
  it("hides itself entirely when there is no device to bind to", () => {
    expect(resolveSessionActionState({ kind: "unavailable", reason: "no-device" })).toEqual({
      hidden: true,
    });
    expect(resolveSessionActionState({ kind: "unavailable", reason: "disconnected" })).toEqual({
      hidden: true,
    });
  });

  it("names the key it will take", () => {
    expect(resolveSessionActionState({ kind: "unbound", targetIndex: 2 })).toEqual({
      label: "Bind to Macropad Key 3",
    });
  });

  it("falls back to a generic label when the backend picks the key", () => {
    expect(resolveSessionActionState({ kind: "unbound", targetIndex: null })).toEqual({
      label: "Bind to Macropad Key",
    });
  });

  it("names the key it will release", () => {
    expect(
      resolveSessionActionState({ kind: "bound", index: 0, pinned: false, activity: "idle" }),
    ).toEqual({ label: "Unbind from Macropad Key 1" });
  });

  it("disables with an explanation rather than hiding when every key is pinned", () => {
    expect(resolveSessionActionState({ kind: "blocked", reason: "all-pinned" })).toEqual({
      label: "Every Macropad key is pinned",
      disabled: true,
    });
  });

  it("disables for a read-only operator before considering the device state", () => {
    expect(resolveSessionActionState({ kind: "unbound", targetIndex: 0 }, false)).toEqual({
      label: "Macropad binding needs write access",
      disabled: true,
    });
  });

  it("still hides for a read-only operator with no device", () => {
    expect(resolveSessionActionState({ kind: "unavailable", reason: "no-device" }, false)).toEqual({
      hidden: true,
    });
  });
});
