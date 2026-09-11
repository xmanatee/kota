import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import { defaultWorkflowRunRetentionDays, readPrunedWorkflowRunReferences } from "./run-store-retention.js";
import type { WorkflowDefinition } from "./types.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const workflow: WorkflowDefinition = {
  name: "builder", enabled: true, repository: "read", tags: [],
  definitionPath: "workflows/builder.ts", moduleRoot: "/module", triggers: [], steps: [],
};
const trigger = { event: "manual", schemaRef: null, payload: {} };
const pruning = { retentionDays: 7, minKeepPerWorkflow: 0 };
let root: string;
let store: WorkflowRunStore;
const databases: RunStateDatabase[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  root = mkdtempSync(join(tmpdir(), "kota-retention-"));
  store = new WorkflowRunStore(root);
});
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function create(id: string, age = 30, name = "builder", active = false) {
  vi.setSystemTime(NOW - age * DAY);
  const handle = store.createRun({ ...workflow, name }, trigger, id);
  if (!active) handle.finish({ status: "success", durationMs: 0 });
  vi.setSystemTime(NOW);
  return handle;
}
function corrupt(id: string, value: object | string) {
  writeFileSync(join(store.runsDir, id, "metadata.json"),
    typeof value === "string" ? value : JSON.stringify(value));
}
function startDurableRun(id: string) {
  const stateDir = join(root, "operator-state");
  const database = new RunStateDatabase(stateDir);
  databases.push(database);
  const at = new Date(NOW).toISOString();
  database.registerScope({ id: "scope-a", rootPath: root, createdAt: at });
  const { epoch } = database.beginDaemonSession(at);
  database.admitRun({ id, scopeId: "scope-a", workflow: "builder", repository: "write",
    trigger, resources: [], admittedAt: at });
  database.startRun(id, epoch, at);
  return { database, epoch, at, reader: new WorkflowRunStore(root, { stateDir }) };
}

describe("run evidence retention", () => {
  it("ignores unowned directories and queued runs without pre-execution evidence", () => {
    mkdirSync(join(store.runsDir, "report"));
    expect(store.listRuns()).toEqual([]);
    expect(store.pruneRuns({ protectedRunIds: new Set(["queued"]) })).toEqual([]);
    expect(existsSync(join(store.runsDir, "report"))).toBe(true);
  });

  it.each(["builder", "constructor", "__proto__", "toString"])(
    "applies age and minimum retention independently to workflow %s", (name) => {
      create("recent", 1, name);
      create("keep", 10, name);
      create("expired", 11, name);
      create("other-keep", 20, "other");
      create("other-keep-2", 21, "other");
      create("other-expired", 22, "other");
      const options = { ...pruning, minKeepPerWorkflow: 2 };
      const candidates = store.pruneRuns({ ...options, dryRun: true }).sort();
      expect(candidates).toEqual(["expired", "other-expired"]);
      expect(store.listRuns()).toHaveLength(6);
      expect(readPrunedWorkflowRunReferences(store.runsDir)).toEqual([]);
      expect(store.pruneRuns(options).sort()).toEqual(candidates);
      expect(store.listRuns().map((run) => run.id).sort()).toEqual([
        "keep", "other-keep", "other-keep-2", "recent",
      ]);
      for (const id of candidates) expect(existsSync(join(store.runsDir, id))).toBe(false);
      expect(readPrunedWorkflowRunReferences(store.runsDir)).toEqual(
        expect.arrayContaining(candidates.map((id) => expect.objectContaining({
          artifactType: "workflow-run", id, payloadExpired: true,
          retained: expect.objectContaining({ id, status: "success" }),
          provenance: expect.objectContaining({ runId: id }),
        }))),
      );
      expect(store.pruneRuns(options)).toEqual([]);
      expect(readPrunedWorkflowRunReferences(store.runsDir)).toHaveLength(2);
    },
  );

  it("uses the evidence policy by default and measures retention from completion", () => {
    const days = defaultWorkflowRunRetentionDays();
    create("recent", days - 1);
    create("expired", days + 1);
    const longRun = create("long-run", days + 10, "builder", true);
    longRun.finish({ status: "success", durationMs: (days + 10) * DAY });
    expect(store.pruneRuns({ minKeepPerWorkflow: 0 })).toEqual(["expired"]);
    expect(store.listRuns().map((run) => run.id).sort()).toEqual(["long-run", "recent"]);
  });

  it("preserves active and explicitly protected evidence alongside eligible history", () => {
    create("active", 30, "builder", true);
    create("protected");
    create("expired");
    expect(store.pruneRuns({ ...pruning, protectedRunIds: new Set(["protected"]) }))
      .toEqual(["expired"]);
    expect(store.listRuns().map((run) => run.id).sort()).toEqual(["active", "protected"]);
  });

  it("keeps Git-tracked evidence while deleting untracked expired history", () => {
    create("tracked");
    create("untracked");
    const evidence = join(store.runsDir, "tracked", "evidence.txt");
    writeFileSync(evidence, "durable evidence\n");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", ".kota/runs/tracked/evidence.txt"], { cwd: root });
    expect(store.pruneRuns(pruning)).toEqual(["untracked"]);
    expect(readFileSync(evidence, "utf8")).toBe("durable evidence\n");
    expect(existsSync(join(store.runsDir, "untracked"))).toBe(false);
  });

  it("quarantines terminal malformed timestamps without hiding valid retention candidates", () => {
    create("invalid");
    corrupt("invalid", { ...store.getRun("invalid"), startedAt: "not-a-date" });
    create("expired");
    expect(store.pruneRuns(pruning)).toEqual(["expired"]);
    expect(existsSync(join(store.runsDir, "invalid"))).toBe(true);
    expect(() => store.getRun("invalid")).toThrow();
  });
});

