import type { RecallClient } from "./client.js";
import { renderRecallHitsPlain } from "./render.js";

// Chat adapters supply the selected scope's client and parsed command body.
// Transport errors propagate to the channel's existing error handling.
export async function recallCommandReply(
  client: Pick<RecallClient, "recall">,
  body: string,
): Promise<string> {
  const query = body.trim();
  if (!query) return "Usage: /recall <query>";
  const result = await client.recall(query);
  if (!result.ok) return "Cross-store recall is not configured: no contributors are registered.";
  return result.hits.length === 0
    ? "No matching items."
    : renderRecallHitsPlain(result.hits);
}
