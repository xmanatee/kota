import type { HistoryClient } from "./client.js";
import { renderHistorySearchPlain } from "./render.js";

// Chat adapters supply the selected scope's client and parsed command body.
// Transport errors propagate to the channel's existing error handling.
export async function historyCommandReply(
  client: Pick<HistoryClient, "search">,
  body: string,
): Promise<string> {
  const query = body.trim();
  if (!query) return "Usage: /history <query>";
  const result = await client.search(query, { semantic: true, limit: 10 });
  if (!result.ok) return "Semantic conversation search requires an embedding-backed history provider.";
  return result.conversations.length === 0
    ? "No matching conversations."
    : renderHistorySearchPlain(result.conversations);
}
