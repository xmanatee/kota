import type { RecallFilter } from "./client.js";
import { isRecallSource } from "./recall-types.js";

export type RecallQueryRequest = {
  query: string;
  filter?: RecallFilter;
};

export function decodeRecallQueryRequest(
  value: Record<string, unknown>,
): RecallQueryRequest | null {
  const query = typeof value.query === "string" ? value.query : "";
  if (query.trim() === "") return null;
  const rawFilter = value.filter;
  if (!rawFilter || typeof rawFilter !== "object") return { query };
  const raw = rawFilter as Record<string, unknown>;
  const filter: RecallFilter = {};
  if (typeof raw.topK === "number" && Number.isFinite(raw.topK)) {
    filter.topK = raw.topK;
  }
  if (typeof raw.minScore === "number" && Number.isFinite(raw.minScore)) {
    filter.minScore = raw.minScore;
  }
  if (Array.isArray(raw.sources)) {
    const sources = raw.sources.filter(isRecallSource);
    if (sources.length > 0) filter.sources = sources;
  }
  if (typeof raw.scopeId === "string" && raw.scopeId.trim() !== "") {
    filter.scopeId = raw.scopeId;
  }
  return Object.keys(filter).length === 0 ? { query } : { query, filter };
}
