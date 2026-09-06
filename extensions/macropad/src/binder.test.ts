import { describe, expect, it } from "vitest";
import { MACROPAD_SLOT_COUNT } from "../contract.js";
import {
  bindSession,
  EMPTY_BINDER_STATE,
  findByIndex,
  findBySessionKey,
  listBindings,
  restoreBinderState,
  setPinned,
  touchSession,
  unbindSlot,
  type MacropadBinderState,
} from "./binder.js";

/** Bind `count` sessions with strictly increasing activity times. */
function fill(count: number, start = 1_000): MacropadBinderState {
  let state = EMPTY_BINDER_STATE;
  for (let index = 0; index < count; index++) {
    const result = bindSession(state, { sessionKey: `s${index}`, now: start + index });
    if (!result.ok) {
      throw new Error("fixture could not bind");
    }
    state = result.state;
  }
  return state;
}

function bindOrThrow(
  state: MacropadBinderState,
  params: Parameters<typeof bindSession>[1],
): MacropadBinderState {
  const result = bindSession(state, params);
  if (!result.ok) {
    throw new Error(`expected bind to succeed, got ${result.reason}`);
  }
  return result.state;
}

describe("auto-bind", () => {
  it("takes the lowest free slot", () => {
    const state = fill(3);

    expect(listBindings(state).map((binding) => binding.index)).toEqual([0, 1, 2]);
  });

  it("fills a hole left by an unbind before extending", () => {
    const { state } = unbindSlot(fill(3), { index: 1 });

    const next = bindOrThrow(state, { sessionKey: "new", now: 5_000 });

    expect(findBySessionKey(next, "new")?.index).toBe(1);
  });

  it("is idempotent for a session that already owns a key", () => {
    const state = fill(2);

    const next = bindOrThrow(state, { sessionKey: "s0", now: 9_000 });

    expect(listBindings(next)).toHaveLength(2);
    expect(findBySessionKey(next, "s0")?.index).toBe(0);
    expect(findBySessionKey(next, "s0")?.lastActiveAt).toBe(9_000);
  });
});

describe("LRU eviction", () => {
  it("evicts the least recently active session when every key is taken", () => {
    const state = fill(MACROPAD_SLOT_COUNT);

    const next = bindOrThrow(state, { sessionKey: "newcomer", now: 9_000 });

    expect(findBySessionKey(next, "s0")).toBeUndefined();
    expect(findBySessionKey(next, "newcomer")?.index).toBe(0);
    expect(listBindings(next)).toHaveLength(MACROPAD_SLOT_COUNT);
  });

  it("follows activity rather than slot order", () => {
    let state = fill(MACROPAD_SLOT_COUNT);
    // s0 was oldest; touching it makes s1 the stalest.
    state = touchSession(state, { sessionKey: "s0", now: 50_000 });

    const next = bindOrThrow(state, { sessionKey: "newcomer", now: 60_000 });

    expect(findBySessionKey(next, "s0")).toBeDefined();
    expect(findBySessionKey(next, "s1")).toBeUndefined();
    expect(findBySessionKey(next, "newcomer")?.index).toBe(1);
  });

  it("breaks ties on the higher slot index so eviction is deterministic", () => {
    let state = EMPTY_BINDER_STATE;
    for (let index = 0; index < MACROPAD_SLOT_COUNT; index++) {
      state = bindOrThrow(state, { sessionKey: `s${index}`, now: 1_000 });
    }

    const next = bindOrThrow(state, { sessionKey: "newcomer", now: 2_000 });

    expect(findBySessionKey(next, "s5")).toBeUndefined();
    expect(findBySessionKey(next, "newcomer")?.index).toBe(MACROPAD_SLOT_COUNT - 1);
  });

  it("never evicts a pinned slot", () => {
    let state = fill(MACROPAD_SLOT_COUNT);
    // Pin the stalest slot: it would otherwise be the obvious victim.
    state = setPinned(state, { index: 0, pinned: true });

    const next = bindOrThrow(state, { sessionKey: "newcomer", now: 9_000 });

    expect(findBySessionKey(next, "s0")?.pinned).toBe(true);
    expect(findBySessionKey(next, "s1")).toBeUndefined();
    expect(findBySessionKey(next, "newcomer")?.index).toBe(1);
  });

  it("refuses to auto-bind when every slot is pinned", () => {
    let state = fill(MACROPAD_SLOT_COUNT);
    for (let index = 0; index < MACROPAD_SLOT_COUNT; index++) {
      state = setPinned(state, { index, pinned: true });
    }

    const result = bindSession(state, { sessionKey: "newcomer", now: 9_000 });

    expect(result).toEqual({ ok: false, reason: "all-slots-pinned" });
  });
});

