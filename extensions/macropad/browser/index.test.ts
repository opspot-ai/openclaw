import type { ControlUiAccessory, ControlUiAction } from "openclaw/plugin-sdk/control-ui";
import { expect, it, vi } from "vitest";
import { MACROPAD_SLOT_COUNT } from "../contract.ts";
import macropadPlugin from "./index.ts";
import { createDeviceStatus, createFullSlots, createSlot } from "./test/fixtures.ts";
import { macropadTestHost } from "./test/host.setup.ts";
import { createViewContext } from "./test/host.ts";

const SESSION = "agent:main:chat:deploy";

/** Answers the two watched queries the way the backend would. */
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

it("registers every surface and tears all of them down", async () => {
  const { host, connection, registrations, listeners, events } = macropadTestHost();
  connection.connected = true;
  host.request = stubBackend() as typeof host.request;

  const dispose = await macropadPlugin.activate(host);
  expect([...registrations.keys()].toSorted()).toEqual([
    "accessory/bound-key",
    "action/bind-key",
    "navigation/macropad",
    "page/macropad",
  ]);

  const navigation = registrations.get("navigation/macropad") as { icon: string; page: unknown };
  // Mode A: the router reads `id`, and a `path` here would be ignored anyway.
  expect(navigation.page).toEqual({ id: "macropad" });
  // No device state has arrived yet, so the sidebar starts unplugged.
  expect(navigation.icon).toBe("plug");

  dispose?.();
  expect(registrations.size).toBe(0);
  expect(listeners.size).toBe(0);
  expect([...events.values()].every((entries) => entries.size === 0)).toBe(true);
});

it("swaps the sidebar icon on state changes but not on battery readings", async () => {
  const fixture = macropadTestHost();
  const { host, connection, registrations } = fixture;
  connection.connected = true;
  // `watch` re-queries on an event rather than consuming its payload, so the
  // device the backend reports is what moves the icon.
  let device = createDeviceStatus({ batteryPercent: 100 });
  host.request = vi.fn(async (_method: string, params?: Record<string, unknown>) =>
    params?.actionId === "device.get"
      ? { ok: true, result: device }
      : { ok: true, result: { slots: [] } },
  ) as typeof host.request;

  const dispose = await macropadPlugin.activate(host);
  const navIcon = () => (registrations.get("navigation/macropad") as { icon: string }).icon;
  try {
    await vi.waitFor(() => expect(navIcon()).toBe("layoutGrid"));

    // A battery reading must not churn the registration.
    const registration = registrations.get("navigation/macropad");
    device = createDeviceStatus({ batteryPercent: 40 });
    fixture.emit("plugin.macropad.device_changed", device);
    await vi.waitFor(() => expect(vi.mocked(host.request).mock.calls.length).toBeGreaterThan(2));
    expect(navIcon()).toBe("layoutGrid");
    expect(registrations.get("navigation/macropad")).toBe(registration);

    // A lapsed Input Monitoring grant is a real state change and does re-register.
    device = createDeviceStatus({ inputPermissionRequired: true });
    fixture.emit("plugin.macropad.device_changed", device);
    await vi.waitFor(() => expect(navIcon()).toBe("shieldAlert"));

    device = createDeviceStatus({ connected: false });
    fixture.emit("plugin.macropad.device_changed", device);
    await vi.waitFor(() => expect(navIcon()).toBe("plug"));
  } finally {
    dispose?.();
  }
  expect(registrations.size).toBe(0);
});

