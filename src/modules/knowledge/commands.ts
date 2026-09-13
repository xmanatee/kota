import type { KnowledgeClient } from "./client.js";
import { renderKnowledgeSearchPlain } from "./render.js";

// Chat adapters supply the selected scope's client and parsed command body.
// Transport errors propagate to the channel's existing error handling.
export async function knowledgeCommandReply(
  client: Pick<KnowledgeClient, "search">,
  body: string,
): Promise<string> {
  const query = body.trim();
  if (!query) return "Usage: /knowledge <query>";
  const result = await client.search(query, { semantic: true, limit: 10 });
  if (!result.ok) return "Semantic knowledge search requires an embedding-backed knowledge provider.";
  return result.entries.length === 0
    ? "No matching knowledge entries."
    : renderKnowledgeSearchPlain(result.entries);
}
