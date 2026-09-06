import type { ControlUiHost } from "openclaw/plugin-sdk/control-ui";
import { createFeatureClient, type FeatureClient } from "openclaw/plugin-sdk/feature-contract";
import { macropadContract, type MacropadContract } from "../../contract.ts";

export type MacropadClient = FeatureClient<MacropadContract>;

/**
 * The only channel to the backend.
 *
 * `createFeatureClient` rides the operator's existing authenticated connection
 * and refuses a host whose plugin id does not match the contract, so a
 * mis-mounted bundle fails loudly instead of talking to the wrong plugin.
 */
export function createMacropadClient(host: ControlUiHost): MacropadClient {
  return createFeatureClient(macropadContract, host);
}

export function formatMacropadError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "Macropad request failed.";
}
