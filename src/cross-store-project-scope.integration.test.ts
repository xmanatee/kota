import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfiguredProject, type ConfiguredProject } from "#core/daemon/project-registry.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  HISTORY_PROVIDER_TOKEN,
  initProviderRegistry,
  KNOWLEDGE_PROVIDER_TOKEN,
  MEMORY_PROVIDER_TOKEN,
  REPO_TASKS_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { KotaClient, LocalClientHandlers } from "#core/server/kota-client.js";
import { KotaClientProjectError } from "#core/server/kota-client.js";
import { buildLocalKotaClient } from "#core/server/local-kota-client.js";
import {
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "#modules/answer/answer-history-store.js";
import { AnswerProviderImpl } from "#modules/answer/answer-provider.js";
import type { Synthesizer } from "#modules/answer/answer-types.js";
import { createAnswerProjectContextResolver } from "#modules/answer/project-context.js";
import { createAnswerRecallContributor } from "#modules/answer/recall-contributor.js";
import { createAnswerRouteHandler } from "#modules/answer/routes.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import {
  createProjectInboxContributor as createProjectCaptureInboxContributor,
  createProjectKnowledgeContributor as createProjectCaptureKnowledgeContributor,
  createProjectMemoryContributor as createProjectCaptureMemoryContributor,
  createProjectTasksContributor as createProjectCaptureTasksContributor,
} from "#modules/capture/contributors.js";
import { createCaptureProjectContextResolver } from "#modules/capture/project-context.js";
import { createCaptureRouteHandler } from "#modules/capture/routes.js";
import { getProjectHistoryStore } from "#modules/history/history.js";
import historyModule from "#modules/history/index.js";
import { createHistoryProjectStores } from "#modules/history/project-scope.js";
import knowledgeModule from "#modules/knowledge/index.js";
import { createKnowledgeProjectStores } from "#modules/knowledge/project-scope.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import memoryModule from "#modules/memory/index.js";
import { createMemoryProjectStores } from "#modules/memory/project-scope.js";
import { MemoryStore } from "#modules/memory/store.js";
import {
  createProjectHistoryContributor,
  createProjectKnowledgeContributor,
  createProjectMemoryContributor,
  createProjectTasksContributor,
} from "#modules/recall/contributors.js";
import { createRecallProjectContextResolver } from "#modules/recall/project-context.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import { createRecallRouteHandler } from "#modules/recall/routes.js";
import repoTasksModule from "#modules/repo-tasks/index.js";
import { createRepoTasksProjectStores } from "#modules/repo-tasks/project-scope.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";
import {
  createProjectInboxContributor as createProjectRetractInboxContributor,
  createProjectKnowledgeContributor as createProjectRetractKnowledgeContributor,
  createProjectMemoryContributor as createProjectRetractMemoryContributor,
  createProjectTasksContributor as createProjectRetractTasksContributor,
} from "#modules/retract/contributors.js";
import { createRetractProjectContextResolver } from "#modules/retract/project-context.js";
import { RetractProviderImpl } from "#modules/retract/retract-provider.js";
import { createRetractRouteHandler } from "#modules/retract/routes.js";

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

