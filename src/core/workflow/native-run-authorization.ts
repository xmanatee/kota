import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { nativeToolExecutor } from "#core/tools/native-tool-execution.js";
import { nativeToolRequests, requestNativeTool } from "./native-tool-transport.js";
import { allocationName, canonicalRepositoryRoot } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";

const IDENTITY_KEYS = ["KOTA_RUN_ID", "KOTA_RUN_ATTEMPT", "KOTA_DAEMON_EPOCH"] as const;
const DENIED = "Native writer authorization denied or unavailable";

type NativeRunIdentity = Readonly<{
  runId: string;
  attempt: number;
  epoch: number;
  workspaceDir: string;
  rootDir: string;
}>;

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function runIdentity(workspace: string, env: NodeJS.ProcessEnv): NativeRunIdentity | null {
  const values = IDENTITY_KEYS.map((key) => env[key]?.trim());
  if (values.every((value) => !value)) return null;
  const [runId, attemptText, epochText] = values;
  if (!runId || !attemptText || !epochText ||
    !/^[1-9]\d*$/.test(attemptText) || !/^[1-9]\d*$/.test(epochText) ||
    !Number.isSafeInteger(Number(attemptText)) || !Number.isSafeInteger(Number(epochText))) {
    throw new Error("Native run repository access requires a complete run identity");
  }
  const workspaceDir = realpathSync(workspace);
  const rootDir = join(canonicalRepositoryRoot(workspaceDir), ".kota", "runtime", allocationName(runId));
  if (realpathSync(join(rootDir, "..", "worktrees", allocationName(runId))) !== workspaceDir) {
    throw new Error("Native run repository access requires the reconciled writer workspace");
  }
  return { runId, attempt: Number(attemptText), epoch: Number(epochText), workspaceDir, rootDir };
}

