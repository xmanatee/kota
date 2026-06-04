/**
 * LocalKotaClient — the daemon-offline implementor of `KotaClient`.
 *
 * The selector constructs this client when no daemon is reachable. Each
 * namespace's local handler is a typed sub-implementation contributed by
 * the owning module's top-level `localClient(ctx)` factory. The selector
 * validates that every declared namespace has a registered handler and
 * throws loudly otherwise — there is no silent fallback to a partially-
 * wired client.
 *
 * The client itself is a thin pass-through; any policy (filtering,
 * formatting, ordering) belongs in the namespace handler the module
 * supplies.
 */
import {
  KOTA_CLIENT_NAMESPACES,
  type KotaClient,
  type KotaClientNamespace,
  type LocalClientHandlers,
} from "./kota-client.js";
import { createProjectScopedKotaClient } from "./project-scoped-kota-client.js";

/** Validate `handlers` covers every declared namespace, then assemble. */
export function buildLocalKotaClient(
  handlers: Partial<LocalClientHandlers>,
): LocalKotaClient {
  const missing: KotaClientNamespace[] = [];
  for (const name of KOTA_CLIENT_NAMESPACES) {
    if (!handlers[name]) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `LocalKotaClient is missing local handler(s) for: ${missing.join(", ")}. ` +
        `Each KotaClient namespace must be exposed by its owning module's ` +
        `top-level localClient(ctx) factory at module load time.`,
    );
  }
  return new LocalKotaClient(handlers as LocalClientHandlers);
}

export class LocalKotaClient implements KotaClient {
  readonly workflow: KotaClient["workflow"];
  readonly approvals: KotaClient["approvals"];
  readonly secrets: KotaClient["secrets"];
  readonly tasks: KotaClient["tasks"];
  readonly memory: KotaClient["memory"];
  readonly ownerQuestions: KotaClient["ownerQuestions"];
  readonly history: KotaClient["history"];
  readonly knowledge: KotaClient["knowledge"];
  readonly sessions: KotaClient["sessions"];
  readonly modules: KotaClient["modules"];
  readonly agents: KotaClient["agents"];
  readonly skills: KotaClient["skills"];
  readonly harnessParity: KotaClient["harnessParity"];
  readonly webhook: KotaClient["webhook"];
  readonly voice: KotaClient["voice"];
  readonly web: KotaClient["web"];
  readonly mcpServer: KotaClient["mcpServer"];
  readonly audit: KotaClient["audit"];
  readonly config: KotaClient["config"];
  readonly modulesAdmin: KotaClient["modulesAdmin"];
  readonly daemonOps: KotaClient["daemonOps"];
  readonly projects: KotaClient["projects"];
  readonly doctor: KotaClient["doctor"];
  readonly evalHarness: KotaClient["evalHarness"];
  readonly recall: KotaClient["recall"];
  readonly answer: KotaClient["answer"];
  readonly capture: KotaClient["capture"];
  readonly retract: KotaClient["retract"];
  readonly setup: KotaClient["setup"];

  forProject(projectId: string): KotaClient {
    return createProjectScopedKotaClient(this, projectId);
  }

  constructor(handlers: LocalClientHandlers) {
    this.workflow = handlers.workflow;
    this.approvals = handlers.approvals;
    this.secrets = handlers.secrets;
    this.tasks = handlers.tasks;
    this.memory = handlers.memory;
    this.ownerQuestions = handlers.ownerQuestions;
    this.history = handlers.history;
    this.knowledge = handlers.knowledge;
    this.sessions = handlers.sessions;
    this.modules = handlers.modules;
    this.agents = handlers.agents;
    this.skills = handlers.skills;
    this.harnessParity = handlers.harnessParity;
    this.webhook = handlers.webhook;
    this.voice = handlers.voice;
    this.web = handlers.web;
    this.mcpServer = handlers.mcpServer;
    this.audit = handlers.audit;
    this.config = handlers.config;
    this.modulesAdmin = handlers.modulesAdmin;
    this.daemonOps = handlers.daemonOps;
    this.projects = handlers.projects;
    this.doctor = handlers.doctor;
    this.evalHarness = handlers.evalHarness;
    this.recall = handlers.recall;
    this.answer = handlers.answer;
    this.capture = handlers.capture;
    this.retract = handlers.retract;
    this.setup = handlers.setup;
  }
}
