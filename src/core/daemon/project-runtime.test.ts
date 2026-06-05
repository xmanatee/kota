import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import {
  getModuleLogStore,
  resetModuleLogStore,
} from "#core/modules/module-log.js";
import { getApprovalQueue, resetApprovalQueue } from "./approval-queue.js";
import {
  getIdempotencyStore,
  resetIdempotencyStore,
} from "./idempotency-singleton.js";
import {
  getOwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "./owner-question-queue.js";
import {
  createProjectRuntime,
  ProjectRuntimeRegistry,
} from "./project-runtime.js";
import { getScheduler, resetScheduler } from "./scheduler.js";
import {
  buildConfiguredProject,
  ScopeRegistry,
} from "./scope-registry.js";
import { getTaskStore, resetTaskStore } from "./task-store.js";

function makeProjectDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `kota-project-runtime-${name}-`));
  mkdirSync(join(root, ".kota"), { recursive: true });
  return root;
}

function resetSingletons(): void {
  resetTaskStore();
  resetScheduler();
  resetModuleLogStore();
  resetApprovalQueue();
  resetIdempotencyStore();
  resetOwnerQuestionQueue();
}

describe("createProjectRuntime", () => {
  beforeEach(resetSingletons);
  afterEach(resetSingletons);

  it("constructs the full per-project bundle with project-scoped paths", async () => {
    const projectDir = makeProjectDir("solo");
    const project = buildConfiguredProject({ projectDir });
    const bus = new EventBus();

    const bundle = createProjectRuntime({
      project,
      bus,
      onLog: () => {},
      installSingletons: false,
    });

    expect(bundle.project.projectId).toBe(project.projectId);
    expect(bundle.runStore.rootDir).toBe(join(projectDir, ".kota"));
    expect(bundle.runStore.runsDir).toBe(join(projectDir, ".kota", "runs"));
    expect(bundle.pushTokenStorePath).toBe(
      join(projectDir, ".kota", "push-tokens.json"),
    );

    bundle.taskStore.add("first task");
    expect(bundle.taskStore.list()).toHaveLength(1);

    bundle.scheduler.add("ping", new Date(Date.now() + 60_000));
    expect(bundle.scheduler.pending()).toHaveLength(1);
    bundle.scheduler.stopTimer();
    bundle.scheduler.disconnectBus();

    bundle.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "test");
    expect(bundle.approvalQueue.list("pending")).toHaveLength(1);

    bundle.idempotencyStore.record({
      scopeId: project.projectId,
      operation: "workflow-dispatch",
      key: "manual:test",
      parameterFingerprint: "fp",
      result: { runId: "run-1" },
    });
    expect(bundle.idempotencyStore.list()).toHaveLength(1);

    bundle.ownerQuestionQueue.enqueue({
      context: "ctx",
      question: "q?",
      reason: "reason",
      source: "src",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "src" },
    });
    expect(bundle.ownerQuestionQueue.list("pending")).toHaveLength(1);

    bundle.moduleLogStore.append("test-module", "info", "hello");
    expect(bundle.moduleLogStore.tail("test-module")).toHaveLength(1);

    expect(bundle.notificationGate).toBeNull();

    await bundle.workflowRuntime.stop();
  });

  it("only the default-project bundle installs the legacy singletons", async () => {
    const projectA = buildConfiguredProject({ projectDir: makeProjectDir("a") });
    const projectB = buildConfiguredProject({ projectDir: makeProjectDir("b") });
    const bus = new EventBus();

    const bundleA = createProjectRuntime({
      project: projectA,
      bus,
      onLog: () => {},
      installSingletons: true,
    });
    const bundleB = createProjectRuntime({
      project: projectB,
      bus,
      onLog: () => {},
      installSingletons: false,
    });

    expect(getTaskStore()).toBe(bundleA.taskStore);
    expect(getScheduler()).toBe(bundleA.scheduler);
    expect(getModuleLogStore()).toBe(bundleA.moduleLogStore);
    expect(getApprovalQueue()).toBe(bundleA.approvalQueue);
    expect(getIdempotencyStore()).toBe(bundleA.idempotencyStore);
    expect(getOwnerQuestionQueue()).toBe(bundleA.ownerQuestionQueue);

    expect(bundleB.taskStore).not.toBe(bundleA.taskStore);
    expect(bundleB.scheduler).not.toBe(bundleA.scheduler);

    bundleA.scheduler.stopTimer();
    bundleA.scheduler.disconnectBus();
    bundleB.scheduler.stopTimer();
    bundleB.scheduler.disconnectBus();
    await bundleA.workflowRuntime.stop();
    await bundleB.workflowRuntime.stop();
  });
});

