/**
 * Maps sessions onto the six physical keys.
 *
 * Pure and immutable: every operation takes a state and returns a new one, so
 * the whole binding policy - auto-bind, LRU eviction, pin protection - is
 * testable without a device, a Gateway, or a clock.
 */
import { MACROPAD_SLOT_COUNT } from "../contract.js";

export type MacropadBinding = {
  index: number;
  sessionKey: string;
  agentId?: string;
  label?: string;
  /** Pinned bindings are never evicted to make room for a new session. */
  pinned: boolean;
  /** Drives LRU eviction. Milliseconds, from the caller's clock. */
  lastActiveAt: number;
};

export type MacropadBinderState = {
  readonly bindings: readonly MacropadBinding[];
};

export const EMPTY_BINDER_STATE: MacropadBinderState = { bindings: [] };

export type BindParams = {
  sessionKey: string;
  agentId?: string;
  label?: string;
  /** Omit to take the next free slot, or evict the least-recently-used one. */
  index?: number;
  pinned?: boolean;
  now: number;
};

export type BindResult =
  | { ok: true; state: MacropadBinderState; index: number }
  | { ok: false; reason: "all-slots-pinned" | "invalid-slot" };

function sortByIndex(bindings: readonly MacropadBinding[]): MacropadBinding[] {
  return [...bindings].toSorted((left, right) => left.index - right.index);
}

/** Stable, ascending by slot index. The UI and the device both rely on this order. */
export function listBindings(state: MacropadBinderState): readonly MacropadBinding[] {
  return sortByIndex(state.bindings);
}

export function findBySessionKey(
  state: MacropadBinderState,
  sessionKey: string,
): MacropadBinding | undefined {
  return state.bindings.find((binding) => binding.sessionKey === sessionKey);
}

export function findByIndex(
  state: MacropadBinderState,
  index: number,
): MacropadBinding | undefined {
  return state.bindings.find((binding) => binding.index === index);
}

function firstFreeIndex(state: MacropadBinderState): number | undefined {
  const taken = new Set(state.bindings.map((binding) => binding.index));
  for (let index = 0; index < MACROPAD_SLOT_COUNT; index++) {
    if (!taken.has(index)) {
      return index;
    }
  }
  return undefined;
}

/**
 * Least-recently-active unpinned binding.
 *
 * Ties break on the higher slot index so eviction is deterministic: with two
 * equally stale sessions we surrender the key furthest from the operator's
 * primary slot rather than whichever one the array happened to hold first.
 */
function lruVictim(state: MacropadBinderState): MacropadBinding | undefined {
  let victim: MacropadBinding | undefined;
  for (const binding of state.bindings) {
    if (binding.pinned) {
      continue;
    }
    if (
      victim === undefined ||
      binding.lastActiveAt < victim.lastActiveAt ||
      (binding.lastActiveAt === victim.lastActiveAt && binding.index > victim.index)
    ) {
      victim = binding;
    }
  }
  return victim;
}

/**
 * Bind a session to a key.
 *
 * - An explicit `index` always wins, evicting whatever is there **including a
 *   pinned binding**: the operator asking for this key by name outranks a pin
 *   they set earlier.
 * - Rebinding an already-bound session keeps its existing slot and refreshes
 *   its metadata, so repeated auto-binds are idempotent and do not churn keys.
 * - Without an index: first free slot, else evict the LRU unpinned binding,
 *   else fail. Auto-bind never breaks a pin.
 */
