import type { ControlUiPage } from "openclaw/plugin-sdk/control-ui";
import { expect, it, vi } from "vitest";
import { MACROPAD_SLOT_COUNT } from "../../../contract.ts";
import macropadPlugin from "../../index.ts";
import { createDeviceStatus, createSlot } from "../../test/fixtures.ts";
import { macropadTestHost } from "../../test/host.setup.ts";
import { createViewContext } from "../../test/host.ts";

const SESSION = "agent:main:chat:deploy";

function stubBackend(device = createDeviceStatus(), slots: ReturnType<typeof createSlot>[] = []) {
  return vi.fn(async (_method: string, params?: Record<string, unknown>) => {
    if (params?.actionId === "device.get") {
      return { ok: true, result: device };
    }
    if (params?.actionId === "slots.list") {
      return { ok: true, result: { slots } };
    }
    return { ok: true, result: { ok: true } };
  });
}

async function mountPage(request: ReturnType<typeof stubBackend>) {
  const fixture = macropadTestHost();
  fixture.connection.connected = true;
  fixture.host.request = request as typeof fixture.host.request;
  const dispose = await macropadPlugin.activate(fixture.host);
  const page = fixture.registrations.get("page/macropad") as ControlUiPage;
  const container = document.createElement("div");
  const mounted = page.mount(container, createViewContext(fixture.host, {}));
  return {
    fixture,
    container,
    teardown: () => {
      mounted?.dispose?.();
      dispose?.();
    },
  };
}

it("mirrors the device header and every physical key", async () => {
  const slots = [
    createSlot(0, {
      sessionKey: SESSION,
      activity: "thinking",
      frame: { color: 0x4c_8d_ff, brightness: 1, effect: 4 },
    }),
    createSlot(1, { sessionKey: "agent:main:chat:pinned", pinned: true }),
  ];
  const { fixture, container, teardown } = await mountPage(
    stubBackend(createDeviceStatus(), slots),
  );
  Object.assign(fixture.host.sessions, {
    rows: [
      { key: SESSION, kind: "direct", label: "Deploy run", agentId: "main" },
      { key: "agent:main:chat:pinned", kind: "direct", derivedTitle: "Pinned chat" },
    ],
  });
  try {
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".macropad-key")).toHaveLength(MACROPAD_SLOT_COUNT),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Connected");
    expect(text).toContain("Codex Micro");
    expect(text).toContain("441BF6D10AB4");
    expect(text).toContain("0.6.0");
    expect(text).toContain("Granted");
    expect(text).toContain("Deploy run");
    expect(text).toContain("Working");
    // Unbound keys still render, so the mirror always shows the whole device.
    expect(container.querySelectorAll(".macropad-key__session--empty")).toHaveLength(4);
    // A breathing effect is called out rather than shown as a still colour.
    expect(container.querySelectorAll(".macropad-key__cap--animated")).toHaveLength(1);
    expect(container.querySelectorAll(".macropad-key__pin")).toHaveLength(1);
  } finally {
    teardown();
  }
});

it("shows battery in the header pill and its own status row", async () => {
  const { container, teardown } = await mountPage(
    stubBackend(createDeviceStatus({ batteryPercent: 100 })),
  );
  try {
    // The pill always renders, so wait on connected content, not its presence.
    await vi.waitFor(() => expect(container.textContent).toContain("Codex Micro"));
    const pill = container.querySelector(".macropad-pill");
    expect(pill?.textContent?.replace(/\s+/g, " ").trim()).toBe("Connected · 100%");
    expect(pill?.className).toContain("macropad-pill--ok");
    expect(pill?.querySelector(".macropad-battery")).not.toBeNull();
    expect(container.textContent).toContain("Battery");
  } finally {
    teardown();
  }
});

it("warns on a low battery but not while charging", async () => {
  const low = await mountPage(stubBackend(createDeviceStatus({ batteryPercent: 8 })));
  try {
    await vi.waitFor(() =>
      expect(low.container.querySelector(".macropad-pill--warn")).not.toBeNull(),
    );

    expect(low.container.textContent).toContain("Battery is low.");
  } finally {
    low.teardown();
  }
  const charging = await mountPage(
    stubBackend(createDeviceStatus({ batteryPercent: 8, charging: true })),
  );
  try {
    await vi.waitFor(() => expect(charging.container.textContent).toContain("Charging"));
    expect(charging.container.querySelector(".macropad-pill--warn")).toBeNull();
    expect(charging.container.textContent).toContain("8% · Charging");
  } finally {
    charging.teardown();
  }
});

it("omits battery entirely when the device reports none", async () => {
  const { container, teardown } = await mountPage(stubBackend(createDeviceStatus()));
  try {
    await vi.waitFor(() => expect(container.textContent).toContain("Codex Micro"));
    expect(container.querySelector(".macropad-pill")?.textContent?.trim()).toBe("Connected");
    expect(container.querySelector(".macropad-battery")).toBeNull();
    expect(container.textContent).not.toContain("Battery");
  } finally {
    teardown();
  }
});

it("warns when macOS is withholding key presses without calling the device down", async () => {
  const { container, teardown } = await mountPage(
    stubBackend(createDeviceStatus({ inputPermissionRequired: true })),
  );
  try {
    await vi.waitFor(() => expect(container.textContent).toContain("Not granted"));
    const text = container.textContent ?? "";
    expect(text).toContain("Connected");
    expect(text).toContain("System Settings");
  } finally {
    teardown();
  }
});

it("binds a session through the per-key dropdown", async () => {
  const request = stubBackend();
  const { fixture, container, teardown } = await mountPage(request);
  Object.assign(fixture.host.sessions, {
    rows: [{ key: SESSION, kind: "direct", label: "Deploy run", agentId: "main" }],
  });
  try {
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".macropad-key").length).toBeGreaterThan(0),
    );
    fixture.notify();
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".macropad-key__select option")).toHaveLength(
        MACROPAD_SLOT_COUNT * 2,
      ),
    );
    const select = container.querySelectorAll<HTMLSelectElement>(".macropad-key__select")[2];
    request.mockClear();
    select!.value = SESSION;
    select!.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("plugins.sessionAction", {
        pluginId: "macropad",
        actionId: "slots.bind",
        payload: { sessionKey: SESSION, agentId: "main", index: 2 },
      }),
    );
  } finally {
    teardown();
  }
});

it("reports a device with no keys instead of an empty grid", async () => {
  const { container, teardown } = await mountPage(
    stubBackend(createDeviceStatus({ connected: false, lastError: "No supported device found." })),
  );
  try {
    await vi.waitFor(() => expect(container.textContent).toContain("No macropad is connected."));
    expect(container.textContent).toContain("No supported device found.");
    expect(container.querySelectorAll(".macropad-key")).toHaveLength(0);
  } finally {
    teardown();
  }
});
