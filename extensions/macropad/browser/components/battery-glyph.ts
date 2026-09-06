import { html, svg, type TemplateResult } from "lit";
import { batteryFill, type BatteryPresentation } from "../lib/device-presentation.ts";

const TRACK_X = 3;
const TRACK_WIDTH = 14;

/**
 * Battery glyph whose fill tracks the reported level, so the pill reads at a
 * glance the way the reference's `🔋100%` does rather than as a static icon.
 */
export function renderBatteryGlyph(battery: BatteryPresentation): TemplateResult {
  const width = TRACK_WIDTH * batteryFill(battery.percent);
  return html`<svg
    class="macropad-battery"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect width="18" height="12" x="2" y="6" rx="2" />
    <path d="M22 10v4" />
    ${
      width > 0
        ? svg`<rect
            x=${TRACK_X}
            y="7"
            width=${width}
            height="10"
            rx="1"
            fill="currentColor"
            stroke="none"
          />`
        : null
    }
  </svg>`;
}