describe("run store durable authority", () => {
  it("fails list, lookup and pruning when authority-critical evidence is absent", () => {
    const reader = new WorkflowRunStore(root, { authorityCriticalRunIds: () => new Set(["missing"]) });
    for (const read of [() => reader.listRuns(), () => reader.getRun("missing"), () => reader.pruneRuns(pruning)]) {
      expect(read).toThrow("metadata file is missing for an authority-critical workflow run");
    }
  });

  it.each(["running", "waiting", "integrating", "needs_attention"] as const)(
    "keeps finalized execution evidence while durable state is %s", (state) => {
      create("run");
      const { database, epoch, at, reader } = startDurableRun("run");
      if (state === "integrating") database.beginIntegration("run", epoch, { phase: "publication" });
      if (state === "waiting" || state === "needs_attention") {
        database.suspendRun({ runId: "run", epoch, state: "waiting", suspendedAt: at,
          wait: { reason: "agent-backoff" } });
        if (state === "needs_attention") database.requireRunAttention("run", "review", []);
      }
      expect(reader.listRuns()).toEqual([expect.objectContaining({ id: "run", status: "success" })]);
      expect(reader.getRun("run")?.status).toBe("success");
      expect(reader.pruneRuns(pruning)).toEqual([]);
      expect(existsSync(join(reader.runsDir, "run"))).toBe(true);
    },
  );

  it("reads external durable authority and rejects terminal-looking malformed evidence", () => {
    create("run");
    const { database, epoch, reader } = startDurableRun("run");
    database.beginIntegration("run", epoch, { phase: "publication" });
    corrupt("run", { ...store.getRun("run"), definitionPath: 17 });
    for (const read of [() => reader.listRuns(), () => reader.getRun("run"), () => reader.pruneRuns(pruning)]) {
      expect(read).toThrow("Workflow run metadata authority is invalid");
    }
    expect(existsSync(join(reader.runsDir, "run"))).toBe(true);
  });

  it("protects terminal evidence until its publication is delivered", () => {
    create("run");
    const { database, epoch, at, reader } = startDurableRun("run");
    database.finishRun("run", epoch, "succeeded", at, undefined, {
      id: "publication", runId: "run", scopeId: "scope-a", event: "workflow.completed", payload: { runId: "run" },
    });
    expect(reader.pruneRuns(pruning)).toEqual([]);
    expect(existsSync(join(reader.runsDir, "run"))).toBe(true);
    expect(database.markPublicationDelivered("publication", at)).toBe(true);
    expect(reader.pruneRuns(pruning)).toEqual(["run"]);
    expect(existsSync(join(reader.runsDir, "run"))).toBe(false);
  });

  it("uses terminal database authority to quarantine invalid JSON during pruning", () => {
    create("invalid");
    const { database, epoch, at, reader } = startDurableRun("invalid");
    database.finishRun("invalid", epoch, "succeeded", at);
    corrupt("invalid", "{invalid");
    create("expired");
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    expect(reader.pruneRuns(pruning)).toEqual(["expired"]);
    expect(readFileSync(join(reader.runsDir, "invalid", "metadata.json"), "utf8")).toBe("{invalid");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Quarantined workflow run metadata"),
      { code: "KOTA_WORKFLOW_RUN_METADATA_QUARANTINED" });
  });
});
