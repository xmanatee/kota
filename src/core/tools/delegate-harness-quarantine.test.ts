import { afterEach, expect, it, vi } from "vitest";
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
import { BufferTransport } from "#core/loop/transport.js";
import { setDelegateConfig } from "./delegate.js";
import { executeToolCalls } from "./tool-runner.js";

const SCOPE_ID = "native-delegate-fixture";
const PROJECT_DIR = process.cwd();
const HARNESS = "native-hosted-route";
afterEach(() => {
  clearAgentHarnessRegistryForTest();
  setDelegateConfig({ model: "gpt-5.6-sol" });
  vi.restoreAllMocks();
});
it("quarantines hosted native activity after a mid-run restriction", async () => {
    const authority = mutableAuthority(snapshot(7, policy("unrestricted")));
    const parent = new AbortController();
    const parentAdds = vi.spyOn(parent.signal, "addEventListener");
    const parentRemoves = vi.spyOn(parent.signal, "removeEventListener");
    const transport = new BufferTransport();
    const attemptedNativeActions: string[] = [];
    const acceptedNativeEffects: string[] = [];
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let releaseNative = () => {};
    const released = new Promise<void>((resolve) => {
      releaseNative = resolve;
    });
    let markNativeFinished = () => {};
    const nativeFinished = new Promise<void>((resolve) => {
      markNativeFinished = resolve;
    });
    let quarantineCompleted = false;
    let lateWriterAccepted: boolean | undefined;
    const runtimeTrace: string[] = [];
    const recordRuntimeEvent = (
      event: string,
      evidence: Record<string, string | number | boolean>,
    ) => {
      runtimeTrace.push(event);
      console.info(
        `[native-delegate-quarantine] ${JSON.stringify({ event, ...evidence })}`,
      );
    };
    const run = vi.fn(async (options: AgentHarnessRunOptions, writer) => {
      expect(options.abortController).toBeInstanceOf(AbortController);
      expect(options.allowedTools).toBeUndefined();
      expect(options.canUseTool).toBeUndefined();
      expect(options.scopePolicyAuthority).toBeUndefined();
      options.abortQuarantine?.register(async () => {
        recordRuntimeEvent("native_child_abort_observed", {
          aborted: options.abortController?.signal.aborted ?? false,
        });
        releaseNative();
        await nativeFinished;
        quarantineCompleted = true;
        recordRuntimeEvent("native_quarantine_completed", {
          nativeFinished: true,
        });
      });
      const startAccepted = writer?.write("native delegate started") ?? false;
      recordRuntimeEvent("native_delegate_started", {
        harness: HARNESS,
        writerAccepted: startAccepted,
      });
      expect(startAccepted).toBe(true);
      markStarted();
      await released;
      attemptedNativeActions.push("write-after-restriction");
      if (!options.abortController?.signal.aborted) {
        acceptedNativeEffects.push("write-after-restriction");
      }
      recordRuntimeEvent("post_restriction_action_attempted", {
        attempted: true,
        accepted: acceptedNativeEffects.length > 0,
      });
      lateWriterAccepted = writer?.write("stale native output");
      recordRuntimeEvent("late_native_output_attempted", {
        attempted: true,
        accepted: lateWriterAccepted ?? false,
      });
      markNativeFinished();
      recordRuntimeEvent("stale_terminal_success_returned", { isError: false });
      return {
        text: "stale successful terminal output",
        streamedText: "stale successful terminal output",
        turns: 1,
        isError: false,
      };
    });
    registerAgentHarness(nativeHarness(run));
    setDelegateConfig({
      model: "gpt-5.6-sol",
      backend: "agent-sdk",
      harness: HARNESS,
      cwd: PROJECT_DIR,
      transport,
    });
    const initial = authority.getSnapshot(SCOPE_ID);
    const execution = executeToolCalls(
      [{
        type: "tool_use",
        id: "parent-delegate-call",
        name: "delegate",
        input: {
          task: "Attempt a native write only after the authority revision changes.",
          mode: "execute",
        },
      }],
      {
        resultLimit: 50_000,
        verbose: false,
        autonomyMode: "autonomous",
        scopePolicy: initial.policy,
        scopePolicyAuthority: authority,
        getScopePolicySnapshot: () => authority.getSnapshot(SCOPE_ID),
        scopeId: SCOPE_ID,
        projectId: SCOPE_ID,
        cwd: PROJECT_DIR,
        signal: parent.signal,
      },
    );
    recordRuntimeEvent("parent_delegate_dispatched", {
      authorityRevision: initial.revision,
      tool: "delegate",
      toolCallId: "parent-delegate-call",
    });
    await Promise.race([
      started,
      execution.then(([result]) => {
        throw new Error(
          `Hosted delegate ended before native start: ${result?.content ?? "missing result"}`,
        );
      }),
    ]);
    expect(run).toHaveBeenCalledOnce();
    expect(authority.listenerCount()).toBe(1);
    recordRuntimeEvent("restrictive_policy_emitted", {
      fromRevision: 7,
      toRevision: 8,
      writesRestricted: true,
    });
    authority.emit(snapshot(8, policy("none")));
    const [result] = await execution;
    await nativeFinished;
    expect(result).toMatchObject({ is_error: true });
    expect(result?.content).toMatch(
      /Native delegate harness "native-hosted-route" stopped.*revision 7 -> 8.*writes/,
    );
    expect(result?.content).not.toContain("stale successful terminal output");
    recordRuntimeEvent("stale_terminal_success_rejected", {
      parentReturnedError: result?.is_error ?? false,
      staleSuccessAccepted: result?.content.includes(
        "stale successful terminal output",
      ) ?? false,
    });
    expect(attemptedNativeActions).toEqual(["write-after-restriction"]);
    expect(acceptedNativeEffects).toEqual([]);
    expect(lateWriterAccepted).toBe(false);
    expect(quarantineCompleted).toBe(true);
    expect(transport.events).toContainEqual({
      type: "progress",
      content: "native delegate started",
      source: `delegate(execute:${HARNESS})`,
    });
    expect(transport.events).not.toContainEqual(
      expect.objectContaining({ content: "stale native output" }),
    );
    expect(authority.subscribeCount()).toBe(1);
    expect(authority.unsubscribeCount()).toBe(1);
    expect(authority.listenerCount()).toBe(0);
    const parentAbortListeners = parentAdds.mock.calls
      .filter(([type]) => type === "abort")
      .map(([, listener]) => listener);
    expect(parentAbortListeners).toHaveLength(1);
    expect(parentRemoves).toHaveBeenCalledWith(
      "abort",
      parentAbortListeners[0],
    );
    recordRuntimeEvent("listeners_released", {
      authoritySubscribed: authority.subscribeCount(),
      authorityUnsubscribed: authority.unsubscribeCount(),
      authorityLive: authority.listenerCount(),
      parentAbortAdded: parentAbortListeners.length,
      parentAbortRemoved: parentRemoves.mock.calls.filter(
        ([type]) => type === "abort",
      ).length,
    });
    expect(runtimeTrace).toEqual([
      "parent_delegate_dispatched",
      "native_delegate_started",
      "restrictive_policy_emitted",
      "native_child_abort_observed",
      "post_restriction_action_attempted",
      "late_native_output_attempted",
      "stale_terminal_success_returned",
      "native_quarantine_completed",
      "stale_terminal_success_rejected",
      "listeners_released",
    ]);
});

function nativeHarness(run: AgentHarness["run"]): AgentHarness {
  return {
    name: HARNESS,
    description: "Native hosted delegate fixture",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "native",
    nativeAbortQuarantine: "confirmed-stop",
    run,
  };
}

function snapshot(revision: number, resolvedPolicy: ResolvedScopePolicy) {
  return { revision, policy: resolvedPolicy } satisfies ScopePolicySnapshot;
}

function policy(writes: "none" | "unrestricted"): ResolvedScopePolicy {
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
          directoryRoot: PROJECT_DIR,
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
