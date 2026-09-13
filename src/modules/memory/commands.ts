import type { MemoryClient } from "./client.js";
import { renderMemorySearchPlain } from "./render.js";

// Chat adapters supply the selected scope's client and parsed command body.
// Transport errors propagate to the channel's existing error handling.
export async function memoryCommandReply(
  client: Pick<MemoryClient, "search">,
  body: string,
): Promise<string> {
  const query = body.trim();
  if (!query) return "Usage: /memory <query>";
  const result = await client.search(query, { semantic: true, limit: 10 });
  if (!result.ok) return "Semantic memory search requires an embedding-backed memory provider.";
  return result.entries.length === 0
    ? "No matching memory entries."
    : renderMemorySearchPlain(result.entries);
}
