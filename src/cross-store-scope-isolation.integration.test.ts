import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { buildDirectoryScope, type DirectoryScope } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  HISTORY_PROVIDER_TOKEN,
  initProviderRegistry,
  KNOWLEDGE_PROVIDER_TOKEN,
  MEMORY_PROVIDER_TOKEN,
  type ProviderToken,
  REPO_TASKS_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { completeDaemonClientHandlers } from "#core/server/daemon-client-test-support.js";
import { buildLocalKotaClient } from "#core/server/local-kota-client.js";
import {
  answerHistoryRootForScope,
  DiskAnswerHistoryStore,
} from "#modules/answer/answer-history-store.js";
import { AnswerProviderImpl } from "#modules/answer/answer-provider.js";
import type { Synthesizer } from "#modules/answer/answer-types.js";
import { createAnswerRecallContributor } from "#modules/answer/recall-contributor.js";
import { createAnswerRouteHandler } from "#modules/answer/routes.js";
import { createAnswerScopeContextResolver } from "#modules/answer/scope-context.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import {
  createScopeInboxContributor as createCaptureScopeInboxContributor,
  createScopeKnowledgeContributor as createCaptureScopeKnowledgeContributor,
  createScopeMemoryContributor as createCaptureScopeMemoryContributor,
  createScopeTasksContributor as createCaptureScopeTasksContributor,
} from "#modules/capture/contributors.js";
import { createCaptureRouteHandler } from "#modules/capture/routes.js";
import { createCaptureScopeContextResolver } from "#modules/capture/scope-context.js";
import { getScopeHistoryStore } from "#modules/history/history.js";
import historyModule from "#modules/history/index.js";
import { createHistoryScopeStores } from "#modules/history/scope.js";
import knowledgeModule from "#modules/knowledge/index.js";
import { createKnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import memoryModule from "#modules/memory/index.js";
import { createMemoryScopeStores } from "#modules/memory/scope.js";
import { MemoryStore } from "#modules/memory/store.js";
import {
  createScopeHistoryContributor,
  createScopeKnowledgeContributor,
  createScopeMemoryContributor,
  createScopeTasksContributor,
} from "#modules/recall/contributors.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import { createRecallRouteHandler } from "#modules/recall/routes.js";
import { createRecallScopeContextResolver } from "#modules/recall/scope-context.js";
import repoTasksModule from "#modules/repo-tasks/index.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";
import { createRepoTasksScopeStores } from "#modules/repo-tasks/scope.js";
import {
  createScopeInboxContributor as createRetractScopeInboxContributor,
  createScopeKnowledgeContributor as createRetractScopeKnowledgeContributor,
  createScopeMemoryContributor as createRetractScopeMemoryContributor,
  createScopeTasksContributor as createRetractScopeTasksContributor,
} from "#modules/retract/contributors.js";
import { RetractProviderImpl } from "#modules/retract/retract-provider.js";
import { createRetractRouteHandler } from "#modules/retract/routes.js";
import { createRetractScopeContextResolver } from "#modules/retract/scope-context.js";
import type { KotaClient, LocalClientHandlers } from "#root/client/kota-client.generated.js";
import { KotaClientScopeError } from "#root/client/kota-client.generated.js";

type JsonResult = { status: number; body: unknown };

function makeRequest(body: Record<string, unknown>): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage;
  return req;
}

