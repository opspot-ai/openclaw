import { describe, expect, it } from "vitest";
import {
  applyAgentEvent,
  applySessionRow,
  EMPTY_ACTIVITY_STATE,
  lookupActivity,
  projectAgentEventActivity,
  projectSessionRowActivity,
  capActivity,
  sessionRowLabel,
  type AgentEventLike,
} from "./session-status.js";

function event(overrides: Partial<AgentEventLike> & { stream: string }): AgentEventLike {
  return { sessionKey: "session-1", ts: 1_000, ...overrides };
}

describe("agent event projection", () => {
  it("maps lifecycle start to thinking", () => {
    expect(
      projectAgentEventActivity(event({ stream: "lifecycle", data: { phase: "start" } })),
    ).toBe("thinking");
  });

  it("maps lifecycle end to idle", () => {
    expect(projectAgentEventActivity(event({ stream: "lifecycle", data: { phase: "end" } }))).toBe(
      "idle",
    );
  });

  it("maps lifecycle error to error", () => {
    expect(
      projectAgentEventActivity(event({ stream: "lifecycle", data: { phase: "error" } })),
    ).toBe("error");
  });

  it("ignores the finishing phase, which is an attempt fence and not terminal", () => {
    // Core emits `finishing` before `end`/`error` on retries. Treating it as
    // terminal would blink the key dark mid-run.
    expect(
      projectAgentEventActivity(event({ stream: "lifecycle", data: { phase: "finishing" } })),
    ).toBeUndefined();
  });

  it("maps the thinking and assistant streams to thinking", () => {
    expect(projectAgentEventActivity(event({ stream: "thinking" }))).toBe("thinking");
    expect(projectAgentEventActivity(event({ stream: "assistant" }))).toBe("thinking");
  });

  it("maps the error stream to error", () => {
    expect(projectAgentEventActivity(event({ stream: "error" }))).toBe("error");
  });

  it("maps a requested approval to awaiting-approval", () => {
    expect(
      projectAgentEventActivity(
        event({ stream: "approval", data: { phase: "requested", status: "pending" } }),
      ),
    ).toBe("awaiting-approval");
  });

  it("treats a pending approval with no phase as awaiting-approval", () => {
    expect(
      projectAgentEventActivity(event({ stream: "approval", data: { status: "pending" } })),
    ).toBe("awaiting-approval");
  });

  it("returns a resolved approval to thinking, because the run continues", () => {
    expect(
      projectAgentEventActivity(
        event({ stream: "approval", data: { phase: "resolved", status: "approved" } }),
      ),
    ).toBe("thinking");
  });

  it("says nothing about liveness for mid-run bookkeeping streams", () => {
    for (const stream of ["usage", "item", "plan", "patch", "compaction", "tool"]) {
      expect(projectAgentEventActivity(event({ stream }))).toBeUndefined();
    }
  });

  it("says nothing when a lifecycle event carries no phase", () => {
    expect(projectAgentEventActivity(event({ stream: "lifecycle", data: {} }))).toBeUndefined();
    expect(projectAgentEventActivity(event({ stream: "lifecycle" }))).toBeUndefined();
  });
});

describe("session row projection", () => {
  it("maps a running or queued row to thinking", () => {
    expect(projectSessionRowActivity({ key: "s", status: "running" })).toBe("thinking");
    expect(projectSessionRowActivity({ key: "s", status: "queued" })).toBe("thinking");
  });

  it("maps a done row to idle", () => {
    expect(projectSessionRowActivity({ key: "s", status: "done" })).toBe("idle");
  });

  it("maps every terminal failure status to error", () => {
    for (const status of ["failed", "killed", "timeout"]) {
      expect(projectSessionRowActivity({ key: "s", status })).toBe("error");
    }
  });

  it("treats a recorded run error as error even when the status looks clean", () => {
    expect(projectSessionRowActivity({ key: "s", status: "done", lastRunError: "boom" })).toBe(
      "error",
    );
  });

  it("ignores a blank run error string", () => {
    expect(projectSessionRowActivity({ key: "s", status: "done", lastRunError: "  " })).toBe(
      "idle",
    );
  });

  it("falls back to idle for an absent or unrecognised status", () => {
    expect(projectSessionRowActivity({ key: "s" })).toBe("idle");
    expect(projectSessionRowActivity({ key: "s", status: "hibernating" })).toBe("idle");
  });

  it("prefers label, then derived title, then display name", () => {
    expect(
      sessionRowLabel({
        key: "s",
        label: "Label",
        derivedTitle: "Derived",
        displayName: "Display",
      }),
    ).toBe("Label");
    expect(sessionRowLabel({ key: "s", derivedTitle: "Derived", displayName: "Display" })).toBe(
      "Derived",
    );
    expect(sessionRowLabel({ key: "s", displayName: "Display" })).toBe("Display");
    expect(sessionRowLabel({ key: "s", label: "   " })).toBeUndefined();
    expect(sessionRowLabel({ key: "s" })).toBeUndefined();
  });
});

