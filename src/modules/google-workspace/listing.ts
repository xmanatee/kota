import type { z } from "zod";
import type { OutboundHttpRequestPort } from "#core/outbound-http/index.js";
import { googleFetch } from "./auth.js";

export const MAX_LIST_PAGES = 10;

export type ListingState =
  | { kind: "complete" }
  | { kind: "partial" | "unavailable"; reason: string };

type ListingPage<T> = {
  items: T[];
  nextPageToken?: string;
  limitation?: string;
};

/** Service schemas normalize pages; this owner alone decides traversal and termination. */
export async function listGooglePages<T>(options: {
  getToken: () => Promise<string>;
  http: OutboundHttpRequestPort;
  maxResults: number;
  pageSchema: z.ZodType<ListingPage<T>>;
  url: (remaining: number, pageToken: string | undefined) => string;
}): Promise<{ items: T[]; state: ListingState }> {
  const items: T[] = [];
  const limitations = new Set<string>();
  const finish = (state: ListingState): { items: T[]; state: ListingState } => {
    if (state.kind !== "complete") limitations.add(state.reason);
    return {
      items,
      state: limitations.size === 0 ? state : {
        kind: state.kind === "unavailable" ? "unavailable" : "partial",
        reason: [...limitations].join(" "),
      },
    };
  };
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  try {
    const token = await options.getToken();
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const remaining = options.maxResults - items.length;
      const response = await googleFetch(token, "GET", options.url(remaining, pageToken), undefined, options.http);
      if (!response.ok) {
        return finish({ kind: "unavailable", reason: `Google API error (${response.status}) while listing results.` });
      }
      const parsed = options.pageSchema.safeParse(response.data);
      if (!parsed.success) {
        return finish({ kind: "unavailable", reason: "Google returned an invalid list page." });
      }
      const pageItems = parsed.data.items;
      items.push(...pageItems.slice(0, remaining));
      if (parsed.data.limitation) limitations.add(parsed.data.limitation);
      const next = parsed.data.nextPageToken;
      if (pageItems.length > remaining || (items.length === options.maxResults && next)) {
        return finish({ kind: "partial", reason: `The ${options.maxResults}-result limit was reached. Increase maxResults within the tool's limit or narrow the query/window.` });
      }
      if (!next) return finish({ kind: "complete" });
      if (seenTokens.has(next)) {
        return finish({ kind: "unavailable", reason: "Google repeated a continuation token; retrieval could not complete." });
      }
      seenTokens.add(next);
      pageToken = next;
    }
  } catch {
    // Provider errors may contain credentials or request details.
    return finish({ kind: "unavailable", reason: "Google request failed; retrieval could not complete." });
  }
  return finish({ kind: "partial", reason: `The ${MAX_LIST_PAGES}-page limit was reached. Narrow the query/window.` });
}

export function listingStatus(state: ListingState, complete: string): string {
  return state.kind === "complete" ? complete
    : `Incomplete results${state.kind === "unavailable" ? " (retrieval unavailable)" : ""}: ${state.reason} Additional matching results may exist.`;
}