it("keeps the session action in step with live device state", async () => {
  const fixture = macropadTestHost();
  const { host, connection, registrations } = fixture;
  connection.connected = true;
  let device = createDeviceStatus({ connected: false });
  let slots: ReturnType<typeof createSlot>[] = [];
  const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
    if (params?.actionId === "device.get") {
      return { ok: true, result: device };
    }
    if (params?.actionId === "slots.list") {
      return { ok: true, result: { slots } };
    }
    return { ok: true, result: { ok: true } };
  });
  host.request = request as typeof host.request;

  const dispose = await macropadPlugin.activate(host);
  try {
    const action = registrations.get("action/bind-key") as ControlUiAction;
    const context = { sessionKey: SESSION, agentId: "main" };

    // No device: the action hides rather than offering a control that cannot work.
    await vi.waitFor(() => expect(action.resolve?.(context)).toEqual({ hidden: true }));

    device = createDeviceStatus();
    fixture.emit("plugin.macropad.device_changed", device);
    await vi.waitFor(() =>
      expect(action.resolve?.(context)).toEqual({ label: "Bind to Macropad Key 1" }),
    );

    slots = [createSlot(0, { sessionKey: SESSION, activity: "thinking" })];
    fixture.emit("plugin.macropad.slots_changed", { slots });
    await vi.waitFor(() =>
      expect(action.resolve?.(context)).toEqual({ label: "Unbind from Macropad Key 1" }),
    );

    // Running the action releases the key it just named.
    request.mockClear();
    await action.run({ ...context, host, signal: host.signal });
    expect(request).toHaveBeenCalledWith("plugins.sessionAction", {
      pluginId: "macropad",
      actionId: "slots.unbind",
      payload: { index: 0 },
    });

    slots = createFullSlots(true);
    fixture.emit("plugin.macropad.slots_changed", { slots });
    await vi.waitFor(() =>
      expect(action.resolve?.(context)).toEqual({
        label: "Every Macropad key is pinned",
        disabled: true,
      }),
    );
    expect(slots).toHaveLength(MACROPAD_SLOT_COUNT);
  } finally {
    dispose?.();
  }
});

it("shows the bound key on the session header and releases it on click", async () => {
  const fixture = macropadTestHost();
  const { host, connection, registrations } = fixture;
  connection.connected = true;
  const slots = [
    createSlot(2, {
      sessionKey: SESSION,
      activity: "awaiting-approval",
      frame: { color: 0xff_b0_20, brightness: 0.5, effect: 4 },
    }),
  ];
  const request = stubBackend(createDeviceStatus(), slots);
  host.request = request as typeof host.request;

  const dispose = await macropadPlugin.activate(host);
  const container = document.createElement("div");
  const accessory = registrations.get("accessory/bound-key") as ControlUiAccessory;
  const mounted = accessory.mount(
    container,
    createViewContext(host, { sessionKey: SESSION, agentId: "main" }),
  );
  try {
    await vi.waitFor(() => expect(container.textContent).toContain("Key 3"));
    expect(container.textContent).toContain("Awaiting approval");
    const button = container.querySelector("button");
    // The dot carries the frame colour scaled by its brightness.
    expect(button?.getAttribute("style")).toContain("#805810");

    request.mockClear();
    button?.click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("plugins.sessionAction", {
        pluginId: "macropad",
        actionId: "slots.unbind",
        payload: { index: 2 },
      }),
    );
  } finally {
    mounted?.dispose?.();
    dispose?.();
  }
  expect(container.childElementCount).toBe(0);
});

it("hides the session accessory when no device is attached", async () => {
  const fixture = macropadTestHost();
  const { host, connection, registrations } = fixture;
  connection.connected = true;
  host.request = stubBackend(createDeviceStatus({ connected: false })) as typeof host.request;

  const dispose = await macropadPlugin.activate(host);
  const container = document.createElement("div");
  const accessory = registrations.get("accessory/bound-key") as ControlUiAccessory;
  const mounted = accessory.mount(
    container,
    createViewContext(host, { sessionKey: SESSION, agentId: "main" }),
  );
  try {
    await vi.waitFor(() => expect(vi.mocked(host.request)).toHaveBeenCalled());
    fixture.notify();
    expect(container.querySelector("button")).toBeNull();
  } finally {
    mounted?.dispose?.();
    dispose?.();
  }
});
