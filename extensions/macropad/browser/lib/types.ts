/**
 * Contract types for the Control UI.
 *
 * These derive from the contract's own operation schemas rather than from the
 * `MacropadDeviceStatus`/`MacropadSlot` aliases `contract.ts` exports, because
 * those aliases are written as `typeof Schema.static` and do not typecheck on
 * this TypeBox version (`tsgo:extensions` reports TS2339 for all five, with or
 * without this directory present). Deriving through `FeatureOutput` keeps the
 * contract as the single source of truth and needs no change here once the
 * aliases are corrected to `Static<typeof Schema>`.
 */
import type { ControlUiSession } from "openclaw/plugin-sdk/control-ui";
import type { FeatureOutput } from "openclaw/plugin-sdk/feature-contract";
import type { MacropadContract } from "../../contract.ts";

export type MacropadDeviceStatus = FeatureOutput<MacropadContract, "device.get">;
export type MacropadSlotList = FeatureOutput<MacropadContract, "slots.list">;
export type MacropadSlot = MacropadSlotList["slots"][number];
export type MacropadKeyFrame = MacropadSlot["frame"];
export type MacropadSlotActivity = MacropadSlot["activity"];

/** The subset of a session row the macropad UI reads. */
export type MacropadSession = Pick<
  ControlUiSession,
  "key" | "label" | "derivedTitle" | "displayName" | "agentId"
>;