describe("ProjectRuntimeRegistry — independence across projects", () => {
  beforeEach(resetSingletons);
  afterEach(resetSingletons);

  it("two configured projects produce independent file paths and in-memory state", async () => {
    const dirA = makeProjectDir("twin-a");
    const dirB = makeProjectDir("twin-b");
    const stateDir = mkdtempSync(join(tmpdir(), "kota-project-runtime-state-"));

    const registry = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir: dirA }, { projectDir: dirB }],
    });
    const bus = new EventBus();

    const runtimes = ProjectRuntimeRegistry.create({
      registry,
      bus,
      onLog: () => {},
    });

    const a = runtimes.get(registry.list()[0]!.projectId);
    const b = runtimes.get(registry.list()[1]!.projectId);

    expect(a.project.projectDir).toBe(resolve(dirA));
    expect(b.project.projectDir).toBe(resolve(dirB));
    expect(a.runStore).not.toBe(b.runStore);
    expect(a.taskStore).not.toBe(b.taskStore);
    expect(a.scheduler).not.toBe(b.scheduler);
    expect(a.approvalQueue).not.toBe(b.approvalQueue);
    expect(a.idempotencyStore).not.toBe(b.idempotencyStore);
    expect(a.ownerQuestionQueue).not.toBe(b.ownerQuestionQueue);
    expect(a.moduleLogStore).not.toBe(b.moduleLogStore);
    expect(a.workflowRuntime).not.toBe(b.workflowRuntime);

    a.taskStore.add("alpha");
    b.taskStore.add("beta one");
    b.taskStore.add("beta two");
    expect(a.taskStore.list().map((t) => t.task)).toEqual(["alpha"]);
    expect(b.taskStore.list().map((t) => t.task)).toEqual([
      "beta one",
      "beta two",
    ]);

    a.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "a");
    b.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "b1");
    b.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "b2");
    expect(a.approvalQueue.count("pending")).toBe(1);
    expect(b.approvalQueue.count("pending")).toBe(2);

    expect(existsSync(join(dirA, ".kota", "approvals"))).toBe(true);
    expect(existsSync(join(dirB, ".kota", "approvals"))).toBe(true);
    expect(readdirSync(join(dirA, ".kota", "approvals")).length).toBe(1);
    expect(readdirSync(join(dirB, ".kota", "approvals")).length).toBe(2);

    a.idempotencyStore.record({
      scopeId: a.project.projectId,
      operation: "event-ingestion",
      key: "signal:shared",
      parameterFingerprint: "a",
      result: { accepted: true },
    });
    b.idempotencyStore.record({
      scopeId: b.project.projectId,
      operation: "event-ingestion",
      key: "signal:shared",
      parameterFingerprint: "b",
      result: { accepted: true },
    });
    expect(a.idempotencyStore.list()).toHaveLength(1);
    expect(b.idempotencyStore.list()).toHaveLength(1);
    expect(existsSync(join(dirA, ".kota", "idempotency"))).toBe(true);
    expect(existsSync(join(dirB, ".kota", "idempotency"))).toBe(true);

    a.moduleLogStore.append("mod", "info", "alpha-log");
    b.moduleLogStore.append("mod", "info", "beta-log");
    const aLog = readFileSync(
      join(dirA, ".kota", "modules", "mod", "logs.jsonl"),
      "utf-8",
    );
    const bLog = readFileSync(
      join(dirB, ".kota", "modules", "mod", "logs.jsonl"),
      "utf-8",
    );
    expect(aLog).toContain("alpha-log");
    expect(aLog).not.toContain("beta-log");
    expect(bLog).toContain("beta-log");
    expect(bLog).not.toContain("alpha-log");

    expect(statSync(a.pushTokenStorePath.replace(/push-tokens\.json$/, ""))
      .isDirectory()).toBe(true);
    expect(a.pushTokenStorePath).not.toBe(b.pushTokenStorePath);

    a.scheduler.stopTimer();
    a.scheduler.disconnectBus();
    b.scheduler.stopTimer();
    b.scheduler.disconnectBus();
    await a.workflowRuntime.stop();
    await b.workflowRuntime.stop();
  });

  it("getProjectRuntime throws on an unknown projectId", () => {
    const dir = makeProjectDir("solo-lookup");
    const stateDir = mkdtempSync(join(tmpdir(), "kota-project-runtime-state-"));
    const registry = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir: dir }],
    });
    const bus = new EventBus();
    const runtimes = ProjectRuntimeRegistry.create({
      registry,
      bus,
      onLog: () => {},
    });
    expect(() => runtimes.get("not-a-real-id")).toThrow(/no runtime/i);
    runtimes.getDefault().scheduler.stopTimer();
    runtimes.getDefault().scheduler.disconnectBus();
    return runtimes.getDefault().workflowRuntime.stop();
  });
});

