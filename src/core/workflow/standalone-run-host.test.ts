import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { EventBus } from "#core/events/event-bus.js";
import { StandaloneRunHost } from "./standalone-run-host.js";

describe("StandaloneRunHost", () => {
  const cleanup: string[] = [];

  function createNestedRunHost(
    waitFor: "queued" | "completed",
    runChild: () => Promise<unknown> | unknown = () => ({ value: "child-output" }),
  ): StandaloneRunHost {
    const root = mkdtempSync(join(tmpdir(), "kota-standalone-nested-host-"));
    cleanup.push(root);
    const workspaceRoot = join(root, "project");
    mkdirSync(workspaceRoot);
    return new StandaloneRunHost({
      stateDir: join(root, "state"),
      scope: {
        scopeId: "standalone-nested-test",
        scopeRoot: workspaceRoot,
        displayName: "Standalone nested test",
      },
      concurrency: 1,
      workflows: [
        {
          name: "parent-run",
          enabled: true,
          moduleRoot: workspaceRoot,
          definitionPath: "standalone-parent-test",
          repository: "none",
          tags: [],
          triggers: [{ event: "manual", cooldownMs: 0 }],
          steps: [{
            id: "start-child",
            type: "trigger",
            workflow: "child-run",
            waitFor,
            payload: { source: "parent" },
          }],
        },
        {
          name: "child-run",
          enabled: true,
          moduleRoot: workspaceRoot,
          definitionPath: "standalone-child-test",
          repository: "none",
          tags: [],
          triggers: [{ event: "manual", cooldownMs: 0 }],
          steps: [{
            id: "complete-child",
            type: "code",
            run: runChild,
          }],
        },
      ],
    });
  }

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      rmSync(path, { force: true, recursive: true });
    }
  });

  it("admits an explicit workflow and returns its durable terminal result", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-standalone-host-"));
    cleanup.push(root);
    const workspaceRoot = join(root, "project");
    const stateDir = join(root, "state");
    mkdirSync(workspaceRoot);
    const host = new StandaloneRunHost({
      stateDir,
      scope: {
        scopeId: "standalone-test",
        scopeRoot: workspaceRoot,
        displayName: "Standalone test",
      },
      bus: new EventBus(),
      workflows: [{
        name: "explicit-run",
        enabled: true,
        moduleRoot: workspaceRoot,
        definitionPath: "standalone-test",
        repository: "none",
        tags: [],
        triggers: [{ event: "manual", cooldownMs: 0 }],
        steps: [{
          id: "complete",
          type: "code",
          run: () => ({ ok: true }),
        }],
      }],
    });

    try {
      const result = await host.runToTerminal("explicit-run", {
        runId: "explicit-run-test",
        payload: { requested: true },
      });

      expect(result.run.state).toBe("succeeded");
      expect(result.metadata?.status).toBe("success");
      expect(host.listRuns().map((run) => run.id)).toEqual(["explicit-run-test"]);
    } finally {
      await host.close();
    }
  });

  it("owns provider state independently across concurrent hosts", async () => {
    const first = createNestedRunHost("queued");
    const second = createNestedRunHost("queued");

    expect(first.providerRegistry).not.toBe(second.providerRegistry);
    expect(first.bus).not.toBe(second.bus);
    second.bus.on("host.fixture", () => undefined);
    expect(
      first.providerRegistry.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE),
    ).not.toBeNull();
    expect(
      second.providerRegistry.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE),
    ).not.toBeNull();

    await first.close();
    expect(first.providerRegistry.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE)).toBeNull();
    expect(first.bus.listenerCount()).toBe(0);
    expect(second.bus.listenerCount("host.fixture")).toBe(1);
    expect(
      second.providerRegistry.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE),
    ).not.toBeNull();
    await second.close();
  });

  it("drains a queued child after its parent releases the only coordinator slot", async () => {
    const host = createNestedRunHost("queued");

    try {
      const parent = await host.runToTerminal("parent-run", {
        runId: "queued-parent-test",
      });
      const [nested] = host.listNestedRuns();
      if (!nested) throw new Error("Expected the parent to enqueue a child run");
      const child = await host.waitForTerminal(
        nested.runId,
        AbortSignal.timeout(1_000),
      );

      expect(parent.run.state).toBe("succeeded");
      expect(parent.metadata?.steps[0]?.output).toEqual({
        runId: nested.runId,
        status: "queued",
      });
      expect(child.run.state).toBe("succeeded");
      expect(nested).toMatchObject({
        workflow: "child-run",
        waitFor: "queued",
        payload: { source: "parent" },
        status: "queued",
      });
    } finally {
      await host.close();
    }
  });

  it("completes a child while its parent waits without consuming the only coordinator slot", async () => {
    const host = createNestedRunHost("completed");

    try {
      const parent = await host.runToTerminal(
        "parent-run",
        { runId: "completed-parent-test" },
        AbortSignal.timeout(1_000),
      );
      const [nested] = host.listNestedRuns();
      if (!nested) throw new Error("Expected the parent to enqueue a child run");
      const child = host.listRuns().find((run) => run.id === nested.runId);

      expect(parent.run.state).toBe("succeeded");
      expect(parent.metadata?.steps[0]?.output).toEqual({
        runId: nested.runId,
        status: "completed",
        childOutput: { value: "child-output" },
      });
      expect(child?.state).toBe("succeeded");
      expect(nested).toMatchObject({
        workflow: "child-run",
        waitFor: "completed",
        payload: { source: "parent" },
        status: "completed",
      });
    } finally {
      await host.close();
    }
  });

  it("preserves a completed child failure as a durable failed run and trigger result", async () => {
    const host = createNestedRunHost("completed", () => {
      throw new Error("child failed");
    });

    try {
      const parent = await host.runToTerminal("parent-run", {
        runId: "failed-child-parent-test",
      });
      const [nested] = host.listNestedRuns();
      if (!nested) throw new Error("Expected the parent to enqueue a child run");
      const child = host.listRuns().find((run) => run.id === nested.runId);

      expect(parent.run.state).toBe("succeeded");
      expect(parent.metadata?.steps[0]?.output).toEqual({
        runId: nested.runId,
        status: "failed",
      });
      expect(child?.state).toBe("failed");
      expect(child?.lastError).toBe("child failed");
      expect(nested.status).toBe("failed");
    } finally {
      await host.close();
    }
  });

  it("durably cancels both parent and child when a completed child wait is cancelled", async () => {
    let childStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      childStarted = resolve;
    });
    let releaseChild!: () => void;
    const childCanFinish = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    const host = createNestedRunHost("completed", async () => {
      childStarted();
      await childCanFinish;
      return { value: "too-late" };
    });

    try {
      const parentPromise = host.runToTerminal("parent-run", {
        runId: "cancelled-parent-test",
      });
      await started;

      expect(host.coordinator.cancel("cancelled-parent-test")).toEqual({ cancelled: true });
      releaseChild();

      const parent = await parentPromise;
      const [nested] = host.listNestedRuns();
      if (!nested) throw new Error("Expected the parent to enqueue a child run");
      const child = host.listRuns().find((run) => run.id === nested.runId);

      expect(parent.run.state).toBe("cancelled");
      expect(child?.state).toBe("cancelled");
      expect(nested.status).toBe("failed");
    } finally {
      releaseChild();
      await host.close();
    }
  });
});