export function bindSession(state: MacropadBinderState, params: BindParams): BindResult {
  const { sessionKey, now } = params;
  const existing = findBySessionKey(state, sessionKey);

  let target: number;
  if (params.index === undefined) {
    if (existing) {
      target = existing.index;
    } else {
      const free = firstFreeIndex(state);
      if (free === undefined) {
        const victim = lruVictim(state);
        if (!victim) {
          return { ok: false, reason: "all-slots-pinned" };
        }
        target = victim.index;
      } else {
        target = free;
      }
    }
  } else {
    if (
      !Number.isInteger(params.index) ||
      params.index < 0 ||
      params.index >= MACROPAD_SLOT_COUNT
    ) {
      return { ok: false, reason: "invalid-slot" };
    }
    target = params.index;
  }

  const binding: MacropadBinding = {
    index: target,
    sessionKey,
    ...(params.agentId === undefined ? {} : { agentId: params.agentId }),
    ...(params.label === undefined ? {} : { label: params.label }),
    pinned: params.pinned ?? existing?.pinned ?? false,
    lastActiveAt: now,
  };

  // Drop both the slot we are taking and any other slot this session already
  // held, so an explicit rebind moves a session rather than cloning it.
  const kept = state.bindings.filter(
    (candidate) => candidate.index !== target && candidate.sessionKey !== sessionKey,
  );
  return { ok: true, state: { bindings: sortByIndex([...kept, binding]) }, index: target };
}

export type UnbindParams = {
  index?: number;
  sessionKey?: string;
};

/**
 * Release a key by slot index, by session, or both.
 *
 * Idempotent: unbinding an empty slot or an unbound session is a no-op that
 * returns the same state, so the UI can fire unbind without a pre-check.
 */
export function unbindSlot(
  state: MacropadBinderState,
  params: UnbindParams,
): { state: MacropadBinderState; removed: readonly MacropadBinding[] } {
  if (params.index === undefined && params.sessionKey === undefined) {
    return { state, removed: [] };
  }
  const removed = state.bindings.filter(
    (binding) =>
      (params.index !== undefined && binding.index === params.index) ||
      (params.sessionKey !== undefined && binding.sessionKey === params.sessionKey),
  );
  if (removed.length === 0) {
    return { state, removed: [] };
  }
  const kept = state.bindings.filter((binding) => !removed.includes(binding));
  return { state: { bindings: sortByIndex(kept) }, removed };
}

/**
 * Mark a session as recently active, refreshing its LRU position.
 *
 * A no-op for unbound sessions - activity alone must not create a binding,
 * because auto-bind is a separate, configurable decision.
 */
export function touchSession(
  state: MacropadBinderState,
  params: { sessionKey: string; now: number },
): MacropadBinderState {
  const existing = findBySessionKey(state, params.sessionKey);
  if (!existing || existing.lastActiveAt === params.now) {
    return state;
  }
  return {
    bindings: sortByIndex(
      state.bindings.map((binding) =>
        binding.sessionKey === params.sessionKey
          ? { ...binding, lastActiveAt: params.now }
          : binding,
      ),
    ),
  };
}

/** Pin or unpin an occupied slot. Unknown slots are left alone. */
export function setPinned(
  state: MacropadBinderState,
  params: { index: number; pinned: boolean },
): MacropadBinderState {
  if (!findByIndex(state, params.index)) {
    return state;
  }
  return {
    bindings: sortByIndex(
      state.bindings.map((binding) =>
        binding.index === params.index ? { ...binding, pinned: params.pinned } : binding,
      ),
    ),
  };
}

/**
 * Rebuild state from persisted rows, discarding anything that no longer fits.
 *
 * Restart recovery must never trust its own file: a slot count change or a
 * hand-edited store would otherwise light keys that do not exist or double-bind
 * one key. Later duplicates lose.
 */
export function restoreBinderState(rows: readonly Partial<MacropadBinding>[]): MacropadBinderState {
  const bySlot = new Map<number, MacropadBinding>();
  const seenSessions = new Set<string>();
  for (const row of rows) {
    const { index, sessionKey } = row;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= MACROPAD_SLOT_COUNT ||
      typeof sessionKey !== "string" ||
      sessionKey.length === 0 ||
      bySlot.has(index) ||
      seenSessions.has(sessionKey)
    ) {
      continue;
    }
    seenSessions.add(sessionKey);
    bySlot.set(index, {
      index,
      sessionKey,
      ...(typeof row.agentId === "string" ? { agentId: row.agentId } : {}),
      ...(typeof row.label === "string" ? { label: row.label } : {}),
      pinned: row.pinned === true,
      lastActiveAt: typeof row.lastActiveAt === "number" ? row.lastActiveAt : 0,
    });
  }
  return { bindings: sortByIndex([...bySlot.values()]) };
}
