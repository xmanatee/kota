import { afterEach, describe, expect, it } from "vitest";
import {
  defineSessionResourceKey,
  getSessionEnvironmentResource,
  injectSessionEnvironmentVariable,
  registerSessionEnvironment,
  registerSessionEnvironmentResource,
  sessionEnvironmentForExecution,
  sessionEnvironmentVersionForExecution,
  unregisterSessionEnvironment,
} from "./session-environment.js";

const sessionAScopeA = { sessionId: "session-a", scopeId: "scope-a" };
const sessionBScopeA = { sessionId: "session-b", scopeId: "scope-a" };
const sessionAScopeB = { sessionId: "session-a", scopeId: "scope-b" };

describe("session credential environments", () => {
  afterEach(async () => {
    await unregisterSessionEnvironment(sessionAScopeA);
    await unregisterSessionEnvironment(sessionBScopeA);
    await unregisterSessionEnvironment(sessionAScopeB);
  });

  it("isolates credentials by both session and project", () => {
    registerSessionEnvironment(sessionAScopeA);
    registerSessionEnvironment(sessionBScopeA);
    registerSessionEnvironment(sessionAScopeB);

    injectSessionEnvironmentVariable(
      sessionAScopeA,
      "KOTA_SESSION_SECRET",
      "session-a-scope-a-value",
    );

    expect(sessionEnvironmentForExecution(sessionAScopeA)).toEqual({
      KOTA_SESSION_SECRET: "session-a-scope-a-value",
    });
    expect(sessionEnvironmentForExecution(sessionBScopeA)).toEqual({});
    expect(sessionEnvironmentForExecution(sessionAScopeB)).toEqual({});
  });

  it("keeps runtime session identity separate from workflow trace identity", () => {
    const context = {
      ...sessionAScopeA,
      scopeId: sessionAScopeA.scopeId,
      workflow: {
        workflowName: "builder",
        runId: "run-1",
        stepId: "build",
        spanId: "run-1:build",
        scopeId: sessionAScopeA.scopeId,
      },
    };
    registerSessionEnvironment(context);
    injectSessionEnvironmentVariable(
      context,
      "KOTA_SESSION_SECRET",
      "runtime-session-value",
    );

    expect(sessionEnvironmentForExecution(context)).toEqual({
      KOTA_SESSION_SECRET: "runtime-session-value",
    });
  });

  it("erases credentials and rejects stale approvals after teardown", async () => {
    registerSessionEnvironment(sessionAScopeA);
    injectSessionEnvironmentVariable(
      sessionAScopeA,
      "KOTA_SESSION_SECRET",
      "temporary-value",
    );

    await unregisterSessionEnvironment(sessionAScopeA);

    expect(sessionEnvironmentForExecution(sessionAScopeA)).toEqual({});
    expect(() =>
      injectSessionEnvironmentVariable(
        sessionAScopeA,
        "KOTA_SESSION_SECRET",
        "stale-value",
      )
    ).toThrow("Credential injection requires a live session");
  });

  it("invalidates and awaits long-lived execution resources", async () => {
    registerSessionEnvironment(sessionAScopeA);
    const initialVersion = sessionEnvironmentVersionForExecution(
      sessionAScopeA,
    );
    let cleaned = false;
    registerSessionEnvironmentResource(sessionAScopeA, async () => {
      await Promise.resolve();
      cleaned = true;
    });

    injectSessionEnvironmentVariable(
      sessionAScopeA,
      "KOTA_SESSION_SECRET",
      "temporary-value",
    );

    expect(sessionEnvironmentVersionForExecution(sessionAScopeA)).not.toBe(
      initialVersion,
    );
    await unregisterSessionEnvironment(sessionAScopeA);
    expect(cleaned).toBe(true);
  });

  it("rejects malformed environment variable names", () => {
    registerSessionEnvironment(sessionAScopeA);
    expect(() =>
      injectSessionEnvironmentVariable(
        sessionAScopeA,
        "NOT-A-VARIABLE",
        "value",
      )
    ).toThrow("is not a valid environment variable");
  });

  it("owns keyed resources through the final reference without crossing sessions or scopes", async () => {
    const key = defineSessionResourceKey<string[]>("scratchpad");
    const get = (context: typeof sessionAScopeA) => getSessionEnvironmentResource(
      context, key, () => [], (entries) => { entries.length = 0; },
    );
    registerSessionEnvironment(sessionAScopeA);
    registerSessionEnvironment(sessionAScopeA);
    registerSessionEnvironment(sessionBScopeA);
    registerSessionEnvironment(sessionAScopeB);
    const original = get(sessionAScopeA)!;
    original.push("private");
    expect(get(sessionAScopeA)).toBe(original);
    expect(get(sessionBScopeA)).toEqual([]);
    expect(get(sessionAScopeB)).toEqual([]);
    await unregisterSessionEnvironment(sessionAScopeA);
    expect(get(sessionAScopeA)).toEqual(["private"]);
    await unregisterSessionEnvironment(sessionAScopeA);
    expect(original).toEqual([]);
    expect(get(sessionAScopeA)).toBeUndefined();
    expect(get(sessionBScopeA)).toEqual([]);
    registerSessionEnvironment(sessionAScopeA);
    expect(get(sessionAScopeA)).toEqual([]);
    expect(get(sessionAScopeA)).not.toBe(original);
  });

  it("does not initialize resources without a live identity or cache a failed initialization", () => {
    const key = defineSessionResourceKey<string[]>("scratchpad");
    const fail = (): string[] => { throw new Error("failed to initialize"); };
    expect(getSessionEnvironmentResource(undefined, key, fail)).toBeUndefined();
    expect(getSessionEnvironmentResource({ scopeId: "scope-a" }, key, fail)).toBeUndefined();
    expect(getSessionEnvironmentResource(sessionAScopeA, key, fail)).toBeUndefined();
    registerSessionEnvironment(sessionAScopeA);
    expect(() => getSessionEnvironmentResource(sessionAScopeA, key, fail)).toThrow("failed to initialize");
    expect(getSessionEnvironmentResource(sessionAScopeA, key, () => ["ready"])).toEqual(["ready"]);
  });
});
