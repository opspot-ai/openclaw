/**
 * Persists key bindings so they survive a Gateway restart.
 *
 * Backed by the host's plugin-state keyed store (SQLite, plugin-scoped) rather
 * than a private database file: it is the sanctioned seam, it is already
 * namespaced by plugin id, and it removes the schema-migration and file-mode
 * work `extensions/workboard/src/sqlite-store.ts` has to do for a much larger
 * dataset. Six rows do not need their own database.
 *
 * The store is reached only through the injected `openKeyedStore`, so every
 * test in this plugin runs against `createMemoryBindingStore()` and never opens
 * a file.
 */
import { MACROPAD_SLOT_COUNT } from "../contract.js";
import { listBindings, restoreBinderState, type MacropadBinderState } from "./binder.js";

/** One persisted row. Slot index is the key, so it is not repeated in the value. */
export type PersistedBinding = {
  index: number;
  sessionKey: string;
  agentId?: string;
  label?: string;
  pinned: boolean;
  lastActiveAt: number;
};

export type MacropadBindingStore = {
  load(): Promise<MacropadBinderState>;
  save(state: MacropadBinderState): Promise<void>;
};

/** The slice of `PluginStateKeyedStore` this plugin uses. */
export type KeyedStoreLike<T> = {
  register(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  entries(): Promise<Array<{ key: string; value: T }>>;
};

export type OpenKeyedStoreLike = <T>(options: {
  namespace: string;
  maxEntries: number;
}) => KeyedStoreLike<T>;

export const MACROPAD_BINDING_NAMESPACE = "bindings";

function slotKey(index: number): string {
  return `slot:${index}`;
}

/** Copy a binding into a plain persisted row, so the store never aliases live state. */
function toPersisted(binding: PersistedBinding): PersistedBinding {
  const row: PersistedBinding = {
    index: binding.index,
    sessionKey: binding.sessionKey,
    pinned: binding.pinned,
    lastActiveAt: binding.lastActiveAt,
  };
  if (binding.agentId !== undefined) {
    row.agentId = binding.agentId;
  }
  if (binding.label !== undefined) {
    row.label = binding.label;
  }
  return row;
}

/**
 * A store that forgets everything on restart.
 *
 * Used by tests, and as the fallback when the host has no plugin-state backend:
 * losing bindings across a restart is a far better failure than refusing to
 * light the device at all.
 */
export function createMemoryBindingStore(
  seed: readonly PersistedBinding[] = [],
): MacropadBindingStore {
  let rows: PersistedBinding[] = [...seed];
  return {
    load: () => Promise.resolve(restoreBinderState(rows)),
    save: (state) => {
      rows = listBindings(state).map(toPersisted);
      return Promise.resolve();
    },
  };
}

/**
 * Persist bindings through the host's keyed plugin-state store.
 *
 * `save` rewrites all six slots every time - clearing the ones that are now
 * empty - for the same reason the device gets a full frame: a partial write
 * leaves stale rows that reappear as phantom bindings after a restart.
 */
export function createKeyedBindingStore(openKeyedStore: OpenKeyedStoreLike): MacropadBindingStore {
  const store = openKeyedStore<PersistedBinding>({
    namespace: MACROPAD_BINDING_NAMESPACE,
    maxEntries: MACROPAD_SLOT_COUNT,
  });
  return {
    async load() {
      const entries = await store.entries();
      return restoreBinderState(entries.map((entry) => entry.value ?? {}));
    },
    async save(state) {
      const bindings = listBindings(state);
      const occupied = new Set(bindings.map((binding) => binding.index));
      const writes: Promise<unknown>[] = [];
      for (const binding of bindings) {
        writes.push(store.register(slotKey(binding.index), toPersisted(binding)));
      }
      for (let index = 0; index < MACROPAD_SLOT_COUNT; index++) {
        if (!occupied.has(index)) {
          writes.push(store.delete(slotKey(index)));
        }
      }
      await Promise.all(writes);
    },
  };
}