function makeProjectRoot(parent: string, name: string): string {
  const projectDir = join(parent, name);
  mkdirSync(join(projectDir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(projectDir, "data", "tasks", "dropped"), { recursive: true });
  mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
  execSync("git init -q", { cwd: projectDir });
  execSync('git config user.email "test@test"', { cwd: projectDir });
  execSync('git config user.name "test"', { cwd: projectDir });
  return projectDir;
}

describe("project-scoped cross-store daemon routes", () => {
  let root: string;
  let projectA: ConfiguredProject;
  let projectB: ConfiguredProject;
  let capture: ReturnType<typeof createCaptureRouteHandler>;
  let recall: ReturnType<typeof createRecallRouteHandler>;
  let answer: ReturnType<typeof createAnswerRouteHandler>;
  let retract: ReturnType<typeof createRetractRouteHandler>;
  let historyA: DiskAnswerHistoryStore;
  let client: KotaClient;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-cross-store-projects-"));
    projectA = buildConfiguredProject({ projectDir: makeProjectRoot(root, "a") });
    projectB = buildConfiguredProject({ projectDir: makeProjectRoot(root, "b") });

    const memoryA = new MemoryStore(join(projectA.projectDir, ".kota"));
    const knowledgeA = new KnowledgeStore(projectA.projectDir);
    const historyProviderA = getProjectHistoryStore(projectA.projectDir);
    const tasksA = new RepoTasksDefaultStore(projectA.projectDir);

    const registry = initProviderRegistry();
    registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "test", {
      getProjectRegistryProjection: () => ({
        defaultProjectId: projectA.projectId,
        projects: [projectA, projectB],
      }),
      getActiveProjectId: () => null,
      resolveProjectRuntime: () => {
        throw new Error("cross-store test does not use daemon runtime queues");
      },
    });
    registry.register(MEMORY_PROVIDER_TOKEN, "default", memoryA);
    registry.register(KNOWLEDGE_PROVIDER_TOKEN, "default", knowledgeA);
    registry.register(HISTORY_PROVIDER_TOKEN, "default", historyProviderA);
    registry.register(REPO_TASKS_PROVIDER_TOKEN, "default", tasksA);

    const captureProject = createCaptureProjectContextResolver(projectA.projectDir);
    const captureProvider = new CaptureProviderImpl({
      classifier: { classify: async () => ({ kind: "ambiguous" }) },
      resolveProjectContext: captureProject,
    });
    captureProvider.register(createProjectCaptureMemoryContributor());
    captureProvider.register(createProjectCaptureKnowledgeContributor());
    captureProvider.register(createProjectCaptureTasksContributor());
    captureProvider.register(createProjectCaptureInboxContributor());

    const recallProject = createRecallProjectContextResolver(projectA.projectDir);
    const recallProvider = new RecallProviderImpl({
      resolveProjectContext: recallProject,
      onContributorError: () => {},
    });
    recallProvider.register(
      createProjectKnowledgeContributor(
        createKnowledgeProjectStores(projectA.projectDir, () => knowledgeA),
      ),
    );
    recallProvider.register(
      createProjectMemoryContributor(
        createMemoryProjectStores(projectA.projectDir, () => memoryA),
      ),
    );
    recallProvider.register(createProjectHistoryContributor(
      createHistoryProjectStores(projectA.projectDir, () => historyProviderA),
    ));
    recallProvider.register(createProjectTasksContributor(
      createRepoTasksProjectStores(projectA.projectDir, () => tasksA),
    ));

    historyA = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForProject(join(projectA.projectDir, ".kota")),
    });
    const answerProject = createAnswerProjectContextResolver(
      projectA.projectDir,
      () => historyA,
    );
    recallProvider.register(createAnswerRecallContributor(historyA, answerProject));
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

    const retractProject = createRetractProjectContextResolver(projectA.projectDir);
    const retractProvider = new RetractProviderImpl({
      resolveProjectContext: retractProject,
    });
    retractProvider.register(createProjectRetractMemoryContributor());
    retractProvider.register(createProjectRetractKnowledgeContributor());
    retractProvider.register(createProjectRetractTasksContributor());
    retractProvider.register(createProjectRetractInboxContributor());

    capture = createCaptureRouteHandler(() => captureProvider, captureProject);
    recall = createRecallRouteHandler(() => recallProvider, recallProject);
    answer = createAnswerRouteHandler(() => answerProvider, answerProject);
    retract = createRetractRouteHandler(() => retractProvider, retractProject);

    const moduleCtx = { cwd: projectA.projectDir } as ModuleContext;
    const handlers = {
      ...buildMigratedNamespaceTestStubs(),
      ...memoryModule.localClient!(moduleCtx),
      ...knowledgeModule.localClient!(moduleCtx),
      ...historyModule.localClient!(moduleCtx),
      ...repoTasksModule.localClient!(moduleCtx),
      recall: {
        recall: async (query, filter) => {
          const project = recallProject(filter?.projectId);
          if ("error" in project) throw new Error(`Unknown project: ${project.projectId}`);
          return {
            ok: true as const,
            hits: await recallProvider.recall(query, filter, project),
          };
        },
      },
      answer: {
        answer: async (query, filter) => {
          const project = answerProject(filter?.projectId);
          if ("error" in project) throw new Error(`Unknown project: ${project.projectId}`);
          return answerProvider.answer(query, filter, project);
        },
        log: async (filter) => {
          const project = answerProject(filter?.projectId);
          if ("error" in project) throw new Error(`Unknown project: ${project.projectId}`);
          const entries = await project.history.listAnswers({
            ...(filter?.limit !== undefined && { limit: filter.limit }),
            ...(filter?.beforeId !== undefined && { beforeId: filter.beforeId }),
          });
          return { entries };
        },
        show: async (id, projectSelection) => {
          const project = answerProject(projectSelection?.projectId);
          if ("error" in project) throw new Error(`Unknown project: ${project.projectId}`);
          const record = await project.history.getAnswer(id);
          return record
            ? { ok: true as const, record }
            : { ok: false as const, reason: "not_found" as const };
        },
      },
      capture: {
        capture: async (text, filter) => {
          const project = captureProject(filter?.projectId);
          if ("error" in project) throw new Error(`Unknown project: ${project.projectId}`);
          return captureProvider.capture(text, filter, project);
        },
      },
      retract: {
        retract: async (request) => {
          const project = retractProject(request.projectId);
          if ("error" in project) throw new Error(`Unknown project: ${project.projectId}`);
          return retractProvider.retract(request, project);
        },
      },
    } as LocalClientHandlers;
    client = buildLocalKotaClient(handlers);
  });

  afterEach(() => {
    resetProviderRegistry();
    rmSync(root, { recursive: true, force: true });
  });

  it("isolates recall, answer, capture, and retract by project id", async () => {
    const captureA = await invoke(capture, {
      text: "alphaonly operator note",
      filter: { target: "memory", projectId: projectA.projectId },
    });
    expect(captureA.status).toBe(200);
    const memoryAId = (captureA.body as { ok: true; record: { recordId: string } }).record.recordId;

    const recallA = await invoke(recall, {
      query: "alphaonly",
      filter: { projectId: projectA.projectId },
    });
    expect(recallA.status).toBe(200);
    expect((recallA.body as { ok: true; hits: Array<{ id: string }> }).hits)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: memoryAId })]));

    const recallBEmpty = await invoke(recall, {
      query: "alphaonly",
      filter: { projectId: projectB.projectId },
    });
    expect(recallBEmpty.status).toBe(200);
    expect((recallBEmpty.body as { ok: true; hits: unknown[] }).hits).toEqual([]);

    const answerA = await invoke(answer, {
      query: "alphaonly",
      filter: { projectId: projectA.projectId },
    });
    expect(answerA.status).toBe(200);
    expect(answerA.body).toMatchObject({
      ok: true,
      citations: [{ source: "memory", id: memoryAId }],
    });

    const answerB = await invoke(answer, {
      query: "alphaonly",
      filter: { projectId: projectB.projectId },
    });
    expect(answerB.status).toBe(200);
    expect(answerB.body).toEqual({ ok: false, reason: "no_hits" });

    const captureB = await invoke(capture, {
      text: "betaretract operator note",
      filter: { target: "memory", projectId: projectB.projectId },
    });
    expect(captureB.status).toBe(200);
    const memoryBId = (captureB.body as { ok: true; record: { recordId: string } }).record.recordId;

    const wrongProjectRetract = await invoke(retract, {
      target: "memory",
      id: memoryBId,
      projectId: projectA.projectId,
    });
    expect(wrongProjectRetract.status).toBe(200);
    expect(wrongProjectRetract.body).toEqual({
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: memoryBId,
    });

    const rightProjectRetract = await invoke(retract, {
      target: "memory",
      id: memoryBId,
      projectId: projectB.projectId,
    });
    expect(rightProjectRetract.status).toBe(200);
    expect(rightProjectRetract.body).toEqual({
      ok: true,
      record: { target: "memory", recordId: memoryBId },
    });
  });

  it("rejects unknown project ids before pipeline execution", async () => {
    await expect(invoke(recall, {
      query: "x",
      filter: { projectId: "missing-project" },
    })).resolves.toMatchObject({
      status: 404,
      body: {
        error: "Unknown project",
        reason: "unknown_project",
        projectId: "missing-project",
      },
    });

    await expect(invoke(answer, {
      query: "x",
      filter: { projectId: "missing-project" },
    })).resolves.toMatchObject({ status: 404 });

    await expect(invoke(capture, {
      text: "x",
      filter: { target: "memory", projectId: "missing-project" },
    })).resolves.toMatchObject({ status: 404 });

    await expect(invoke(retract, {
      target: "memory",
      id: "mem-x",
      projectId: "missing-project",
    })).resolves.toMatchObject({ status: 404 });
  });

  it("KotaClient.forProject isolates every project-scoped namespace", async () => {
    const clientA = client.forProject(projectA.projectId);
    const clientB = client.forProject(projectB.projectId);

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

    const historyId = getProjectHistoryStore(projectA.projectDir).create(
      "test-model",
      projectA.projectDir,
    );
    getProjectHistoryStore(projectA.projectDir).save(
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
    const wrongProjectRetract = await clientB.retract.retract({
      target: "memory",
      id: retractTarget.id,
    });
    expect(wrongProjectRetract).toEqual({
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: retractTarget.id,
    });
    const rightProjectRetract = await clientA.retract.retract({
      target: "memory",
      id: retractTarget.id,
    });
    expect(rightProjectRetract).toEqual({
      ok: true,
      record: { target: "memory", recordId: retractTarget.id },
    });

    await expect(client.forProject("missing-project").memory.list()).rejects.toMatchObject({
      reason: "unknown_project",
      projectId: "missing-project",
    });
    await expect(client.forProject("missing-project").memory.list()).rejects.toBeInstanceOf(
      KotaClientProjectError,
    );
  });
});
