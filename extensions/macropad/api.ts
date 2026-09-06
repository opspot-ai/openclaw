/**
 * Public barrel for the macropad plugin.
 *
 * Per `extensions/AGENTS.md` this is the only module core may import. Everything
 * under `src/` and `browser/` is private to the plugin.
 */
export {
  MACROPAD_EFFECTS,
  MACROPAD_PLUGIN_ID,
  MACROPAD_SLOT_COUNT,
  macropadContract,
  type MacropadContract,
  type MacropadDeviceStatus,
  type MacropadEffect,
  type MacropadKeyFrame,
  type MacropadSlot,
  type MacropadSlotActivity,
  type MacropadSlotList,
} from "./contract.js";
export { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
export { defineFeaturePlugin } from "openclaw/plugin-sdk/feature-plugin";
