import { describe, expect, it } from "vitest";
import { MACROPAD_SLOT_COUNT } from "../contract.js";
import { bindSession, EMPTY_BINDER_STATE, listBindings, setPinned } from "./binder.js";
import {
  createKeyedBindingStore,
  createMemoryBindingStore,
  MACROPAD_BINDING_NAMESPACE,
  type KeyedStoreLike,
  type OpenKeyedStoreLike,
  type PersistedBinding,
} from "./binding-store.js";

/** Stands in for the host's SQLite-backed keyed plugin-state store. */
function createFakeKeyedStore() {
  const rows = new Map<string, PersistedBinding>();
  const opened: Array<{ namespace: string; maxEntries: number }> = [];
  const store: KeyedStoreLike<PersistedBinding> = {
    register: (key, value) => {
      rows.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => Promise.resolve(rows.delete(key)),
    entries: () => Promise.resolve([...rows].map(([key, value]) => ({ key, value }))),
  };
  const open: OpenKeyedStoreLike = <T>(options: { namespace: string; maxEntries: number }) => {
    opened.push(options);
    // SAFETY: this plugin opens exactly one namespace, of PersistedBinding rows.
    return store as unknown as KeyedStoreLike<T>;
  };
  return { rows, opened, open };
}

function twoBindings() {
  let state = EMPTY_BINDER_STATE;
  for (const [index, sessionKey] of [
    [0, "alpha"],
    [3, "beta"],
  ] as const) {
    const result = bindSession(state, { sessionKey, index, now: 1_000 + index });
    if (!result.ok) {
      throw new Error("fixture could not bind");
    }
    state = result.state;
  }
  return setPinned(state, { index: 3, pinned: true });
}

describe("memory binding store", () => {
  it("round-trips a saved state", async () => {
    const store = createMemoryBindingStore();
    const state = twoBindings();

    await store.save(state);

    expect(listBindings(await store.load())).toEqual(listBindings(state));
  });

  it("starts from a seed", async () => {
    const store = createMemoryBindingStore([
      { index: 2, sessionKey: "seeded", pinned: true, lastActiveAt: 5 },
    ]);

    expect(listBindings(await store.load())).toEqual([
      { index: 2, sessionKey: "seeded", pinned: true, lastActiveAt: 5 },
    ]);
  });

  it("starts empty", async () => {
    expect(listBindings(await createMemoryBindingStore().load())).toEqual([]);
  });
});

describe("keyed binding store", () => {
  it("opens one namespace sized to the device", () => {
    const fake = createFakeKeyedStore();

    createKeyedBindingStore(fake.open);

    expect(fake.opened).toEqual([
      { namespace: MACROPAD_BINDING_NAMESPACE, maxEntries: MACROPAD_SLOT_COUNT },
    ]);
  });

  it("survives a Gateway restart", async () => {
    const fake = createFakeKeyedStore();
    const state = twoBindings();

    await createKeyedBindingStore(fake.open).save(state);
    // A fresh store over the same rows is what a restart actually looks like.
    const restored = await createKeyedBindingStore(fake.open).load();

    expect(listBindings(restored)).toEqual(listBindings(state));
  });

  it("clears rows for slots that are no longer bound", async () => {
    // A partial write would leave a stale row that reappears as a phantom
    // binding after the next restart, the persistence analogue of a partial
    // device frame.
    const fake = createFakeKeyedStore();
    const store = createKeyedBindingStore(fake.open);
    await store.save(twoBindings());
    expect(fake.rows.size).toBe(2);

    await store.save(EMPTY_BINDER_STATE);

    expect(fake.rows.size).toBe(0);
    expect(listBindings(await store.load())).toEqual([]);
  });

  it("discards persisted rows that no longer fit the device", async () => {
    const fake = createFakeKeyedStore();
    fake.rows.set("slot:99", {
      index: 99,
      sessionKey: "ghost",
      pinned: false,
      lastActiveAt: 1,
    });

    expect(listBindings(await createKeyedBindingStore(fake.open).load())).toEqual([]);
  });

  it("propagates a store failure so the caller can fall back", async () => {
    const failing: OpenKeyedStoreLike = () => ({
      register: () => Promise.reject(new Error("disk is full")),
      delete: () => Promise.resolve(false),
      entries: () => Promise.resolve([]),
    });

    await expect(createKeyedBindingStore(failing).save(twoBindings())).rejects.toThrow(
      /disk is full/u,
    );
  });
});
