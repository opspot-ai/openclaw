import { formatMacropadError, type MacropadClient } from "../api/client.ts";
/**
 * Shared macropad state for every surface this plugin registers.
 *
 * One store means the page, the accessory and the action can never disagree
 * about which key a session owns, and one `watch` pair feeds them all.
 */
import type { MacropadDeviceStatus, MacropadSlot } from "./types.ts";

export type MacropadUiState = {
  device: MacropadDeviceStatus | null;
  slots: readonly MacropadSlot[];
  error: string | null;
  /** True once either query has answered, so the page can tell empty from pending. */
  loaded: boolean;
};

export type MacropadStore = {
  readonly state: MacropadUiState;
  setDevice: (device: MacropadDeviceStatus) => void;
  setSlots: (slots: readonly MacropadSlot[]) => void;
  setError: (error: string | null) => void;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

export function createMacropadStore(): MacropadStore {
  const listeners = new Set<() => void>();
  let disposed = false;
  const state: MacropadUiState = { device: null, slots: [], error: null, loaded: false };
  const notify = () => {
    if (disposed) {
      return;
    }
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    state,
    setDevice(device) {
      state.device = device;
      state.loaded = true;
      state.error = null;
      notify();
    },
    setSlots(slots) {
      state.slots = slots;
      state.loaded = true;
      state.error = null;
      notify();
    },
    setError(error) {
      if (state.error === error) {
        return;
      }
      state.error = error;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/**
 * Keep the store live.
 *
 * `watch` already owns reconnect, refresh coalescing and stale-result dropping,
 * and `host.subscribe` never fires for plugin events — so this is the whole
 * live-state story. There is deliberately no polling anywhere in this plugin.
 */
export function startMacropadSync(client: MacropadClient, store: MacropadStore): () => void {
  const onError = (error: unknown) => store.setError(formatMacropadError(error));
  const disposers = [
    client.watch(
      "device.get",
      {},
      {
        events: ["device_changed"],
        onChange: (device) => store.setDevice(device),
        onError,
      },
    ),
    client.watch(
      "slots.list",
      {},
      {
        // Device changes can retire keys, so the mirror follows both events.
        events: ["slots_changed", "device_changed"],
        onChange: ({ slots }) => store.setSlots(slots),
        onError,
      },
    ),
  ];
  return () => {
    for (const dispose of disposers.toReversed()) {
      dispose();
    }
  };
}
