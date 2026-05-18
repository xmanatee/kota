/**
 * Skills namespace daemon-side handler test.
 *
 * The skills namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the skill-ops module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The skill-ops module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `skills` namespace with both
 *     `list` and `import` methods.
 *  2. `list()` is wired through `requestStrict<T>` — calling `list` issues
 *     a single `GET /skills` with no query string and no body.
 *  3. A successful `{ skills: SkillSummary[] }` response decodes verbatim.
 *  4. `import(source)` is wired through `requestStrict<T>` — calling
 *     `import` issues a single `POST /skills/import` with the canonical
 *     body shape (with and without the optional `name` override).
 *  5. A successful `{ ok: true; name; path }` response decodes verbatim.
 *  6. A `{ ok: false; reason: "fetch_failed"; message }` response decodes
 *     verbatim — the strict-transport posture replaces the previous
 *     `502 → typed result` special-case.
 *  7. A `{ ok: false; reason: "missing_name"; message }` response decodes
 *     verbatim — the strict-transport posture replaces the previous
 *     `400 → typed result` special-case.
 *  8. `requestStrict<T>` failures on either method propagate rather than
 *     being silently swallowed.
 *  9. Removing the skill-ops module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "skills" missing-handler
 *     error; supplying the contribution satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  SkillImportResult,
  SkillSummary,
  SkillsListResult,
} from "./client.js";
import skillsModule from "./index.js";

type RecordedRequestStrict = {
  kind: "requestStrict";
  method: string;
  path: string;
  body: unknown;
};

function makeRecordingTransport(options: {
  requestStrictResponder?: (
    method: string,
    path: string,
    body: unknown,
  ) => unknown;
}): { transport: DaemonTransport; calls: RecordedRequestStrict[] } {
  const calls: RecordedRequestStrict[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ kind: "requestStrict", method, path, body });
      if (!options.requestStrictResponder) {
        throw new Error("unexpected requestStrict call");
      }
      return options.requestStrictResponder(method, path, body) as T;
    },
    fetchRaw: async (): Promise<Response> => {
      throw new Error("unexpected fetchRaw call");
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function makeSkillSummary(name: string): SkillSummary {
  return {
    name,
    source: "skill-ops",
    sourceType: "module",
    status: "resolvable",
    activation: "default",
    promptPath: `src/modules/${name}/prompt.md`,
  };
}

describe("skill-ops module daemonClient(link)", () => {
  it("contributes a skills namespace handler with both methods", () => {
    expect(skillsModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport({});
    const contributed = skillsModule.daemonClient!(transport);
    expect(contributed.skills).toBeDefined();
    expect(typeof contributed.skills!.list).toBe("function");
    expect(typeof contributed.skills!.import).toBe("function");
  });

  it("routes list through GET /skills with no body", async () => {
    const expected: SkillsListResult = { skills: [] };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = skillsModule.daemonClient!(transport);
    const result = await contributed.skills!.list();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/skills",
        body: undefined,
      },
    ]);
  });

  it("decodes a successful { skills: SkillSummary[] } response verbatim", async () => {
    const summaries: SkillSummary[] = [
      makeSkillSummary("memory"),
      {
        ...makeSkillSummary("review"),
        description: "Review the diff",
        roles: ["builder", "critic"],
      },
    ];
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => ({ skills: summaries }),
    });
    const contributed = skillsModule.daemonClient!(transport);
    const result = await contributed.skills!.list();
    expect(result).toEqual({ skills: summaries });
  });

  it("propagates list HTTP failures rather than silently returning an empty list", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => {
        throw new Error("boom");
      },
    });
    const contributed = skillsModule.daemonClient!(transport);
    await expect(contributed.skills!.list()).rejects.toThrow(/boom/);
  });

  it("routes import through POST /skills/import with { source } body when no name override is supplied", async () => {
    const expected: SkillImportResult = {
      ok: true,
      name: "review",
      path: "/abs/.kota/skills/review.md",
    };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = skillsModule.daemonClient!(transport);
    const result = await contributed.skills!.import("https://example.com/review.md");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "POST",
        path: "/skills/import",
        body: { source: "https://example.com/review.md" },
      },
    ]);
  });

  it("routes import with the optional name override threaded into the body", async () => {
    const expected: SkillImportResult = {
      ok: true,
      name: "renamed",
      path: "/abs/.kota/skills/renamed.md",
    };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = skillsModule.daemonClient!(transport);
    const result = await contributed.skills!.import(
      "https://example.com/anon.md",
      { name: "renamed" },
    );
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "POST",
        path: "/skills/import",
        body: { source: "https://example.com/anon.md", name: "renamed" },
      },
    ]);
  });

  it("decodes a successful { ok: true; name; path } response verbatim", async () => {
    const expected: SkillImportResult = {
      ok: true,
      name: "review",
      path: "/abs/.kota/skills/review.md",
    };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = skillsModule.daemonClient!(transport);
    const result = await contributed.skills!.import("/local/review.md");
    expect(result).toEqual(expected);
  });

  it("decodes a { ok: false; reason: 'fetch_failed' } response verbatim under the strict-transport posture", async () => {
    const expected: SkillImportResult = {
      ok: false,
      reason: "fetch_failed",
      message: "HTTP 404: Not Found",
    };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = skillsModule.daemonClient!(transport);
    const result = await contributed.skills!.import("https://example.com/missing.md");
    expect(result).toEqual(expected);
  });

  it("decodes a { ok: false; reason: 'missing_name' } response verbatim under the strict-transport posture", async () => {
    const expected: SkillImportResult = {
      ok: false,
      reason: "missing_name",
      message:
        "Skill file has no 'name' field in frontmatter. Pass an explicit name to import it.",
    };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = skillsModule.daemonClient!(transport);
    const result = await contributed.skills!.import("/local/anon.md");
    expect(result).toEqual(expected);
  });

  it("propagates import transport failures rather than masquerading as a typed not-ok result", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => {
        throw new Error("boom");
      },
    });
    const contributed = skillsModule.daemonClient!(transport);
    await expect(contributed.skills!.import("/any")).rejects.toThrow(/boom/);
  });

  it("the assembly path fails loudly when the skill-ops module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport({});
    const others = buildMigratedNamespaceTestStubs();
    delete others.skills;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /skills/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the skill-ops module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = skillsModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.skills;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
