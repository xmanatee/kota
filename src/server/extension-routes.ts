import type { ServerResponse } from "node:http";
import type { ExtensionSummary } from "../extension-types.js";
import { jsonResponse } from "./session-pool.js";

export type ExtensionStatusEntry = {
  name: string;
  version?: string;
  description?: string;
  status: "loaded";
  toolCount: number;
  agentCount: number;
  workflowCount: number;
  skillCount: number;
  channelCount: number;
};

export type ExtensionsResponse = {
  extensions: ExtensionStatusEntry[];
};

export function handleListExtensions(
  res: ServerResponse,
  summaries: ExtensionSummary[],
): void {
  const extensions: ExtensionStatusEntry[] = summaries.map((s) => ({
    name: s.name,
    version: s.version,
    description: s.description,
    status: "loaded",
    toolCount: s.toolNames.length,
    agentCount: s.agentNames.length,
    workflowCount: s.workflowNames.length,
    skillCount: s.skillNames.length,
    channelCount: s.channelNames.length,
  }));
  jsonResponse(res, 200, { extensions } satisfies ExtensionsResponse);
}
