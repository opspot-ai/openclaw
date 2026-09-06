/**
 * Contract types, derived from the contract's own schemas.
 *
 * `contract.ts` exports convenience aliases written as `typeof Schema.static`.
 * TypeBox 1.3 does not expose a `static` property on `TSchema` - the idiom
 * everywhere else in this repo is `Static<typeof Schema>` - so those five
 * aliases fail to typecheck and resolve to `any`, which then silently
 * de-types every consumer downstream.
 *
 * Rather than edit a file this worker does not own, `src/**` derives the same
 * types from `macropadContract` through the SDK's own `FeatureInput` /
 * `FeatureOutput` helpers. That is arguably the better seam anyway: it reads
 * the live contract instead of a hand-written parallel alias, so it cannot
 * drift from the operations it describes. Once the aliases in `contract.ts` are
 * repaired these become interchangeable with them.
 */
import type { FeatureInput, FeatureOutput } from "openclaw/plugin-sdk/feature-contract";
import type { MacropadContract } from "../contract.js";

export type MacropadDeviceStatus = FeatureOutput<MacropadContract, "device.get">;
export type MacropadSlotList = FeatureOutput<MacropadContract, "slots.list">;
export type MacropadSlot = MacropadSlotList["slots"][number];
export type MacropadKeyFrame = MacropadSlot["frame"];
export type MacropadSlotActivity = MacropadSlot["activity"];

export type MacropadBindInput = FeatureInput<MacropadContract, "slots.bind">;
export type MacropadUnbindInput = FeatureInput<MacropadContract, "slots.unbind">;
