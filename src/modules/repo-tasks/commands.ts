import type { RepoTasksClient } from "./client.js";
import { renderRepoTaskSearchPlain } from "./render.js";

// Chat adapters supply the selected scope's client and parsed command body.
// Transport errors propagate to the channel's existing error handling.
export async function tasksCommandReply(
  client: Pick<RepoTasksClient, "search">,
  body: string,
): Promise<string> {
  const query = body.trim();
  if (!query) return "Usage: /tasks <query>";
  const result = await client.search(query, { semantic: true, limit: 10 });
  if (!result.ok) return "Semantic task search requires an embedding-backed repo-tasks provider.";
  return result.tasks.length === 0
    ? "No matching tasks."
    : renderRepoTaskSearchPlain(result.tasks);
}