function mockResponse(): { res: ServerResponse; result: JsonResult } {
  const result: JsonResult = { status: 0, body: null };
  const res = {
    setHeader: vi.fn(),
    writeHead: (status: number) => {
      result.status = status;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  body: Record<string, unknown>,
): Promise<JsonResult> {
  const { res, result } = mockResponse();
  await handler(makeRequest(body), res);
  return result;
}

function makeScopeRoot(parent: string, name: string): string {
  const scopeRoot = join(parent, name);
  mkdirSync(join(scopeRoot, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(scopeRoot, "data", "tasks", "dropped"), { recursive: true });
  mkdirSync(join(scopeRoot, "data", "inbox"), { recursive: true });
  execSync("git init -q", { cwd: scopeRoot });
  execSync('git config user.email "test@test"', { cwd: scopeRoot });
  execSync('git config user.name "test"', { cwd: scopeRoot });
  return scopeRoot;
}

describe("scope-scoped cross-store daemon routes", () => {
  let root: string;
  let scopeA: DirectoryScope;
  let scopeB: DirectoryScope;
  let capture: ReturnType<typeof createCaptureRouteHandler>;
  let recall: ReturnType<typeof createRecallRouteHandler>;
  let answer: ReturnType<typeof createAnswerRouteHandler>;
  let retract: ReturnType<typeof createRetractRouteHandler>;
  let historyA: DiskAnswerHistoryStore;
  let client: KotaClient;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-cross-store-scopes-"));
    scopeA = buildDirectoryScope({ scopeRoot: makeScopeRoot(root, "a") });
    scopeB = buildDirectoryScope({ scopeRoot: makeScopeRoot(root, "b") });

    const memoryA = new MemoryStore(join(scopeA.scopeRoot, ".kota"));
    const knowledgeA = new KnowledgeStore(scopeA.scopeRoot);
    const historyProviderA = getScopeHistoryStore(scopeA.scopeRoot);
    const tasksA = new RepoTasksDefaultStore(scopeA.scopeRoot);

    const registry = initProviderRegistry();
    registry.register(DAEMON_SCOPE_PROVIDER_TYPE, "test", {
      getScopeRegistryProjection: () => ({
        rootScopeId: "global",
        defaultScopeId: scopeA.scopeId,
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId: scopeA.scopeId,
            displayName: scopeA.displayName,
            parentScopeId: "global",
            directoryRoot: scopeA.scopeRoot,
          },
          {
            scopeId: scopeB.scopeId,
            displayName: scopeB.displayName,
            parentScopeId: "global",
            directoryRoot: scopeB.scopeRoot,
          },
        ],
      }),
      getActiveScopeId: () => null,
      resolveScopeRuntime: () => {
        throw new Error("cross-store test does not use daemon runtime queues");
      },
    });
    registry.register(MEMORY_PROVIDER_TOKEN, "default", memoryA);
    registry.register(KNOWLEDGE_PROVIDER_TOKEN, "default", knowledgeA);
    registry.register(HISTORY_PROVIDER_TOKEN, "default", historyProviderA);
    registry.register(REPO_TASKS_PROVIDER_TOKEN, "default", tasksA);

    const captureScope = createCaptureScopeContextResolver(scopeA.scopeRoot);
    const captureProvider = new CaptureProviderImpl({
      classifier: { classify: async () => ({ kind: "ambiguous" }) },
      resolveScopeContext: captureScope,
    });
    captureProvider.register(createCaptureScopeMemoryContributor());
    captureProvider.register(createCaptureScopeKnowledgeContributor());
    captureProvider.register(createCaptureScopeTasksContributor());
    captureProvider.register(createCaptureScopeInboxContributor());

    const recallScope = createRecallScopeContextResolver(scopeA.scopeRoot);
    const recallProvider = new RecallProviderImpl({
      resolveScopeContext: recallScope,
      onContributorError: () => {},
    });
    recallProvider.register(
      createScopeKnowledgeContributor(
        createKnowledgeScopeStores(scopeA.scopeRoot, () => knowledgeA),
      ),
    );
    recallProvider.register(
      createScopeMemoryContributor(
        createMemoryScopeStores(scopeA.scopeRoot, () => memoryA),
      ),
    );
    recallProvider.register(createScopeHistoryContributor(
      createHistoryScopeStores(scopeA.scopeRoot, () => historyProviderA),
    ));
    recallProvider.register(createScopeTasksContributor(
      createRepoTasksScopeStores(scopeA.scopeRoot, () => tasksA),
    ));

    historyA = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForScope(join(scopeA.scopeRoot, ".kota")),
    });
    const answerScope = createAnswerScopeContextResolver(
      scopeA.scopeRoot,
      () => historyA,
    );
    recallProvider.register(createAnswerRecallContributor(historyA, answerScope));
    const synthesizer: Synthesizer = async ({ hits }) => {
      const first = hits[0];
      if (!first) return "";
      return `Scoped answer [${first.source}:${first.id}]`;
    };
    const answerProvider = new AnswerProviderImpl({
      recall: {
        recall: async (query, filter) => ({
          ok: true,
          hits: await recallProvider.recall(query, filter),
        }),
      },
      synthesizer,
      history: historyA,
    });

    const retractScope = createRetractScopeContextResolver(scopeA.scopeRoot);
    const retractProvider = new RetractProviderImpl({
      resolveScopeContext: retractScope,
    });
    retractProvider.register(createRetractScopeMemoryContributor());
    retractProvider.register(createRetractScopeKnowledgeContributor());
    retractProvider.register(createRetractScopeTasksContributor());
    retractProvider.register(createRetractScopeInboxContributor());

    capture = createCaptureRouteHandler(() => captureProvider, captureScope);
    recall = createRecallRouteHandler(() => recallProvider, recallScope);
    answer = createAnswerRouteHandler(() => answerProvider, answerScope);
    retract = createRetractRouteHandler(() => retractProvider, retractScope);

    const moduleCtx = {
      cwd: scopeA.scopeRoot,
      getProvider: <T>(token: ProviderToken<T>) => registry.get(token),
    } as ModuleContext;
    const handlers = {
      ...completeDaemonClientHandlers(),
      ...memoryModule.localClient!(moduleCtx),
      ...knowledgeModule.localClient!(moduleCtx),
      ...historyModule.localClient!(moduleCtx),
      ...repoTasksModule.localClient!(moduleCtx),
      recall: {
        recall: async (query, filter) => {
          const scope = recallScope(filter?.scopeId);
          if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
          return {
            ok: true as const,
            hits: await recallProvider.recall(query, filter, scope),
          };
        },
      },
      answer: {
        answer: async (query, filter) => {
          const scope = answerScope(filter?.scopeId);
          if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
          return answerProvider.answer(query, filter, scope);
        },
        log: async (filter) => {
          const scope = answerScope(filter?.scopeId);
          if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
          const entries = await scope.history.listAnswers({
            ...(filter?.limit !== undefined && { limit: filter.limit }),
            ...(filter?.beforeId !== undefined && { beforeId: filter.beforeId }),
          });
          return { entries };
        },
        show: async (id, scopeSelection) => {
          const scope = answerScope(scopeSelection?.scopeId);
          if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
          const record = await scope.history.getAnswer(id);
          return record
            ? { ok: true as const, record }
            : { ok: false as const, reason: "not_found" as const };
        },
      },
      capture: {
        capture: async (text, filter) => {
          const scope = captureScope(filter?.scopeId);
          if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
          return captureProvider.capture(text, filter, scope);
        },
      },
      retract: {
        retract: async (request) => {
          const scope = retractScope(request.scopeId);
          if ("error" in scope) throw new Error(`Unknown scope: ${scope.scopeId}`);
          return retractProvider.retract(request, scope);
        },
      },
    } as LocalClientHandlers;
    client = buildLocalKotaClient(handlers);
  });

  afterEach(() => {
    resetProviderRegistry();
    rmSync(root, { recursive: true, force: true });
  });

  it("isolates recall, answer, capture, and retract by scope id", async () => {
    const captureA = await invoke(capture, {
      text: "alphaonly operator note",
      filter: { target: "memory", scopeId: scopeA.scopeId },
    });
    expect(captureA.status).toBe(200);
    const memoryAId = (captureA.body as { ok: true; record: { recordId: string } }).record.recordId;

    const recallA = await invoke(recall, {
      query: "alphaonly",
      filter: { scopeId: scopeA.scopeId },
    });
    expect(recallA.status).toBe(200);
    expect((recallA.body as { ok: true; hits: Array<{ id: string }> }).hits)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: memoryAId })]));

    const recallBEmpty = await invoke(recall, {
      query: "alphaonly",
      filter: { scopeId: scopeB.scopeId },
    });
    expect(recallBEmpty.status).toBe(200);
    expect((recallBEmpty.body as { ok: true; hits: unknown[] }).hits).toEqual([]);

    const answerA = await invoke(answer, {
      query: "alphaonly",
      filter: { scopeId: scopeA.scopeId },
    });
    expect(answerA.status).toBe(200);
    expect(answerA.body).toMatchObject({
      ok: true,
      citations: [{ source: "memory", id: memoryAId }],
    });

    const answerB = await invoke(answer, {
      query: "alphaonly",
      filter: { scopeId: scopeB.scopeId },
    });
    expect(answerB.status).toBe(200);
    expect(answerB.body).toEqual({ ok: false, reason: "no_hits" });

    const captureB = await invoke(capture, {
      text: "betaretract operator note",
      filter: { target: "memory", scopeId: scopeB.scopeId },
    });
    expect(captureB.status).toBe(200);
    const memoryBId = (captureB.body as { ok: true; record: { recordId: string } }).record.recordId;

    const wrongScopeRetract = await invoke(retract, {
      target: "memory",
      id: memoryBId,
      scopeId: scopeA.scopeId,
    });
    expect(wrongScopeRetract.status).toBe(200);
    expect(wrongScopeRetract.body).toEqual({
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: memoryBId,
    });

    const rightScopeRetract = await invoke(retract, {
      target: "memory",
      id: memoryBId,
      scopeId: scopeB.scopeId,
    });
    expect(rightScopeRetract.status).toBe(200);
    expect(rightScopeRetract.body).toEqual({
      ok: true,
      record: { target: "memory", recordId: memoryBId },
    });
  });

  it("rejects unknown scope ids before pipeline execution", async () => {
    await expect(invoke(recall, {
      query: "x",
      filter: { scopeId: "missing-scope" },
    })).resolves.toMatchObject({
      status: 404,
      body: {
        error: "Unknown scope",
        reason: "unknown_scope",
        scopeId: "missing-scope",
      },
    });

    await expect(invoke(answer, {
      query: "x",
      filter: { scopeId: "missing-scope" },
    })).resolves.toMatchObject({ status: 404 });

    await expect(invoke(capture, {
      text: "x",
      filter: { target: "memory", scopeId: "missing-scope" },
    })).resolves.toMatchObject({ status: 404 });

    await expect(invoke(retract, {
      target: "memory",
      id: "mem-x",
      scopeId: "missing-scope",
    })).resolves.toMatchObject({ status: 404 });
  });

  it("KotaClient.forScope isolates every scope-scoped namespace", async () => {
    const clientA = client.forScope(scopeA.scopeId);
    const clientB = client.forScope(scopeB.scopeId);

    const memoryA = await clientA.memory.add("client-alpha memory note");
    const memorySearchA = await clientA.memory.search("client-alpha");
    expect(memorySearchA).toMatchObject({
      ok: true,
      entries: [expect.objectContaining({ id: memoryA.id })],
    });
    const memorySearchB = await clientB.memory.search("client-alpha");
    expect(memorySearchB).toEqual({ ok: true, entries: [] });

    const knowledgeA = await clientA.knowledge.add({
      title: "client-alpha knowledge",
      content: "client-alpha knowledge body",
    });
    const knowledgeSearchA = await clientA.knowledge.search("client-alpha knowledge");
    expect(knowledgeSearchA).toMatchObject({
      ok: true,
      entries: [expect.objectContaining({ id: knowledgeA.id })],
    });
    const knowledgeSearchB = await clientB.knowledge.search("client-alpha knowledge");
    expect(knowledgeSearchB).toEqual({ ok: true, entries: [] });

    const historyId = getScopeHistoryStore(scopeA.scopeRoot).create(
      "test-model",
      scopeA.scopeRoot,
    );
    getScopeHistoryStore(scopeA.scopeRoot).save(
      historyId,
      [{ role: "user", content: "client-alpha history turn" }],
      0,
      0,
    );
    const historySearchA = await clientA.history.search("client-alpha history");
    expect(historySearchA).toMatchObject({
      ok: true,
      conversations: [expect.objectContaining({ id: historyId })],
    });
    const historySearchB = await clientB.history.search("client-alpha history");
    expect(historySearchB).toEqual({ ok: true, conversations: [] });

    const taskA = await clientA.tasks.create({
      title: "client-alpha task",
      priority: "p2",
      area: "core",
      state: "backlog",
    });
    expect(taskA.ok).toBe(true);
    const taskSearchA = await clientA.tasks.search("client-alpha task", {
      semantic: false,
    });
    expect(taskSearchA).toMatchObject({
      ok: true,
      tasks: [expect.objectContaining({ id: taskA.ok ? taskA.id : "" })],
    });
    const taskSearchB = await clientB.tasks.search("client-alpha task", {
      semantic: false,
    });
    expect(taskSearchB).toEqual({ ok: true, tasks: [] });

    const captureA = await clientA.capture.capture("client-alpha capture note", {
      target: "memory",
    });
    expect(captureA).toMatchObject({ ok: true, record: { target: "memory" } });
    const captureSearchB = await clientB.memory.search("client-alpha capture");
    expect(captureSearchB).toEqual({ ok: true, entries: [] });

    const recallA = await clientA.recall.recall("client-alpha");
    expect(recallA.ok).toBe(true);
    expect(recallA.ok ? recallA.hits.length : 0).toBeGreaterThan(0);
    const recallB = await clientB.recall.recall("client-alpha");
    expect(recallB).toEqual({ ok: true, hits: [] });

    const answerA = await clientA.answer.answer("client-alpha");
    expect(answerA).toMatchObject({ ok: true });
    const answerLogA = await clientA.answer.log();
    expect(answerLogA.entries.length).toBeGreaterThan(0);
    const answerLogB = await clientB.answer.log();
    expect(answerLogB.entries).toEqual([]);
    const leakedAnswer = await clientB.answer.show(answerLogA.entries[0]!.id);
    expect(leakedAnswer).toEqual({ ok: false, reason: "not_found" });
    const answerB = await clientB.answer.answer("client-alpha");
    expect(answerB).toEqual({ ok: false, reason: "no_hits" });
    const answerLogBAfterOwnCall = await clientB.answer.log();
    expect(answerLogBAfterOwnCall.entries.map((entry) => entry.id)).not.toContain(
      answerLogA.entries[0]!.id,
    );

    const retractTarget = await clientA.memory.add("client-alpha retract target");
    const wrongScopeRetract = await clientB.retract.retract({
      target: "memory",
      id: retractTarget.id,
    });
    expect(wrongScopeRetract).toEqual({
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: retractTarget.id,
    });
    const rightScopeRetract = await clientA.retract.retract({
      target: "memory",
      id: retractTarget.id,
    });
    expect(rightScopeRetract).toEqual({
      ok: true,
      record: { target: "memory", recordId: retractTarget.id },
    });

    await expect(client.forScope("missing-scope").memory.list()).rejects.toMatchObject({
      reason: "unknown_scope",
      scopeId: "missing-scope",
    });
    await expect(client.forScope("missing-scope").memory.list()).rejects.toBeInstanceOf(
      KotaClientScopeError,
    );
  });
});
