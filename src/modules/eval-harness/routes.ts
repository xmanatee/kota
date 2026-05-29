/**
 * HTTP route that operators use to invoke the eval harness via the daemon's
 * server surface. The route accepts a typed body, validates it, kicks off the
 * run via the subprocess executor, and emits the aggregate telemetry event
 * when the run completes.
 *
 * Wire shape: typed eval failures (`no_fixtures`, `fixture_provenance`)
 * collapse to `200 + EvalRunResult` discriminated body, matching the skills
 * migration precedent. The `400` status is reserved for genuine protocol
 * errors (malformed JSON, type mismatch in the request envelope).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute } from "node:path";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  EvalRunIsolationBackend,
  EvalRunOptions,
  EvalRunResult,
} from "./client.js";
import { runEvalHarness } from "./eval-operations.js";
import { evalHarnessSetCompleted } from "./events.js";
import {
  type ContainerNetworkPolicyRequest,
  type ProviderEgressProvider,
  validateProviderEgressProxyUrl,
} from "./provider-egress.js";

type IsolationBackendRequest = {
  kind?: string;
  executable?: string;
  image?: string;
  kotaBinaryPath?: string;
  networkPolicy?: object;
};

type NetworkPolicyRequest = {
  kind?: string;
  provider?: string;
  enforcement?: {
    kind?: string;
    networkName?: string;
    proxyUrl?: string;
  };
};

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((s, c) => s + c.length, 0) > 64 * 1024) {
      throw new Error("Request body too large for eval run (>64KB).");
    }
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) return {};
  return JSON.parse(text);
}

function validateRequest(raw: unknown): EvalRunOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Body must be a JSON object.");
  }
  const r = raw as Record<string, unknown>;
  const out: EvalRunOptions = {};
  if (r.fixtureIds !== undefined) {
    if (
      !Array.isArray(r.fixtureIds) ||
      !r.fixtureIds.every((id) => typeof id === "string")
    ) {
      throw new Error("fixtureIds must be an array of strings.");
    }
    out.fixtureIds = r.fixtureIds as string[];
  }
  const numericKeys: Array<keyof EvalRunOptions> = [
    "repeatCount",
    "cpuAllocationCores",
    "cpuKillThresholdCores",
    "memoryAllocationMB",
    "memoryKillThresholdMB",
  ];
  for (const key of numericKeys) {
    if (r[key] !== undefined) {
      const v = r[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        throw new Error(`${String(key)} must be a positive number.`);
      }
      (out as Record<string, unknown>)[key] = v;
    }
  }
  if (r.hostClass !== undefined) {
    if (typeof r.hostClass !== "string" || r.hostClass.length === 0) {
      throw new Error("hostClass must be a non-empty string.");
    }
    out.hostClass = r.hostClass;
  }
  if (r.keepWorkingDirs !== undefined) {
    if (typeof r.keepWorkingDirs !== "boolean") {
      throw new Error("keepWorkingDirs must be a boolean.");
    }
    out.keepWorkingDirs = r.keepWorkingDirs;
  }
  if (r.isolationBackend !== undefined) {
    const rawBackend = r.isolationBackend;
    if (
      typeof rawBackend !== "object" ||
      rawBackend === null ||
      Array.isArray(rawBackend)
    ) {
      throw new Error("isolationBackend must be an object.");
    }
    out.isolationBackend = validateIsolationBackend(rawBackend);
  }
  return out;
}

function validateIsolationBackend(raw: object): EvalRunIsolationBackend {
  const r = raw as IsolationBackendRequest;
  if (r.kind === "host-subprocess") {
    return { kind: "host-subprocess" };
  }
  if (r.kind !== "container") {
    throw new Error(
      "isolationBackend.kind must be \"host-subprocess\" or \"container\".",
    );
  }
  if (typeof r.executable !== "string" || r.executable.length === 0) {
    throw new Error("isolationBackend.executable must be a non-empty string.");
  }
  if (typeof r.image !== "string" || r.image.length === 0) {
    throw new Error("isolationBackend.image must be a non-empty string.");
  }
  if (
    typeof r.kotaBinaryPath !== "string" ||
    r.kotaBinaryPath.length === 0
  ) {
    throw new Error(
      "isolationBackend.kotaBinaryPath must be a non-empty string.",
    );
  }
  if (!isAbsolute(r.kotaBinaryPath)) {
    throw new Error(
      "isolationBackend.kotaBinaryPath must be an absolute container path.",
    );
  }
  return {
    kind: "container",
    executable: r.executable,
    image: r.image,
    kotaBinaryPath: r.kotaBinaryPath,
    networkPolicy: validateNetworkPolicy(r.networkPolicy),
  };
}

function validateProvider(raw: string): ProviderEgressProvider {
  if (raw === "anthropic" || raw === "openai" || raw === "google") {
    return raw;
  }
  throw new Error(
    "isolationBackend.networkPolicy.provider must be anthropic, openai, or google.",
  );
}

function validateNetworkPolicy(raw: object | undefined): ContainerNetworkPolicyRequest {
  if (raw === undefined) return { kind: "offline" };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("isolationBackend.networkPolicy must be an object.");
  }
  const r = raw as NetworkPolicyRequest;
  if (r.kind === "offline") {
    return { kind: "offline" };
  }
  if (r.kind !== "provider-egress") {
    throw new Error(
      'isolationBackend.networkPolicy.kind must be "offline" or "provider-egress".',
    );
  }
  if (typeof r.provider !== "string" || r.provider.length === 0) {
    throw new Error(
      "isolationBackend.networkPolicy.provider must be a non-empty string.",
    );
  }
  if (
    typeof r.enforcement !== "object" ||
    r.enforcement === null ||
    Array.isArray(r.enforcement)
  ) {
    throw new Error("isolationBackend.networkPolicy.enforcement must be an object.");
  }
  if (r.enforcement.kind !== "docker-internal-proxy") {
    throw new Error(
      'isolationBackend.networkPolicy.enforcement.kind must be "docker-internal-proxy".',
    );
  }
  if (
    typeof r.enforcement.networkName !== "string" ||
    r.enforcement.networkName.length === 0
  ) {
    throw new Error(
      "isolationBackend.networkPolicy.enforcement.networkName must be a non-empty string.",
    );
  }
  if (
    typeof r.enforcement.proxyUrl !== "string" ||
    r.enforcement.proxyUrl.length === 0
  ) {
    throw new Error(
      "isolationBackend.networkPolicy.enforcement.proxyUrl must be a non-empty string.",
    );
  }
  validateProviderEgressProxyUrl(r.enforcement.proxyUrl);
  return {
    kind: "provider-egress",
    provider: validateProvider(r.provider),
    enforcement: {
      kind: "docker-internal-proxy",
      networkName: r.enforcement.networkName,
      proxyUrl: r.enforcement.proxyUrl,
    },
  };
}

/**
 * Build the route registration for the eval-harness module. Called from
 * `index.ts` via `routes: (ctx) => evalHarnessRoutes(ctx)`.
 */
export function evalHarnessRoutes(ctx: ModuleContext) {
  return [
    {
      method: "POST" as const,
      path: "/api/eval/run",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          writeJson(res, 400, { error: (err as Error).message });
          return;
        }
        let options: EvalRunOptions;
        try {
          options = validateRequest(body);
        } catch (err) {
          writeJson(res, 400, { error: (err as Error).message });
          return;
        }
        const bus = new EventBus();
        bus.on(evalHarnessSetCompleted, (payload) => {
          ctx.events.emit(evalHarnessSetCompleted, payload);
        });
        let result: EvalRunResult;
        try {
          result = await runEvalHarness(ctx.cwd, options, bus);
        } catch (err) {
          writeJson(res, 500, { error: (err as Error).message });
          return;
        }
        writeJson(res, 200, result);
      },
    },
  ];
}
