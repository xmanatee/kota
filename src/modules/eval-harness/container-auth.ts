import { closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { type AgentHarness, ContainerAuthUnavailableError } from "#core/agent-harness/harness-definition.js";
import { registerOwnedProcessResource } from "#core/execution/owned-process-resources.js";
import type { SubprocessExecutorOptions } from "./subprocess-executor-types.js";

type ContainerAuth = NonNullable<SubprocessExecutorOptions["containerAuth"]>;

/** Resolve the adapter contract once on the trusted host. Only explicit
 * unavailability may remove a route from execution; malformed credentials fail. */
export function resolveAdapterContainerAuth(harness: AgentHarness, env: NodeJS.ProcessEnv): ContainerAuth | undefined {
  if (harness.modelRouting?.kind !== "native") return undefined;
  if (!harness.resolveIsolatedContainerAuth) {
    throw new ContainerAuthUnavailableError(`Harness ${harness.name} has no contained native authentication contract`);
  }
  const auth = harness.resolveIsolatedContainerAuth(env);
  const issue = containerAuthIssue(auth);
  if (issue !== null) throw new ContainerAuthUnavailableError(issue);
  return auth;
}

function openLogin(auth: ContainerAuth, workingDir?: string): number {
  if (!isAbsolute(auth.sourceFile) || !/^\/run\/[a-zA-Z0-9_-]+$/.test(auth.containerDirectory) ||
    !/^[a-zA-Z0-9_.-]+$/.test(auth.fileName) || auth.fileName === "." || auth.fileName === ".." ||
    !/^[A-Z_][A-Z0-9_]*$/.test(auth.locatorEnvKey)) {
    throw new Error("Invalid adapter container login locator.");
  }
  const source = realpathSync(auth.sourceFile);
  if (workingDir !== undefined) {
    const child = relative(realpathSync(workingDir), source);
    if (child === "" || (!child.startsWith("../") && !isAbsolute(child))) {
      throw new Error("Container login must be owned outside the candidate workspace.");
    }
  }
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024) {
    closeSync(fd);
    throw new Error("Container login must be a nonempty regular credential file.");
  }
  return fd;
}

export function containerAuthIssue(auth: ContainerAuth): string | null {
  try {
    closeSync(openLogin(auth));
    return null;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) ||
      !["ENOENT", "EACCES", "EPERM"].includes(String(error.code))) throw error;
    return "Adapter-owned container login is unavailable or unreadable in this execution context; no credential or entitlement absence is inferred.";
  }
}

/** Only the adapter's single login file crosses this boundary. No host home,
 * config, sessions, or original writable credential is mounted into the image. */
export function snapshotContainerAuth(auth: ContainerAuth, workingDir: string): {
  mount: string;
  env: Record<string, string>;
  cleanup(): void;
} {
  const fd = openLogin(auth, workingDir);
  let directory: string;
  try { directory = mkdtempSync(join(tmpdir(), "kota-eval-login-")); }
  catch (error) { closeSync(fd); throw error; }
  try {
    registerOwnedProcessResource({ kind: "directory", path: directory });
    writeFileSync(join(directory, auth.fileName), readFileSync(fd), { mode: 0o600, flag: "wx" });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    closeSync(fd);
  }
  return {
    mount: `type=bind,source=${directory},target=${auth.containerDirectory},readonly`,
    env: { [auth.locatorEnvKey]: auth.containerDirectory },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
