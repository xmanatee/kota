import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessRunOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import {
  type ResolvedScopePolicy,
  type RestrictiveScopePolicyChangeListener,
  resolveScopePolicy,
  type ScopePolicyAuthority,
  type ScopePolicySnapshot,
  scopePolicyRestrictiveAreas,
} from "#core/daemon/scope-policy.js";
import { runDelegateHarness } from "./delegate-harness.js";
import { withToolCallExecutionOptions } from "./tool-runner-runtime.js";
import type { ToolCallExecutionOptions } from "./tool-runner-types.js";

const SCOPE_ID = "native-delegate-fixture";
const OK_RESULT = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

afterEach(() => {
  clearAgentHarnessRegistryForTest();
  vi.restoreAllMocks();
});

describe("runDelegateHarness native invalidation", () => {
  it.each([
    {
      terminal: "success",
      fails: false,
      finish: async () => OK_RESULT,
    },
    {
      terminal: "thrown failure",
      fails: true,
      finish: async () => {
        throw new Error("native delegate failed");
      },
    },
  ])("disposes live invalidation after $terminal", async ({ fails, finish }) => {
    const authority = mutableAuthority(snapshot(0, policy("scope-directory")));
    const parent = new AbortController();
    const run = vi.fn(async (options: AgentHarnessRunOptions) => {
      options.abortQuarantine?.register(() => {});
      expect(options.abortController).toBeInstanceOf(AbortController);
      expect(options.abortController?.signal).not.toBe(parent.signal);
      expect(options.allowedTools).toBeUndefined();
      expect(options.canUseTool).toBeUndefined();
      expect(options.scopePolicyAuthority).toBeUndefined();
      return finish();
    });
    registerAgentHarness(nativeHarness("native-terminal", run));

    const execution = runWithLiveContext("native-terminal", authority, parent);
    if (fails) {
      await expect(execution).rejects.toThrow("native delegate failed");
    } else {
      const result = await execution;
      expect(result.is_error).toBeUndefined();
    }

    expect(run).toHaveBeenCalledOnce();
    expect(authority.subscribeCount()).toBe(1);
    expect(authority.unsubscribeCount()).toBe(1);
    expect(authority.listenerCount()).toBe(0);
  });

  it("links the inherited parent signal to native quarantine", async () => {
    const authority = mutableAuthority(snapshot(0, policy("scope-directory")));
    const parent = new AbortController();
    const reason = new Error("parent tool call aborted");
    const quarantine = vi.fn();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const run = vi.fn(async (options: AgentHarnessRunOptions) => {
      options.abortQuarantine?.register(quarantine);
      markStarted();
      return new Promise<typeof OK_RESULT>(() => {});
    });
    registerAgentHarness(nativeHarness("native-parent-abort", run));

    const execution = runWithLiveContext(
      "native-parent-abort",
      authority,
      parent,
    );
    await started;
    parent.abort(reason);

    await expect(execution).rejects.toBe(reason);
    expect(quarantine).toHaveBeenCalledOnce();
    expect(authority.unsubscribeCount()).toBe(1);
    expect(authority.listenerCount()).toBe(0);
  });

  it("aborts native quarantine when authority becomes more restrictive", async () => {
    const authority = mutableAuthority(snapshot(3, policy("scope-directory")));
    const parent = new AbortController();
    const quarantine = vi.fn();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const run = vi.fn(async (options: AgentHarnessRunOptions) => {
      options.abortQuarantine?.register(quarantine);
      markStarted();
      return new Promise<typeof OK_RESULT>(() => {});
    });
    registerAgentHarness(nativeHarness("native-policy-abort", run));

    const execution = runWithLiveContext(
      "native-policy-abort",
      authority,
      parent,
    );
    await started;
    authority.emit(snapshot(4, policy("none")));

    await expect(execution).rejects.toThrow(
      /Native delegate harness "native-policy-abort" stopped.*revision 3 -> 4.*writes/,
    );
    expect(quarantine).toHaveBeenCalledOnce();
    expect(authority.unsubscribeCount()).toBe(1);
    expect(authority.listenerCount()).toBe(0);
  });

  it("fails before native launch without inherited live invalidation context", async () => {
    const run = vi.fn(async () => OK_RESULT);
    registerAgentHarness(nativeHarness("native-unsafe", run));

    await expect(
      runDelegateHarness("unsafe", "execute", { harness: "native-unsafe" }),
    ).rejects.toThrow(
      /native-unsafe.*parent AbortSignal.*scope id.*scope-policy authority.*current scope-policy snapshot.*refusing to launch/,
    );
    expect(run).not.toHaveBeenCalled();
  });
});

