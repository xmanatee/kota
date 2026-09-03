import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBackoffManager } from "../agent-backoff.js";
import { RunStateDatabase } from "../run-state-database.js";
import { ScopeRuntimeStateStore } from "../scope-runtime-state.js";

export interface AgentBackoffTestFixture {
  manager: AgentBackoffManager;
  state: ScopeRuntimeStateStore;
  dispose(): void;
}

export function createAgentBackoffTestFixture(): AgentBackoffTestFixture {
  const root = mkdtempSync(join(tmpdir(), "kota-agent-backoff-fixture-"));
  const database = new RunStateDatabase(join(root, "state"));
  database.registerScope({
    id: "test-scope",
    rootPath: root,
    createdAt: new Date().toISOString(),
  });
  const state = new ScopeRuntimeStateStore(database, "test-scope");
  const manager = new AgentBackoffManager(state, () => {}, "test:test-harness");

  return {
    manager,
    state,
    dispose: () => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
