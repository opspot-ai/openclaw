import type { ControlUiHost, ControlUiViewContext } from "openclaw/plugin-sdk/control-ui";
import { vi } from "vitest";

export function createMacropadTestHost() {
  const abort = new AbortController();
  const listeners = new Set<() => void>();
  const events = new Map<string, Set<(payload: unknown) => void>>();
  const connection = {
    connected: false,
    canRead: true,
    canWrite: true,
    canGrant: true,
    canAdmin: true,
    assistantAgentId: "main",
  };
  const registrations = new Map<string, unknown>();
  const register = (kind: string) => (entry: { id: string }) => {
    const key = `${kind}/${entry.id}`;
    registrations.set(key, entry);
    return () => {
      registrations.delete(key);
    };
  };
  const host: ControlUiHost = {
    apiVersion: 1,
    pluginId: "macropad",
    signal: abort.signal,
    basePath: "",
    locale: "en",
    redact: vi.fn((text) => text),
    connection,
    request: vi.fn(async () => ({}) as never),
    onEvent: (event, listener) => {
      let entries = events.get(event);
      if (!entries) {
        entries = new Set();
        events.set(event, entries);
      }
      entries.add(listener);
      return () => {
        entries.delete(listener);
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sessions: {
      rows: [],
      selectedKey: "main",
      normalizeKey: vi.fn((key) => key.trim().toLowerCase()),
      refresh: vi.fn(async () => undefined),
      observe: vi.fn<ControlUiHost["sessions"]["observe"]>((_query, listener) => {
        listener({
          result: { sessions: [], hasMore: false, totalCount: 0 },
          loading: false,
          error: null,
        });
        return { refresh: vi.fn(async () => undefined), dispose: vi.fn() };
      }),
      open: vi.fn(),
      create: vi.fn(async () => null),
      patch: vi.fn(async () => undefined),
    },
    agents: {
      rows: [],
      selectedId: "main",
      scopeId: null,
      defaultId: "main",
      select: vi.fn(),
      setScope: vi.fn(),
      refresh: vi.fn(async () => undefined),
    },
    navigation: {
      openPage: vi.fn(),
      pageHref: ({ id }) => `/${id}`,
    },
    components: {
      mountDialog: () => {
        throw new Error("This test did not install DOM components");
      },
      mountAgentPicker: () => {
        throw new Error("This test did not install DOM components");
      },
      mountDashboard: () => {
        throw new Error("This test did not install DOM components");
      },
    },
    ui: {
      invalidate: vi.fn(),
      registerPage: register("page"),
      registerNavigation: register("navigation"),
      registerPanel: register("panel"),
      registerAction: register("action"),
      registerAccessory: register("accessory"),
      registerWidget: register("widget"),
      registerReplacement: register("replacement"),
      selectReplacement: vi.fn(),
    },
  };
  return {
    host,
    connection,
    registrations,
    listeners,
    events,
    notify() {
      for (const listener of listeners) {
        listener();
      }
    },
    emit(event: string, payload: unknown) {
      for (const listener of events.get(event) ?? []) {
        listener(payload);
      }
    },
    dispose() {
      abort.abort();
      listeners.clear();
      events.clear();
    },
  };
}

export function createViewContext<T>(
  host: ControlUiHost,
  props: T,
  presented = true,
): ControlUiViewContext<T> {
  return { host, props, presented, signal: host.signal, mountDefault: () => () => undefined };
}
