import type { RetractClient, RetractTarget } from "./client.js";
import { renderRetractResultPlain, retractUsageBody } from "./render.js";

// Channels supply the selected scope client and parsed identifier. The store
// interprets the identifier; transport errors remain with channel error handling.
export async function retractCommandReply(
  retract: RetractClient,
  target: RetractTarget,
  identifier: string,
): Promise<string> {
  if (!identifier.trim()) return retractUsageBody(`/retract-${target}`);
  return renderRetractResultPlain(await retract.retract({ target, identifier }));
}
