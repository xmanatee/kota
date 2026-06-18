import assert from "node:assert/strict";
import { handleSearchHistory } from "#modules/history/routes.js";

const sampleRecord = {
  id: "hist-1",
  title: "Release planning",
  createdAt: "2026-06-15T09:10:00.000Z",
  updatedAt: "2026-06-15T09:20:00.000Z",
  model: "test-model",
  messageCount: 3,
  cwd: "/tmp/project",
  source: "user",
};

function createProvider(options = {}) {
  const calls = [];
  return {
    calls,
    list(input = {}) {
      calls.push({ method: "list", input });
      if (options.throwList) throw new Error(options.throwList);
      return options.listResult ?? [sampleRecord];
    },
    getMostRecent() {
      return null;
    },
    findByPrefix() {
      return null;
    },
    remove() {
      return false;
    },
    supportsSemanticSearch() {
      return options.semantic === true;
    },
    async semanticSearch(query, topK, filters) {
      calls.push({ method: "semanticSearch", query, topK, filters });
      if (options.throwSemantic) throw new Error(options.throwSemantic);
      return options.semanticResult ?? [sampleRecord];
    },
    async reindex() {
      return { indexed: 0, failed: 0, skipped: true };
    },
  };
}

function createProjectStores(provider) {
  return {
    resolve() {
      return { ok: true, store: provider };
    },
  };
}

function createResponse() {
  return {
    headers: {},
    status: undefined,
    bodyText: undefined,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
    },
    end(body) {
      this.bodyText = body;
    },
  };
}

async function runCase(name, path, provider) {
  const req = { url: path };
  const res = createResponse();
  await handleSearchHistory(req, res, createProjectStores(provider));
  const body = JSON.parse(res.bodyText);
  return { name, status: res.status, body, calls: provider.calls };
}

const cases = [];

{
  const provider = createProvider({ semantic: false });
  const result = await runCase(
    "semantic-true-unsupported",
    "/api/history/search?q=harness&semantic=true",
    provider,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: false, reason: "semantic_unavailable" });
  cases.push(result);
}

{
  const provider = createProvider({ semantic: true });
  const result = await runCase(
    "semantic-true-supported",
    "/api/history/search?q=harness&semantic=true",
    provider,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.conversations, [sampleRecord]);
  cases.push(result);
}

{
  const provider = createProvider({ semantic: true, semanticResult: [] });
  const result = await runCase(
    "semantic-true-empty",
    "/api/history/search?q=missing&semantic=true",
    provider,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, conversations: [] });
  cases.push(result);
}

{
  const provider = createProvider({ semantic: true });
  const result = await runCase(
    "semantic-true-filter-forwarding",
    "/api/history/search?q=deploy&semantic=true&limit=7&cwd=/tmp/project&source=user",
    provider,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.calls, [
    {
      method: "semanticSearch",
      query: "deploy",
      topK: 7,
      filters: { cwd: "/tmp/project", source: "user" },
    },
  ]);
  cases.push(result);
}

{
  const provider = createProvider({ semantic: false, listResult: [] });
  const result = await runCase(
    "keyword-fallback",
    "/api/history/search?q=harness&semantic=false&limit=3&cwd=/tmp/project&source=action",
    provider,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, conversations: [] });
  assert.deepEqual(result.calls, [
    {
      method: "list",
      input: { search: "harness", limit: 3, cwd: "/tmp/project", source: "action" },
    },
  ]);
  cases.push(result);
}

{
  const provider = createProvider({ semantic: true, throwSemantic: "provider exploded" });
  const result = await runCase(
    "provider-throws",
    "/api/history/search?q=harness&semantic=true",
    provider,
  );
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "provider exploded" });
  cases.push(result);
}

console.log(JSON.stringify({ ok: true, cases }, null, 2));
