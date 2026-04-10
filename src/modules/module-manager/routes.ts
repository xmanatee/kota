import type { ServerResponse } from "node:http";
import type { ModuleHealth, ModuleSummary } from "../../module-types.js";
import { jsonResponse } from "../../server/session-pool.js";

export type ModuleStatusEntry = {
  name: string;
  version?: string;
  description?: string;
  status: "loaded" | "failed";
  toolCount: number;
  agentCount: number;
  workflowCount: number;
  skillCount: number;
  channelCount: number;
  health?: ModuleHealth;
  /** Error message when status is "failed"; truncated to 500 chars. */
  error?: string;
};

export type ModulesResponse = {
  modules: ModuleStatusEntry[];
};

export function handleListModules(
  res: ServerResponse,
  summaries: ModuleSummary[],
): void {
  const modules: ModuleStatusEntry[] = summaries.map((s) => {
    if (s.loadError !== undefined) {
      return {
        name: s.name,
        version: s.version,
        description: s.description,
        status: "failed",
        toolCount: 0,
        agentCount: 0,
        workflowCount: 0,
        skillCount: 0,
        channelCount: 0,
        error: s.loadError,
      };
    }
    return {
      name: s.name,
      version: s.version,
      description: s.description,
      status: "loaded",
      toolCount: s.toolNames.length,
      agentCount: s.agentNames.length,
      workflowCount: s.workflowNames.length,
      skillCount: s.skillNames.length,
      channelCount: s.channelNames.length,
      health: s.health,
    };
  });
  jsonResponse(res, 200, { modules } satisfies ModulesResponse);
}
