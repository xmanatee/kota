import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBackoffManager } from "../agent-backoff.js";
import { RunStateDatabase } from "../run-state-database.js";
import { DaemonAgentBackoffStateStore } from "../scope-runtime-state.js";

export interface AgentBackoffTestFixture {
  manager: AgentBackoffManager;
  state: DaemonAgentBackoffStateStore;
  dispose(): void;
}

export function createAgentBackoffTestFixture(): AgentBackoffTestFixture {
  const root = mkdtempSync(join(tmpdir(), "kota-agent-backoff-fixture-"));
  const database = new RunStateDatabase(join(root, "state"));
  const state = new DaemonAgentBackoffStateStore(database);
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
