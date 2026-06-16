import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAnswerHistoryRouteHandler,
  createAnswerRouteHandler,
} from "../../../../src/modules/answer/routes.ts";

const here = dirname(fileURLToPath(import.meta.url));

const successResult = {
  ok: true,
  answer:
    "KOTA chains cited answers from knowledge [knowledge:kota-answer] and prior answer envelopes [answer:answer-prev].",
  citations: [
    { source: "knowledge", id: "kota-answer" },
    { source: "answer", id: "answer-prev" },
  ],
  hits: [
    {
      source: "knowledge",
      score: 0.993,
      id: "kota-answer",
      title: "Answer surface contract",
      preview: "All clients render AnswerResult and AnswerHistoryShowResult.",
      updated: "2026-06-16",
    },
    {
      source: "answer",
      score: 0.884,
      id: "answer-prev",
      query: "How does answer history work?",
      preview: "Answer history persists every cited-answer envelope.",
      citationCount: 1,
      createdAt: "2026-06-16T16:00:00.000Z",
      result: { ok: true },
    },
  ],
};

const historyRecord = {
  id: "answer-rec-1",
  createdAt: "2026-06-16T16:00:00.000Z",
  query: "How does answer history work?",
  filter: { topK: 8, sources: ["knowledge", "answer"] },
  recallHits: successResult.hits,
  result: successResult,
};

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
        result.headers = { ...result.headers, ...headers };
      },
      end(data) {
        result.body = JSON.parse(String(data));
      },
      on() {
        return this;
      },
    },
  };
}

function mockPostRequest(body) {
  const encoded = Buffer.from(JSON.stringify(body));
  const handlers = {};
  return {
    method: "POST",
    on(event, handler) {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
      if (event === "end") {
        setImmediate(() => {
          for (const h of handlers.data || []) h(encoded);
          for (const h of handlers.end || []) h();
        });
      }
      return this;
    },
    destroy() {},
  };
}

function mockGetRequest(url) {
  return {
    method: "GET",
    url,
    on() {
      return this;
    },
  };
}

function providerFor(result, observed) {
  return {
    async answer(query, filter) {
      observed.query = query;
      observed.filter = filter;
      return result;
    },
  };
}

function throwingProvider() {
  return {
    async answer() {
      throw new Error("provider boom");
    },
  };
}

function historyStore(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    async appendAnswer() {},
    async searchAnswers() {
      return [];
    },
    async listAnswers() {
      return records.map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        query: record.query,
        result: record.result.ok
          ? { ok: true, citationCount: record.result.citations.length }
          : { ok: false, reason: record.result.reason },
      }));
    },
    async getAnswer(id) {
      return byId.get(id) || null;
    },
  };
}

async function answerCase(name, body, resultOrProvider) {
  const observed = {};
  const provider =
    typeof resultOrProvider.answer === "function"
      ? resultOrProvider
      : providerFor(resultOrProvider, observed);
  const handler = createAnswerRouteHandler(() => provider);
  const { res, result } = mockResponse();
  await handler(mockPostRequest(body), res);
  return {
    name,
    status: result.status,
    body: result.body,
    ...(observed.query ? { observed } : {}),
  };
}

async function historyListCase(name, url, records) {
  const handlers = createAnswerHistoryRouteHandler(() => historyStore(records));
  const { res, result } = mockResponse();
  await handlers.list(mockGetRequest(url), res);
  return { name, status: result.status, body: result.body };
}

async function historyShowCase(name, id, records) {
  const handlers = createAnswerHistoryRouteHandler(() => historyStore(records));
  const { res, result } = mockResponse();
  await handlers.showById(id, mockGetRequest(`/answers/${id}`), res);
  return { name, status: result.status, body: result.body };
}

const cases = [
  await answerCase("empty-query-400", { query: "   " }, successResult),
  await answerCase("ok-success-knowledge-and-answer-citations-200", {
    query: "How does answer history work?",
    filter: { topK: 8, sources: ["knowledge", "answer"] },
  }, successResult),
  await answerCase("no-hits-200", { query: "missing" }, {
    ok: false,
    reason: "no_hits",
  }),
  await answerCase("semantic-unavailable-200", { query: "missing" }, {
    ok: false,
    reason: "semantic_unavailable",
  }),
  await answerCase("synthesis-failed-200", { query: "missing" }, {
    ok: false,
    reason: "synthesis_failed",
  }),
  await answerCase("provider-throws-500", { query: "anything" }, throwingProvider()),
  await historyListCase("answer-log-mixed-list-200", "/answers?limit=20", [
    historyRecord,
    {
      ...historyRecord,
      id: "answer-rec-2",
      query: "No match?",
      result: { ok: false, reason: "no_hits" },
    },
  ]),
  await historyShowCase("answer-show-found-200", "answer-rec-1", [historyRecord]),
  await historyShowCase("answer-show-not-found-200", "missing", [historyRecord]),
];

const summary = {
  generatedAt: "2026-06-16T17:03:01.000Z",
  routeSource: "src/modules/answer/routes.ts",
  coveredAnswerResultArms: [
    "ok:true",
    "ok:false/no_hits",
    "ok:false/semantic_unavailable",
    "ok:false/synthesis_failed",
  ],
  coveredAnswerHistoryArms: ["log entries", "show ok:true", "show not_found"],
  cases,
};

writeFileSync(
  join(here, "contract-probe.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify({ wrote: "contract-probe.json", cases: cases.length }));
