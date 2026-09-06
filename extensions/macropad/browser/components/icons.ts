import { html, svg, type SVGTemplateResult } from "lit";

function strokeIcon(body: SVGTemplateResult) {
  return html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ${body}
  </svg>`;
}

// Extensions cannot import the host's icon registry, so the few glyphs this
// plugin needs are redrawn here in the same Lucide-style stroke shell.
export const icons = {
  layoutGrid: strokeIcon(svg` <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />`),
  plug: strokeIcon(svg` <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" />`),
  shieldAlert: strokeIcon(svg` <path
      d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
    />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />`),
  check: strokeIcon(svg`<path d="M20 6 9 17l-5-5" />`),
  zap: strokeIcon(svg`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />`),
  pin: strokeIcon(svg` <path d="M12 17v5" />
    <path
      d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
    />`),
  x: strokeIcon(svg` <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />`),
};
