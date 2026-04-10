import type { DaemonLiveStatus } from "../core/daemon/daemon-control.js";
import { DaemonControlClient } from "./daemon-client.js";

export async function queryDaemonStatus(stateDir?: string): Promise<DaemonLiveStatus | null> {
  const client = DaemonControlClient.fromStateDir(stateDir);
  if (!client) return null;
  return client.getDaemonStatus();
}
