import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetScheduler, Scheduler, setSchedulerInstance } from "#core/daemon/scheduler.js";
import { resetTaskStore, setTaskStoreInstance, TaskStore } from "#core/daemon/task-store.js";
import {
  HISTORY_PROVIDER_TOKEN, initProviderRegistry, KNOWLEDGE_PROVIDER_TOKEN,
  MEMORY_PROVIDER_TOKEN, resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { ConversationHistory } from "#modules/history/history.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import { buildSessionWarmup } from "./init.js";

// Composition failure: persisted provider records or core task/schedule state fail
// to reach session context, or one unavailable store suppresses healthy sections.
let dir: string;
let memory: MemoryStore;
let history: ConversationHistory;
let knowledge: KnowledgeStore;
let tasks: TaskStore;
let scheduler: Scheduler;
const now = new Date(2026, 8, 10, 12);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "warmup-stores-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  memory = new MemoryStore(dir);
  history = new ConversationHistory(join(dir, "history"));
  knowledge = new KnowledgeStore(dir, join(dir, "global-knowledge"));
  const registry = initProviderRegistry();
  registry.register(MEMORY_PROVIDER_TOKEN, "memory", memory);
  registry.register(HISTORY_PROVIDER_TOKEN, "history", history);
  registry.register(KNOWLEDGE_PROVIDER_TOKEN, "knowledge", knowledge);
  tasks = new TaskStore(dir, null);
  setTaskStoreInstance(tasks);
  scheduler = new Scheduler(dir, null);
  setSchedulerInstance(scheduler);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetProviderRegistry();
  resetTaskStore();
  resetScheduler();
  rmSync(dir, { recursive: true, force: true });
});

function populateStores(): void {
  memory.save(`${basename(dir)} uses React`, ["framework"]);
  knowledge.create({ title: "Architecture decision", content: "Use providers", tags: ["design"] });
  for (const title of ["Research", "Write report"]) tasks.update(tasks.add(title).id, { status: "in_progress" });
  scheduler.add("Check email", new Date(now.getTime() - 60_000));
  const id = history.create("fixture-model", dir);
  history.save(id, [{ role: "user", content: "Investigate session context" }], 0, 0);
}

it("renders stored context and omits empty sources", () => {
  let result = buildSessionWarmup(dir);
  for (const heading of ["Recalled from memory", "Knowledge base", "Previous conversation", "Active tasks", "Scheduled reminders"]) {
    expect(result).not.toContain(`**${heading}`);
  }
  populateStores();
  result = buildSessionWarmup(dir);
  expect(result).toContain("uses React [framework]");
  expect(result).toContain("Architecture decision (note/active) [design]");
  expect(result).toContain('2 in progress: "Research", "Write report"');
  expect(result).toContain("**Scheduled reminders**:");
  expect(result).toContain("Check email");
  expect(result).toContain('"Investigate session context" (1 messages, just now). Resume with: kota run --continue');
});

it.each([
  [30_000, "just now"], [75_000, "1 minute ago"], [300_000, "5 minutes ago"],
  [3_600_000, "1 hour ago"], [86_400_000, "1 day ago"], [169 * 3_600_000, null],
])("renders a persisted conversation after %i milliseconds", (age, expected) => {
  vi.setSystemTime(new Date(now.getTime() - age));
  const id = history.create("fixture-model", dir);
  history.save(id, [{ role: "user", content: "Previous work" }], 0, 0);
  vi.setSystemTime(now);
  const output = buildSessionWarmup(dir);
  if (expected === null) expect(output).not.toContain("**Previous conversation**:");
  else expect(output).toContain(`1 messages, ${expected}`);
});

it("omits corrupt memory while preserving a healthy task summary", () => {
  writeFileSync(join(dir, "memory.json"), "invalid json");
  tasks.update(tasks.add("Keep working").id, { status: "in_progress" });
  const result = buildSessionWarmup(dir);
  expect(result).not.toContain("**Recalled from memory**:");
  expect(result).toContain("Keep working");
});

it.each(["memory", "tasks", "schedules", "history", "all"] as const)(
  "isolates %s read failure from mandatory context", (source) => {
    populateStores();
    const fail = () => { throw new Error("store unavailable"); };
    if (source === "memory" || source === "all") vi.spyOn(memory, "list").mockImplementation(fail);
    if (source === "tasks" || source === "all") vi.spyOn(tasks.collection, "getActiveSummary").mockImplementation(fail);
    if (source === "schedules" || source === "all") vi.spyOn(scheduler, "getPendingSummary").mockImplementation(fail);
    if (source === "history" || source === "all") vi.spyOn(history, "getMostRecent").mockImplementation(fail);
    const result = buildSessionWarmup(dir);
    expect(result).toContain(`**Working directory**: ${dir}`);
    expect(result).toContain("**System**:");
    for (const [owner, heading] of [["memory", "Recalled from memory"], ["tasks", "Active tasks"], ["schedules", "Scheduled reminders"], ["history", "Previous conversation"]]) {
      if (source === owner || source === "all") expect(result).not.toContain(`**${heading}`);
      else expect(result).toContain(`**${heading}`);
    }
    expect(result).toContain("Architecture decision");
  },
);
