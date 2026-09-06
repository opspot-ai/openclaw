import { t } from "../i18n/index.ts";
import { mirrorWidth } from "./slot-presentation.ts";
/**
 * Pure bind/unbind state machine shared by the page, the session accessory and
 * the session action, so all three agree on what a session's key situation is
 * and none of them re-derives it slightly differently.
 */
import type { MacropadDeviceStatus, MacropadSlot, MacropadSlotActivity } from "./types.ts";

export type BindState =
  /** Nothing to bind to. Every surface hides itself rather than offering a dead control. */
  | { kind: "unavailable"; reason: "disconnected" | "no-device" }
  /** Bindable. A null `targetIndex` means the backend evicts its least-recently-used key. */
  | { kind: "unbound"; targetIndex: number | null }
  /** Every key is spoken for and pinned, so nothing may be evicted. */
  | { kind: "blocked"; reason: "all-pinned" }
  | { kind: "bound"; index: number; pinned: boolean; activity: MacropadSlotActivity };

export type BindInputs = {
  /** Gateway connection, not device connection. Both must hold. */
  connected: boolean;
  device: MacropadDeviceStatus | null;
  slots: readonly MacropadSlot[];
  sessionKey: string | undefined;
};

export function findSlotForSession(
  slots: readonly MacropadSlot[],
  sessionKey: string | undefined,
): MacropadSlot | undefined {
  return sessionKey ? slots.find((slot) => slot.sessionKey === sessionKey) : undefined;
}

/** Lowest key index inside the mirror that holds no session. */
export function nextFreeSlotIndex(slots: readonly MacropadSlot[], width: number): number | null {
  const taken = new Set(slots.filter((slot) => slot.sessionKey).map((slot) => slot.index));
  for (let index = 0; index < width; index += 1) {
    if (!taken.has(index)) {
      return index;
    }
  }
  return null;
}

export function resolveBindState({ connected, device, slots, sessionKey }: BindInputs): BindState {
  if (!connected) {
    return { kind: "unavailable", reason: "disconnected" };
  }
  const width = mirrorWidth(device);
  if (!device?.connected || width === 0) {
    return { kind: "unavailable", reason: "no-device" };
  }
  const inRange = slots.filter((slot) => slot.index < width);
  const bound = findSlotForSession(inRange, sessionKey);
  if (bound) {
    return { kind: "bound", index: bound.index, pinned: bound.pinned, activity: bound.activity };
  }
  if (!sessionKey) {
    return { kind: "unavailable", reason: "no-device" };
  }
  const free = nextFreeSlotIndex(inRange, width);
  if (free !== null) {
    return { kind: "unbound", targetIndex: free };
  }
  // Full. Unpinned keys are still fair game — the backend evicts the LRU one.
  return inRange.some((slot) => !slot.pinned)
    ? { kind: "unbound", targetIndex: null }
    : { kind: "blocked", reason: "all-pinned" };
}

export type BindRequest =
  | { operation: "slots.bind"; input: { sessionKey: string; agentId?: string; index?: number } }
  | { operation: "slots.unbind"; input: { index: number } };

/**
 * The toggle: bound sessions release their key, unbound sessions take one.
 *
 * Returns null when the state offers no action, so callers never invoke an
 * operation the UI is simultaneously telling the user is unavailable.
 */
export function nextBindRequest(
  state: BindState,
  session: { sessionKey: string | undefined; agentId?: string },
): BindRequest | null {
  if (!session.sessionKey) {
    return null;
  }
  if (state.kind === "bound") {
    return { operation: "slots.unbind", input: { index: state.index } };
  }
  if (state.kind !== "unbound") {
    return null;
  }
  return {
    operation: "slots.bind",
    input: {
      sessionKey: session.sessionKey,
      ...(session.agentId ? { agentId: session.agentId } : {}),
      ...(state.targetIndex === null ? {} : { index: state.targetIndex }),
    },
  };
}

export type ActionPresentation = { label?: string; disabled?: boolean; hidden?: boolean };

/**
 * `ControlUiAction.resolve` output.
 *
 * Hidden with no device (an action that cannot work should not advertise
 * itself), disabled with an explanatory label when every key is pinned, and
 * otherwise named for the concrete key it will take or release.
 */
export function resolveSessionActionState(state: BindState, canWrite = true): ActionPresentation {
  if (state.kind === "unavailable") {
    return { hidden: true };
  }
  if (!canWrite) {
    return { label: t("macropad.action.readOnly"), disabled: true };
  }
  if (state.kind === "blocked") {
    return { label: t("macropad.action.allPinned"), disabled: true };
  }
  if (state.kind === "bound") {
    return { label: t("macropad.action.unbind", { number: state.index + 1 }) };
  }
  return {
    label:
      state.targetIndex === null
        ? t("macropad.action.bind")
        : t("macropad.action.bindNext", { number: state.targetIndex + 1 }),
  };
}