function fingerprint(identity: NativeRunIdentity): string {
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

/**
 * Offline request/reply boundary. Writer challenges receive a boolean reply.
 * Opted-in tools decode bounded request contents and use the hosting invocation
 * authority; responses and artifacts remain runtime-owned and worker-read-only.
 */
export function startNativeRunAuthorization(
  workspace: string,
  env: NodeJS.ProcessEnv,
  mutableRoots: readonly string[],
): {
  env: NodeJS.ProcessEnv;
  readableRoots: string[];
  writableRoots: string[];
  writeProtectedRoots: string[];
  close(): Promise<void>;
} | undefined {
  const identity = runIdentity(workspace, env);
  if (identity === null) {
    if (env.KOTA_RUN_STATE_DIR || env.KOTA_RUN_AUTHORIZATION) throw new Error(DENIED);
    return undefined;
  }
  if (!env.KOTA_RUN_STATE_DIR) throw new Error(DENIED);
  const stateDir = realpathSync(env.KOTA_RUN_STATE_DIR);
  if (isWithin(identity.rootDir, stateDir)) {
    throw new Error("Native run state database must be outside the run sandbox");
  }
  const serviceParent = join(identity.rootDir, "native-authorizations");
  for (const root of [identity.workspaceDir, ...mutableRoots]) {
    for (const protectedRoot of [stateDir, serviceParent, join(identity.rootDir, "native-tool-artifacts")]) {
      if (isWithin(realpathSync(root), protectedRoot)) {
        throw new Error("Native run authority must be outside sandbox mutable roots");
      }
    }
  }
  const store = RunStateDatabase.openReadOnly(stateDir);
  const requireActiveWriter = () => {
    const sandbox = store.requireActiveRunSandbox(identity);
    if (sandbox.repository !== "write" || realpathSync(sandbox.workspaceDir) !== identity.workspaceDir) {
      throw new Error(DENIED);
    }
  };
  let serviceRoot: string | undefined;
  try {
    requireActiveWriter();
    mkdirSync(serviceParent, { recursive: true });
    if (realpathSync(serviceParent) !== serviceParent) throw new Error(DENIED);
    const invocation = randomBytes(16).toString("hex");
    serviceRoot = join(serviceParent, invocation);
    mkdirSync(serviceRoot);
    const requests = join(serviceRoot, "requests");
    const responses = join(serviceRoot, "responses");
    mkdirSync(requests);
    mkdirSync(responses);
    writeFileSync(join(responses, "tool-protocol"), "1", { flag: "wx" });
    const artifactParent = join(identity.rootDir, "native-tool-artifacts");
    mkdirSync(artifactParent, { recursive: true });
    if (realpathSync(artifactParent) !== artifactParent) throw new Error(DENIED);
    const artifactRoot = join(artifactParent, invocation);
    mkdirSync(artifactRoot);
    const toolRequests = nativeToolRequests(requests, responses, requireActiveWriter, nativeToolExecutor(artifactRoot, { runId: identity.runId, workspaceDir: identity.workspaceDir, scopeRoot: canonicalRepositoryRoot(workspace) }));
    const expectedFingerprint = fingerprint(identity);
    const answered = new Set<string>();
    const timer = setInterval(() => {
      try {
        const pending = new Set(readdirSync(requests));
        toolRequests.poll(pending);
        for (const name of answered) {
          if (!pending.has(name)) {
            rmSync(join(responses, name), { force: true });
            answered.delete(name);
          }
        }
        for (const name of pending) {
          if (!/^[a-f0-9]{64}-[a-f0-9]{32}$/.test(name) || answered.has(name)) continue;
          let allowed = false;
          try {
            if (name.startsWith(`${expectedFingerprint}-`)) {
              requireActiveWriter();
              allowed = true;
            }
          } catch { /* Revoked attempts return only denial, never database diagnostics. */ }
          writeFileSync(join(responses, name), allowed ? "true" : "false", { flag: "wx" });
          answered.add(name);
        }
      } catch { /* Missing or tampered requests fail closed at the caller's deadline. */ }
    }, 20);
    timer.unref();
    return {
      env: { KOTA_RUN_AUTHORIZATION: invocation },
      readableRoots: [responses, requests, artifactRoot],
      writableRoots: [requests],
      writeProtectedRoots: [responses, artifactRoot],
      async close() {
        clearInterval(timer);
        try { await toolRequests.close(); }
        finally {
          store.close();
          rmSync(serviceRoot!, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    store.close();
    if (serviceRoot !== undefined) rmSync(serviceRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Revalidates on every mutation; no cached approval survives attempt revocation. */
export function nativeRunWriterAuthorization(
  workspace: string,
  env: NodeJS.ProcessEnv,
): (() => string) | null {
  const identity = runIdentity(workspace, env);
  if (identity === null) {
    if (env.KOTA_RUN_STATE_DIR || env.KOTA_RUN_AUTHORIZATION) throw new Error(DENIED);
    return null;
  }
  const invocation = env.KOTA_RUN_AUTHORIZATION;
  if (!invocation || !/^[a-f0-9]{32}$/.test(invocation)) throw new Error(DENIED);
  const serviceRoot = join(identity.rootDir, "native-authorizations", invocation);
  const requests = join(serviceRoot, "requests");
  const responses = join(serviceRoot, "responses");
  for (const path of [requests, responses]) {
    if (realpathSync(path) !== path) throw new Error(DENIED);
  }
  const requestFingerprint = fingerprint(identity);
  return () => {
    const name = `${requestFingerprint}-${randomBytes(16).toString("hex")}`;
    const request = join(requests, name);
    const response = join(responses, name);
    writeFileSync(request, "", { flag: "wx" });
    try {
      const deadline = performance.now() + 5_000;
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (performance.now() < deadline) {
        if (existsSync(response)) {
          const result = readFileSync(response, "utf8");
          if (result === "true") return identity.workspaceDir;
          if (result !== "") throw new Error(DENIED);
        }
        Atomics.wait(sleeper, 0, 0, 20);
      }
      throw new Error(DENIED);
    } finally {
      rmSync(request, { force: true });
    }
  };
}

/** Native clients inherit only their invocation locator, never daemon credentials. */
export async function invokeNativeRunTool(
  workspace: string, name: string, input: Record<string, unknown>, signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
) {
  const identity = runIdentity(workspace, env);
  const invocation = env.KOTA_RUN_AUTHORIZATION;
  if (!identity || !invocation || !/^[a-f0-9]{32}$/.test(invocation)) throw new Error(DENIED);
  const serviceRoot = join(identity.rootDir, "native-authorizations", invocation);
  if (realpathSync(serviceRoot) !== serviceRoot) throw new Error(DENIED);
  return requestNativeTool(serviceRoot, name, input, signal);
}