describe("event and row precedence", () => {
  it("lets an event overwrite what a row said", () => {
    let state = applySessionRow(EMPTY_ACTIVITY_STATE, { key: "s", status: "done" });
    state = applyAgentEvent(state, event({ stream: "thinking", sessionKey: "s", ts: 5 }));

    expect(lookupActivity(state, "s")?.activity).toBe("thinking");
  });

  it("never lets a row overwrite a live event, however new the row looks", () => {
    // The startup row sweep must not repaint a thinking key back to idle.
    let state = applyAgentEvent(
      EMPTY_ACTIVITY_STATE,
      event({ stream: "thinking", sessionKey: "s", ts: 5 }),
    );
    state = applySessionRow(state, { key: "s", status: "done", lastActivityAt: 9_999 });

    expect(lookupActivity(state, "s")?.activity).toBe("thinking");
    expect(lookupActivity(state, "s")?.source).toBe("event");
  });

  it("still learns a tint from a row that lost the activity race", () => {
    let state = applyAgentEvent(
      EMPTY_ACTIVITY_STATE,
      event({ stream: "thinking", sessionKey: "s", ts: 5 }),
    );
    state = applySessionRow(state, {
      key: "s",
      status: "done",
      color: "purple",
      label: "Refactor",
    });

    expect(lookupActivity(state, "s")).toMatchObject({
      activity: "thinking",
      color: "purple",
      label: "Refactor",
    });
  });

  it("applies the newer of two events and ignores a stale one", () => {
    let state = applyAgentEvent(
      EMPTY_ACTIVITY_STATE,
      event({ stream: "error", sessionKey: "s", ts: 100 }),
    );
    state = applyAgentEvent(state, event({ stream: "thinking", sessionKey: "s", ts: 50 }));

    expect(lookupActivity(state, "s")?.activity).toBe("error");
  });

  it("applies a later row over an earlier row", () => {
    let state = applySessionRow(EMPTY_ACTIVITY_STATE, {
      key: "s",
      status: "running",
      lastActivityAt: 10,
    });
    state = applySessionRow(state, { key: "s", status: "done", lastActivityAt: 20 });

    expect(lookupActivity(state, "s")?.activity).toBe("idle");
  });

  it("keeps a colour a row taught it when a later event arrives", () => {
    let state = applySessionRow(EMPTY_ACTIVITY_STATE, { key: "s", status: "done", color: "cyan" });
    state = applyAgentEvent(state, event({ stream: "thinking", sessionKey: "s", ts: 5 }));

    expect(lookupActivity(state, "s")).toMatchObject({ activity: "thinking", color: "cyan" });
  });

  it("drops events that cannot be attributed to a session", () => {
    expect(applyAgentEvent(EMPTY_ACTIVITY_STATE, { stream: "thinking" })).toBe(
      EMPTY_ACTIVITY_STATE,
    );
    expect(applyAgentEvent(EMPTY_ACTIVITY_STATE, { stream: "thinking", sessionKey: "" })).toBe(
      EMPTY_ACTIVITY_STATE,
    );
  });

  it("ignores an event whose stream says nothing", () => {
    expect(applyAgentEvent(EMPTY_ACTIVITY_STATE, event({ stream: "usage" }))).toBe(
      EMPTY_ACTIVITY_STATE,
    );
  });

  it("drops rows with no session key", () => {
    expect(applySessionRow(EMPTY_ACTIVITY_STATE, { key: "" })).toBe(EMPTY_ACTIVITY_STATE);
  });

  it("records the agent id an event carries", () => {
    const state = applyAgentEvent(
      EMPTY_ACTIVITY_STATE,
      event({ stream: "thinking", sessionKey: "s", agentId: "main" }),
    );

    expect(lookupActivity(state, "s")?.agentId).toBe("main");
  });
});

describe("bounding the activity map", () => {
  function withSessions(count: number) {
    let state = EMPTY_ACTIVITY_STATE;
    for (let index = 0; index < count; index++) {
      state = applySessionRow(state, {
        key: `s${index}`,
        status: "running",
        color: "cyan",
        lastActivityAt: index,
      });
    }
    return state;
  }

  it("keeps unbound sessions under the limit, so a later bind still finds their colour", () => {
    // Evicting on "not bound yet" would strip the tint a row just taught us.
    const state = withSessions(5);

    expect(capActivity(state, new Set(), 10)).toBe(state);
    expect(lookupActivity(capActivity(state, new Set(), 10), "s3")?.color).toBe("cyan");
  });

  it("trims the oldest unbound sessions once past the limit", () => {
    const state = withSessions(10);

    const capped = capActivity(state, new Set(), 4);

    expect(capped.entries.size).toBe(4);
    expect([...capped.entries.keys()].toSorted()).toEqual(["s6", "s7", "s8", "s9"]);
  });

  it("never trims a bound session, however stale", () => {
    const state = withSessions(10);

    const capped = capActivity(state, new Set(["s0"]), 2);

    expect(capped.entries.has("s0")).toBe(true);
    expect(capped.entries.size).toBe(3);
  });
});
