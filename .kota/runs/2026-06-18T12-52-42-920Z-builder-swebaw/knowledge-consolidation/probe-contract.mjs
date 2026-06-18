import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfiguredProject } from "../../../../src/core/daemon/scope-registry.ts";
import { KnowledgeProjectStores } from "../../../../src/modules/knowledge/project-scope.ts";
import { handleSearchKnowledge } from "../../../../src/modules/knowledge/routes.ts";
import { renderKnowledgeSearchPlain } from "../../../../src/modules/knowledge/render.ts";
import { parseKnowledgeSearchResponse as parseCanonicalKnowledgeSearch } from "../../../../clients/conformance/decoders.ts";

const artifactDir = dirname(fileURLToPath(import.meta.url));

const entries = [
  {
    id: "kn-1",
    title: "Knowledge fan-out",
    type: "note",
    tags: ["knowledge", "fan-out"],
    status: "active",
    created: "2026-06-18T12:52:00.000Z",
    updated: "2026-06-18T12:53:00.000Z",
    content: "Knowledge fan-out consolidation route contract.",
    meta: {},
  },
  {
    id: "kn-2",
    title: "Archived routing note",
    type: "reference",
    tags: ["routing"],
    status: "archived",
    created: "2026-06-18T12:54:00.000Z",
    updated: "2026-06-18T12:55:00.000Z",
    content: "Archived item for filter forwarding.",
    meta: {},
  },
];

function filteredSearch(query, filters = {}) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filters.tag && !entry.tags.includes(filters.tag)) return false;
    if (filters.type && entry.type !== filters.type) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (terms.length === 0) return true;
    const haystack =
      `${entry.title} ${entry.content} ${entry.tags.join(" ")} ${entry.type}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function makeProvider({ semantic = true, throws = false } = {}) {
  const observed = [];
  return {
    provider: {
      create: () => "unused",
      read: () => null,
      update: () => false,
      delete: () => false,
      count: () => entries.length,
      list: () => entries,
      search: (query, filters) => {
        if (throws) throw new Error("knowledge provider boom");
        observed.push({ method: "search", query, filters });
        return filteredSearch(query, filters);
      },
      supportsSemanticSearch: () => semantic,
      semanticSearch: async (query, topK, filters) => {
        if (throws) throw new Error("knowledge provider boom");
        observed.push({ method: "semanticSearch", query, topK, filters });
        return filteredSearch(query, filters).slice(0, topK);
      },
      reindex: async () => ({ indexed: 0, failed: 0, skipped: !semantic }),
    },
    observed,
  };
}

function mockResponse() {
  const result = {
    status: 0,
    headers: {},
    rawBody: "",
    body: null,
  };
  const res = {
    setHeader(name, value) {
      result.headers[name] = value;
    },
    writeHead(status, headers = {}) {
      result.status = status;
      result.headers = { ...result.headers, ...headers };
    },
    end(data) {
      result.rawBody = String(data);
      result.body = JSON.parse(result.rawBody);
    },
    on() {
      return this;
    },
  };
  return { res, result };
}

function request(url) {
  return { url };
}

function storesFor(provider) {
  const project = buildConfiguredProject({ projectDir: process.cwd() });
  return new KnowledgeProjectStores({
    defaultProjectDir: project.projectDir,
    defaultProjectId: project.projectId,
    projects: [project],
    getDefaultProvider: () => provider,
  });
}

async function routeCase(label, url, providerOptions = {}) {
  const { provider, observed } = makeProvider(providerOptions);
  const { res, result } = mockResponse();
  await handleSearchKnowledge(request(url), res, storesFor(provider));
  return {
    label,
    request: url,
    status: result.status,
    body: result.body,
    observed,
  };
}

async function unknownProjectCase() {
  const { provider } = makeProvider();
  const { res, result } = mockResponse();
  await handleSearchKnowledge(
    request("/api/knowledge/search?q=knowledge&projectId=missing-project"),
    res,
    storesFor(provider),
  );
  return {
    label: "unknown-project-404",
    request: "/api/knowledge/search?q=knowledge&projectId=missing-project",
    status: result.status,
    body: result.body,
  };
}

function arm(body) {
  if (body?.ok === true) return `ok:true entries:${body.entries.length}`;
  if (body?.ok === false) return `ok:false reason:${body.reason}`;
  return "non-search-error";
}

const cases = [
  await routeCase(
    "keyword-success-200",
    "/api/knowledge/search?q=knowledge%20fan-out&limit=10",
  ),
  await routeCase(
    "keyword-empty-200",
    "/api/knowledge/search?q=no-such-entry&limit=10",
  ),
  await routeCase(
    "semantic-success-filter-forwarding-200",
    "/api/knowledge/search?q=archived&semantic=true&limit=5&tag=routing&type=reference&status=archived&scope=project",
  ),
  await routeCase(
    "semantic-unavailable-200",
    "/api/knowledge/search?q=knowledge&semantic=true&limit=10",
    { semantic: false },
  ),
  await unknownProjectCase(),
  await routeCase(
    "provider-throws-500",
    "/api/knowledge/search?q=knowledge&limit=10",
    { throws: true },
  ),
];

const searchEnvelopeCases = cases.filter((item) => item.status === 200);
const decoderResults = searchEnvelopeCases.map((item) => ({
  label: item.label,
  daemonArm: arm(item.body),
  canonicalTypescriptDecoder: parseCanonicalKnowledgeSearch(item.body),
}));

const successCase = cases.find((item) => item.label === "keyword-success-200");
const renderSamples = {
  success: renderKnowledgeSearchPlain(successCase.body.entries),
  empty: "No matching knowledge entries.",
  semanticUnavailable:
    "Semantic knowledge search requires an embedding-backed knowledge provider.",
};

const result = {
  generatedAt: new Date().toISOString(),
  cases,
  decoderResults,
  renderSamples,
};

writeFileSync(
  join(artifactDir, "contract-probe.json"),
  JSON.stringify(result, null, 2) + "\n",
);

console.log(JSON.stringify({
  wrote: "contract-probe.json",
  cases: cases.map((item) => ({
    label: item.label,
    status: item.status,
    arm: arm(item.body),
  })),
}, null, 2));
