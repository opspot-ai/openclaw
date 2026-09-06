/**
 * Contract and host types the Control UI reads.
 *
 * The contract stays the single source of truth for device shapes; this module
 * only gives `browser/**` one import point for them alongside the session view
 * the UI actually needs.
 */
import type { ControlUiSession } from "openclaw/plugin-sdk/control-ui";

export type {
  MacropadDeviceStatus,
  MacropadKeyFrame,
  MacropadSlot,
  MacropadSlotActivity,
  MacropadSlotList,
} from "../../contract.ts";

/** The subset of a session row the macropad UI reads. */
export type MacropadSession = Pick<
  ControlUiSession,
  "key" | "label" | "derivedTitle" | "displayName" | "agentId"
>;