describe("explicit binding", () => {
  it("takes the named slot, evicting its current occupant", () => {
    const state = fill(3);

    const next = bindOrThrow(state, { sessionKey: "newcomer", index: 1, now: 9_000 });

    expect(findBySessionKey(next, "s1")).toBeUndefined();
    expect(findByIndex(next, 1)?.sessionKey).toBe("newcomer");
  });

  it("overrides a pin, because naming the key is a later instruction than setting the pin", () => {
    let state = fill(3);
    state = setPinned(state, { index: 1, pinned: true });

    const next = bindOrThrow(state, { sessionKey: "newcomer", index: 1, now: 9_000 });

    expect(findByIndex(next, 1)?.sessionKey).toBe("newcomer");
    expect(findByIndex(next, 1)?.pinned).toBe(false);
  });

  it("moves a session rather than cloning it across two keys", () => {
    const state = fill(3);

    const next = bindOrThrow(state, { sessionKey: "s0", index: 4, now: 9_000 });

    expect(next.bindings.filter((binding) => binding.sessionKey === "s0")).toHaveLength(1);
    expect(findBySessionKey(next, "s0")?.index).toBe(4);
    expect(findByIndex(next, 0)).toBeUndefined();
  });

  it("rejects a slot the device does not have", () => {
    expect(
      bindSession(EMPTY_BINDER_STATE, { sessionKey: "s", index: MACROPAD_SLOT_COUNT, now: 1 }),
    ).toEqual({ ok: false, reason: "invalid-slot" });
    expect(bindSession(EMPTY_BINDER_STATE, { sessionKey: "s", index: -1, now: 1 })).toEqual({
      ok: false,
      reason: "invalid-slot",
    });
  });

  it("carries a pin forward across a rebind that does not restate it", () => {
    let state = bindOrThrow(EMPTY_BINDER_STATE, { sessionKey: "s0", pinned: true, now: 1 });
    state = bindOrThrow(state, { sessionKey: "s0", now: 2 });

    expect(findBySessionKey(state, "s0")?.pinned).toBe(true);
  });
});

describe("unbind", () => {
  it("releases by index", () => {
    const { state, removed } = unbindSlot(fill(3), { index: 1 });

    expect(removed.map((binding) => binding.sessionKey)).toEqual(["s1"]);
    expect(findByIndex(state, 1)).toBeUndefined();
  });

  it("releases by session key", () => {
    const { state, removed } = unbindSlot(fill(3), { sessionKey: "s2" });

    expect(removed).toHaveLength(1);
    expect(findBySessionKey(state, "s2")).toBeUndefined();
  });

  it("is a no-op for an empty slot, so the UI can fire without a pre-check", () => {
    const state = fill(2);

    const result = unbindSlot(state, { index: 5 });

    expect(result.state).toBe(state);
    expect(result.removed).toEqual([]);
  });

  it("is a no-op when given neither an index nor a session", () => {
    const state = fill(2);

    expect(unbindSlot(state, {}).state).toBe(state);
  });
});

describe("ordering and activity", () => {
  it("lists bindings by ascending slot index whatever order they were made in", () => {
    let state = bindOrThrow(EMPTY_BINDER_STATE, { sessionKey: "late", index: 5, now: 1 });
    state = bindOrThrow(state, { sessionKey: "early", index: 0, now: 2 });
    state = bindOrThrow(state, { sessionKey: "middle", index: 3, now: 3 });

    expect(listBindings(state).map((binding) => binding.index)).toEqual([0, 3, 5]);
  });

  it("ignores activity for a session that owns no key", () => {
    const state = fill(2);

    expect(touchSession(state, { sessionKey: "stranger", now: 9_000 })).toBe(state);
  });

  it("returns the same state when activity has not moved", () => {
    const state = fill(1, 1_000);

    expect(touchSession(state, { sessionKey: "s0", now: 1_000 })).toBe(state);
  });

  it("leaves pins alone for a slot nothing is bound to", () => {
    const state = fill(1);

    expect(setPinned(state, { index: 4, pinned: true })).toBe(state);
  });
});

describe("restore after a Gateway restart", () => {
  it("rebuilds a persisted state", () => {
    const state = restoreBinderState([
      { index: 2, sessionKey: "beta", pinned: true, lastActiveAt: 42, agentId: "main" },
      { index: 0, sessionKey: "alpha", pinned: false, lastActiveAt: 7 },
    ]);

    expect(listBindings(state).map((binding) => binding.sessionKey)).toEqual(["alpha", "beta"]);
    expect(findByIndex(state, 2)).toMatchObject({ pinned: true, agentId: "main" });
  });

  it("discards rows for slots this device does not have", () => {
    const state = restoreBinderState([
      { index: 99, sessionKey: "ghost", pinned: false, lastActiveAt: 1 },
      { index: 1, sessionKey: "real", pinned: false, lastActiveAt: 1 },
    ]);

    expect(listBindings(state).map((binding) => binding.sessionKey)).toEqual(["real"]);
  });

  it("keeps the first row when a hand-edited store double-books a slot", () => {
    const state = restoreBinderState([
      { index: 1, sessionKey: "first", pinned: false, lastActiveAt: 1 },
      { index: 1, sessionKey: "second", pinned: false, lastActiveAt: 2 },
    ]);

    expect(listBindings(state)).toHaveLength(1);
    expect(findByIndex(state, 1)?.sessionKey).toBe("first");
  });

  it("keeps one key per session when a store lists the same session twice", () => {
    const state = restoreBinderState([
      { index: 0, sessionKey: "dup", pinned: false, lastActiveAt: 1 },
      { index: 3, sessionKey: "dup", pinned: false, lastActiveAt: 2 },
    ]);

    expect(listBindings(state)).toHaveLength(1);
    expect(findBySessionKey(state, "dup")?.index).toBe(0);
  });

  it("drops malformed rows instead of throwing", () => {
    const state = restoreBinderState([
      {},
      { index: 1 },
      { sessionKey: "no-index" },
      { index: 1.5, sessionKey: "fractional" },
      { index: 2, sessionKey: "" },
    ]);

    expect(state).toEqual(EMPTY_BINDER_STATE);
  });

  it("treats a restored binding with no recorded activity as the first eviction candidate", () => {
    let state = restoreBinderState(
      Array.from({ length: MACROPAD_SLOT_COUNT }, (_, index) => ({
        index,
        sessionKey: `s${index}`,
        pinned: false,
        ...(index === 4 ? {} : { lastActiveAt: 1_000 + index }),
      })),
    );
    state = bindOrThrow(state, { sessionKey: "newcomer", now: 9_000 });

    expect(findBySessionKey(state, "s4")).toBeUndefined();
  });
});
