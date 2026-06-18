import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRecallRouteHandler } from "#modules/recall/routes.js";
import { parseRecallResult } from "../../../../clients/conformance/decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));

function mockRequest(body) {
  const data = Buffer.from(JSON.stringify(body));
  const handlers = new Map();
  return {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      if (event === "end") {
        setImmediate(() => {
          for (const callback of handlers.get("data") ?? []) callback(data);
          for (const callback of handlers.get("end") ?? []) callback();
        });
      }
      return this;
    },
    destroy() {},
  };
}

function mockResponse() {
  const result = { status: 0, headers: {}, body: null };
  return {
    result,
    res: {
      setHeader(name, value) {
        result.headers[name] = value;
      },
      writeHead(status, headers = {}) {
        result.status = status;
        Object.assign(result.headers, headers);
      },
      end(data) {
        result.body = data ? JSON.parse(data) : null;
      },
      on() {
        return this;
      },
    },
  };
}

function provider({ hits = [], contributors = ["knowledge"], onRecall, throws = false } = {}) {
  return {
    register() {},
    unregister() {},
    contributors() {
      return contributors;
    },
    async recall(query, filter, project) {
      onRecall?.({ query, filter, project });
      if (throws) throw new Error("provider boom");
      return hits;
    },
  };
}

async function call(handler, body) {
  const { res, result } = mockResponse();
  await handler(mockRequest(body), res);
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const mixedHits = [
  {
    source: "knowledge",
    score: 0.91,
    id: "kn-42",
    title: "Pluggable harness protocol",
    preview: "The harness boundary is a typed protocol with...",
    updated: "2026-04-20T12:00:00.000Z",
  },
  {
    source: "memory",
    score: 0.78,
    id: "mem-7",
    preview: "User prefers terse end-of-turn summaries.",
    created: "2026-04-15T09:30:00.000Z",
  },
  {
    source: "history",
    score: 0.66,
    id: "conv-12",
    title: "Daemon review 2026-04-28",
    cwd: "/Users/operator/projects/kota",
    updatedAt: "2026-04-28T18:30:00.000Z",
  },
  {
    source: "tasks",
    score: 0.55,
    id: "task-share-or-conformance-test-daemon-wire-contracts-ac",
    title: "Share or conformance-test daemon wire contracts across clients",
    state: "doing",
    priority: "p1",
    updatedAt: "2026-05-02T18:14:24.509Z",
  },
  {
    source: "answer",
    score: 0.49,
    id: "ans-1",
    query: "How does the harness boundary work?",
    preview: "The harness boundary is a typed protocol; see kn-42.",
    citationCount: 1,
    createdAt: "2026-05-01T12:00:00.000Z",
    result: { ok: true },
  },
];

const cases = [];

{
  const handler = createRecallRouteHandler(() => provider({ hits: mixedHits }));
  const response = await call(handler, { query: "harness boundary" });
  const decoded = parseRecallResult(response.body);
  assert(response.status === 200, "mixed-source success should return 200");
  assert(decoded.ok === true, "mixed-source success should decode as ok:true");
  assert(decoded.hits.length === 5, "mixed-source success should carry five hits");
  assert(
    decoded.hits.map((hit) => hit.source).join("|") === "knowledge|memory|history|tasks|answer",
    "mixed-source success should preserve the five-source closed set",
  );
  cases.push({
    name: "mixed-source-success",
    status: response.status,
    decodedSources: decoded.hits.map((hit) => hit.source),
  });
}

{
  const handler = createRecallRouteHandler(() =>
    provider({
      hits: [
        {
          source: "answer",
          score: 0.31,
          id: "ans-2",
          query: "What is the latest deploy status?",
          preview: "Recall returned no hits for this question.",
          citationCount: 0,
          createdAt: "2026-05-01T12:05:00.000Z",
          result: { ok: false, reason: "no_hits" },
        },
      ],
    }),
  );
  const response = await call(handler, { query: "deploy status" });
  const decoded = parseRecallResult(response.body);
  assert(response.status === 200, "answer failure-arm hit should return 200");
  assert(decoded.ok === true, "answer failure-arm hit should decode as ok:true");
  assert(decoded.hits[0]?.source === "answer", "answer failure-arm hit should keep source answer");
  assert(decoded.hits[0]?.result?.ok === false, "answer failure-arm hit should preserve result ok:false");
  cases.push({
    name: "answer-hit-failure-arm",
    status: response.status,
    decodedReason: decoded.hits[0]?.result?.reason,
  });
}

{
  const handler = createRecallRouteHandler(() => provider({ contributors: [] }));
  const response = await call(handler, { query: "anything" });
  const decoded = parseRecallResult(response.body);
  assert(response.status === 200, "no contributors should return 200");
  assert(decoded.ok === false, "no contributors should decode as ok:false");
  assert(decoded.reason === "semantic_unavailable", "no contributors should use semantic_unavailable");
  cases.push({ name: "semantic-unavailable", status: response.status, decodedReason: decoded.reason });
}

{
  const handler = createRecallRouteHandler(() => provider());
  const response = await call(handler, { query: "   " });
  assert(response.status === 400, "blank query should return 400");
  assert(response.body?.error === "query is required", "blank query should return typed error text");
  cases.push({ name: "blank-query", status: response.status, error: response.body.error });
}

{
  let captured = null;
  const handler = createRecallRouteHandler(() =>
    provider({
      onRecall(args) {
        captured = args;
      },
    }),
  );
  const response = await call(handler, {
    query: "graphrag",
    filter: {
      topK: 5,
      minScore: 0.4,
      sources: ["knowledge", "vault", "answer"],
      projectId: "project-1",
    },
  });
  assert(response.status === 200, "filter pass-through should return 200");
  assert(captured?.query === "graphrag", "filter pass-through should preserve query");
  assert(captured?.filter?.topK === 5, "filter pass-through should preserve topK");
  assert(captured?.filter?.minScore === 0.4, "filter pass-through should preserve minScore");
  assert(
    captured?.filter?.sources?.join("|") === "knowledge|answer",
    "filter pass-through should drop unknown sources and keep known sources",
  );
  assert(captured?.filter?.projectId === "project-1", "filter pass-through should preserve projectId");
  cases.push({ name: "filter-coercion", status: response.status, capturedFilter: captured.filter });
}

{
  const handler = createRecallRouteHandler(
    () => provider(),
    (projectId) => ({ error: "unknown_project", projectId }),
  );
  const response = await call(handler, {
    query: "scoped recall",
    filter: { projectId: "missing-project" },
  });
  assert(response.status === 404, "unknown project should return 404");
  assert(response.body?.reason === "unknown_project", "unknown project should carry typed reason");
  cases.push({ name: "unknown-project", status: response.status, body: response.body });
}

{
  const handler = createRecallRouteHandler(() => provider({ throws: true }));
  const response = await call(handler, { query: "anything" });
  assert(response.status === 500, "provider throw should return 500");
  assert(response.body?.error === "provider boom", "provider throw should preserve message");
  cases.push({ name: "provider-throws", status: response.status, error: response.body.error });
}

writeFileSync(
  join(here, "contract-probe.json"),
  `${JSON.stringify({
    ok: true,
    generatedAt: new Date().toISOString(),
    decoder: "clients/conformance/decoders.ts parseRecallResult",
    cases,
  }, null, 2)}\n`,
);

console.log(JSON.stringify({ ok: true, cases: cases.length, wrote: "contract-probe.json" }));
