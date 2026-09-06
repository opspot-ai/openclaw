import { afterEach, beforeEach } from "vitest";
import { bindMacropadHost } from "../host.ts";
import { createMacropadTestHost } from "./host.ts";

let fixture: ReturnType<typeof createMacropadTestHost>;
let unbind: (() => void) | undefined;

beforeEach(() => {
  fixture = createMacropadTestHost();
  unbind = bindMacropadHost(fixture.host);
});

afterEach(() => {
  unbind?.();
  fixture.dispose();
});

export function macropadTestHost() {
  return fixture;
}