/**
 * Singleton-binding invariant.
 *
 * Scans every production `.ts` file under `src/core/daemon/` (plus the
 * workflow runtime entrypoint that owns the default `WorkflowRunStore`
 * binding) and rejects any direct construction of a per-project store
 * outside the bundle factory. The factory is the single declared place
 * where these subsystems may be bound to a `projectDir`.
 *
 * This catches the regression that the slice 2 task is meant to prevent:
 * a new daemon-owned store landing somewhere with a bare `new
 * XStore(projectDir)` or `init*(projectDir)` call, silently leaking
 * state across projects when the daemon hosts more than one.
 */
describe("singleton-binding invariant", () => {
  it("rejects new singleton bindings outside the bundle factory", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");

    const repoSrc = path.resolve(__dirname, "..", "..");
    const daemonDir = path.join(repoSrc, "core", "daemon");

    const FACTORY_FILE = path.join(daemonDir, "project-runtime.ts");
    const FACTORY_TEST = path.join(daemonDir, "project-runtime.test.ts");

    const FORBIDDEN: { pattern: RegExp; label: string; allowedFiles: string[] }[] = [
      {
        pattern: /\bnew\s+WorkflowRunStore\s*\(/,
        label: "new WorkflowRunStore(",
        allowedFiles: [FACTORY_FILE],
      },
      {
        pattern: /\bnew\s+TaskStore\s*\(/,
        label: "new TaskStore(",
        allowedFiles: [FACTORY_FILE, path.join(daemonDir, "task-store.ts")],
      },
      {
        pattern: /\bnew\s+Scheduler\s*\(/,
        label: "new Scheduler(",
        allowedFiles: [FACTORY_FILE, path.join(daemonDir, "scheduler.ts")],
      },
      {
        pattern: /\bnew\s+ModuleLogStore\s*\(/,
        label: "new ModuleLogStore(",
        // ModuleLogStore lives outside the daemon dir; its own definition is
        // exempt by virtue of being outside the scanned tree.
        allowedFiles: [FACTORY_FILE],
      },
      {
        pattern: /\bnew\s+ApprovalQueue\s*\(/,
        label: "new ApprovalQueue(",
        allowedFiles: [FACTORY_FILE, path.join(daemonDir, "approval-queue.ts")],
      },
      {
        pattern: /\bnew\s+IdempotencyStore\s*\(/,
        label: "new IdempotencyStore(",
        allowedFiles: [
          FACTORY_FILE,
          path.join(daemonDir, "idempotency-store.ts"),
          path.join(daemonDir, "idempotency-singleton.ts"),
        ],
      },
      {
        pattern: /\bnew\s+OwnerQuestionQueue\s*\(/,
        label: "new OwnerQuestionQueue(",
        allowedFiles: [
          FACTORY_FILE,
          path.join(daemonDir, "owner-question-queue.ts"),
        ],
      },
      {
        pattern: /\bnew\s+NotificationGate\s*\(/,
        label: "new NotificationGate(",
        allowedFiles: [
          FACTORY_FILE,
          path.join(daemonDir, "notification-gate.ts"),
        ],
      },
      {
        pattern: /\binitTaskStore\s*\(/,
        label: "initTaskStore(",
        allowedFiles: [FACTORY_FILE, path.join(daemonDir, "task-store.ts")],
      },
      {
        pattern: /\binitScheduler\s*\(/,
        label: "initScheduler(",
        allowedFiles: [FACTORY_FILE, path.join(daemonDir, "scheduler.ts")],
      },
      {
        pattern: /\binitModuleLogStore\s*\(/,
        label: "initModuleLogStore(",
        allowedFiles: [FACTORY_FILE],
      },
    ];

    function* walk(dir: string): Iterable<string> {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          yield* walk(full);
        } else {
          yield full;
        }
      }
    }

    const violations: string[] = [];

    for (const file of walk(daemonDir)) {
      if (!file.endsWith(".ts")) continue;
      // Test files (including this one) and fixture trees are exempt.
      if (file.endsWith(".test.ts")) continue;
      if (file.endsWith(".integration.test.ts")) continue;
      if (file === FACTORY_TEST) continue;

      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (const { pattern, label, allowedFiles } of FORBIDDEN) {
        if (allowedFiles.includes(file)) continue;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Skip lines inside import/declaration headers — only flag actual
          // call/construction sites.
          if (/^\s*import\b/.test(line)) continue;
          if (/^\s*export\b/.test(line)) continue;
          if (pattern.test(line)) {
            violations.push(
              `${path.relative(repoSrc, file)}:${i + 1}: ${label}  → ${line.trim()}`,
            );
          }
        }
      }
    }

    expect(
      violations,
      [
        "Per-project store bindings escaped the ProjectRuntime bundle factory.",
        "Add new daemon-owned per-project stores via createProjectRuntime in",
        "src/core/daemon/project-runtime.ts. Offending sites:",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });
});