function nativeHarness(
  name: string,
  run: AgentHarness["run"],
): AgentHarness {
  return {
    name,
    description: `Native delegate fixture ${name}`,
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "native",
    nativeAbortQuarantine: "confirmed-stop",
    run,
  };
}

function runWithLiveContext(
  harness: string,
  authority: ScopePolicyAuthority,
  parent: AbortController,
) {
  const getScopePolicySnapshot = () => authority.getSnapshot(SCOPE_ID);
  const options: ToolCallExecutionOptions = {
    resultLimit: 50_000,
    verbose: false,
    autonomyMode: "autonomous",
    scopePolicy: getScopePolicySnapshot().policy,
    scopePolicyAuthority: authority,
    getScopePolicySnapshot,
    scopeId: SCOPE_ID,
    signal: parent.signal,
    canUseTool: async () => ({ behavior: "allow" }),
  };
  return withToolCallExecutionOptions(options, () =>
    runDelegateHarness("exercise native invalidation", "execute", { harness })
  );
}

function snapshot(
  revision: number,
  resolvedPolicy: ResolvedScopePolicy,
): ScopePolicySnapshot {
  return { revision, policy: resolvedPolicy };
}

function policy(
  writes: "none" | "scope-directory",
): ResolvedScopePolicy {
  return resolveScopePolicy({
    projection: {
      rootScopeId: "global",
      defaultScopeId: SCOPE_ID,
      scopes: [
        { scopeId: "global", displayName: "Global" },
        {
          scopeId: SCOPE_ID,
          displayName: "Native delegate fixture",
          parentScopeId: "global",
          directoryRoot: "/tmp/native-delegate-fixture",
        },
      ],
    },
    scopeId: SCOPE_ID,
    fragments: [{
      scopeId: SCOPE_ID,
      reason: `Fixture uses ${writes} writes.`,
      writes: { mode: writes },
    }],
  });
}

function mutableAuthority(initial: ScopePolicySnapshot): ScopePolicyAuthority & {
  emit(current: ScopePolicySnapshot): void;
  listenerCount(): number;
  subscribeCount(): number;
  unsubscribeCount(): number;
} {
  let currentSnapshot = initial;
  let subscriptions = 0;
  let unsubscriptions = 0;
  const listeners = new Set<RestrictiveScopePolicyChangeListener>();
  return {
    getSnapshot: (scopeId) => {
      if (scopeId !== SCOPE_ID) throw new Error(`Unexpected scope ${scopeId}`);
      return currentSnapshot;
    },
    subscribeRestrictiveChanges: (scopeId, listener) => {
      if (scopeId !== SCOPE_ID) throw new Error(`Unexpected scope ${scopeId}`);
      subscriptions += 1;
      listeners.add(listener);
      return () => {
        unsubscriptions += 1;
        listeners.delete(listener);
      };
    },
    emit: (current) => {
      const previous = currentSnapshot;
      currentSnapshot = current;
      const restrictiveAreas = scopePolicyRestrictiveAreas(
        previous.policy,
        current.policy,
      );
      for (const listener of [...listeners]) {
        listener({ scopeId: SCOPE_ID, previous, current, restrictiveAreas });
      }
    },
    listenerCount: () => listeners.size,
    subscribeCount: () => subscriptions,
    unsubscribeCount: () => unsubscriptions,
  };
}
