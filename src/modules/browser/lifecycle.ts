import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  registerSessionEnvironmentResource,
  sessionEnvironmentVersionForExecution,
} from "#core/tools/session-environment.js";
import {
  closeBrowserProcess,
  ensureBrowserProcess,
} from "./browser-process.js";
import {
  type BrowserProfileOptions,
  type BrowserProfileOwner,
  resolveBrowserProfileStoragePath,
  snapshotConfiguredBrowserProfile,
} from "./browser-profile.js";
import {
  type BrowserSessionIdentity,
  resolveBrowserSessionIdentity,
} from "./browser-session-identity.js";
import type {
  PlaywrightContext,
  PlaywrightPage,
} from "./playwright-loader.js";

export type {
  BrowserProfileOptions,
  BrowserProfileOwner,
} from "./browser-profile.js";
export {
  configureBrowserProfile,
  getConfiguredBrowserProfile,
} from "./browser-profile.js";
export { isPlaywrightAvailable } from "./playwright-availability.js";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

type BrowserSessionResource = {
  identity: BrowserSessionIdentity;
  profile: BrowserProfileOptions;
  profileOwner: BrowserProfileOwner | null;
  context: PlaywrightContext | null;
  page: PlaywrightPage | null;
  pagePromise: Promise<PlaywrightPage> | null;
  initializing: Promise<void>;
  closing: Promise<void> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  detachSessionCleanup: () => void;
  closed: boolean;
};

const resourcesByScope = new Map<string, Map<string, BrowserSessionResource>>();

function resourceForIdentity(
  identity: BrowserSessionIdentity,
): BrowserSessionResource | undefined {
  return resourcesByScope.get(identity.scopeId)?.get(identity.sessionId);
}

function storeResource(resource: BrowserSessionResource): void {
  let sessions = resourcesByScope.get(resource.identity.scopeId);
  if (!sessions) {
    sessions = new Map();
    resourcesByScope.set(resource.identity.scopeId, sessions);
  }
  sessions.set(resource.identity.sessionId, resource);
}

function removeResource(resource: BrowserSessionResource): void {
  const sessions = resourcesByScope.get(resource.identity.scopeId);
  if (sessions?.get(resource.identity.sessionId) !== resource) return;
  sessions.delete(resource.identity.sessionId);
  if (sessions.size === 0) resourcesByScope.delete(resource.identity.scopeId);
}

function allResources(): BrowserSessionResource[] {
  return [...resourcesByScope.values()].flatMap((sessions) => [
    ...sessions.values(),
  ]);
}

function resolveStoragePath(resource: BrowserSessionResource): string | null {
  return resolveBrowserProfileStoragePath(resource, resource.identity);
}

async function initializeResource(
  resource: BrowserSessionResource,
): Promise<void> {
  const activeBrowser = await ensureBrowserProcess(resource.profile);
  const storagePath = resolveStoragePath(resource);
  const options: { storageState?: string } = {};
  if (storagePath && existsSync(storagePath)) {
    options.storageState = storagePath;
  }
  const createdContext = await activeBrowser.newContext(options);
  if (resource.closed) {
    await createdContext.close().catch(() => {});
    return;
  }
  resource.context = createdContext;
}

function createResource(
  identity: BrowserSessionIdentity,
  runnerContext: ToolRunnerContext,
): BrowserSessionResource {
  const configuredProfile = snapshotConfiguredBrowserProfile();
  const resource: BrowserSessionResource = {
    identity,
    ...configuredProfile,
    context: null,
    page: null,
    pagePromise: null,
    initializing: Promise.resolve(),
    closing: null,
    idleTimer: null,
    detachSessionCleanup: () => {},
    closed: false,
  };
  storeResource(resource);
  resource.detachSessionCleanup = registerSessionEnvironmentResource(
    runnerContext,
    () => {
      void closeSessionResource(resource).catch(() => {});
    },
  );
  resource.initializing = initializeResource(resource).catch(async (error) => {
    resource.closed = true;
    resource.detachSessionCleanup();
    removeResource(resource);
    await closeSharedBrowserIfUnused();
    throw error;
  });
  return resource;
}

async function ensureResource(
  context: ToolRunnerContext | undefined,
): Promise<BrowserSessionResource> {
  const identity = resolveBrowserSessionIdentity(context);
  if (sessionEnvironmentVersionForExecution(context) === null) {
    throw new Error("Browser tools require a live session");
  }
  const existing = resourceForIdentity(identity);
  if (existing) {
    if (existing.identity.scopeRoot !== identity.scopeRoot) {
      throw new Error(
        "Browser session scope was invoked with a different scope directory",
      );
    }
    await existing.initializing;
    if (existing.closed) throw new Error("Browser session is closing");
    return existing;
  }

  const created = createResource(identity, context as ToolRunnerContext);
  await created.initializing;
  if (created.closed) throw new Error("Browser session closed during startup");
  return created;
}

function resetIdleTimer(resource: BrowserSessionResource): void {
  if (resource.idleTimer) clearTimeout(resource.idleTimer);
  resource.idleTimer = setTimeout(() => {
    void closeSessionResource(resource).catch(() => {});
  }, IDLE_TIMEOUT_MS);
}

async function pageForResource(
  resource: BrowserSessionResource,
): Promise<PlaywrightPage> {
  if (resource.page && !resource.page.isClosed()) return resource.page;
  if (resource.pagePromise) return resource.pagePromise;
  if (!resource.context) throw new Error("Browser context did not initialize");

  resource.pagePromise = (async () => {
    const createdPage = await resource.context!.newPage();
    if (resource.closed) {
      await createdPage.close().catch(() => {});
      throw new Error("Browser session closed during page startup");
    }
    resource.page = createdPage;
    return createdPage;
  })();
  try {
    return await resource.pagePromise;
  } finally {
    resource.pagePromise = null;
  }
}

export async function getPage(
  context?: ToolRunnerContext,
): Promise<PlaywrightPage> {
  const resource = await ensureResource(context);
  const activePage = await pageForResource(resource);
  resetIdleTimer(resource);
  return activePage;
}

async function persistResource(resource: BrowserSessionResource): Promise<void> {
  if (!resource.profile.persist || !resource.profile.storageStatePath) return;
  if (!resource.context) return;
  const resolved = resolveStoragePath(resource);
  if (!resolved) return;
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    throw new Error(
      `Cannot persist browser profile: directory does not exist: ${dir}. ` +
        "Create it explicitly or point storageStatePath at an existing location.",
    );
  }
  await resource.context.storageState({ path: resolved });
}

/** Persist only the authenticated context owned by the invoking session. */
export async function persistBrowserProfile(
  context: ToolRunnerContext,
): Promise<void> {
  const identity = resolveBrowserSessionIdentity(context);
  const resource = resourceForIdentity(identity);
  if (!resource) return;
  if (resource.identity.scopeRoot !== identity.scopeRoot) {
    throw new Error(
      "Browser session scope was invoked with a different scope directory",
    );
  }
  await resource.initializing;
  await persistResource(resource);
}

async function closeSharedBrowserIfUnused(): Promise<void> {
  if (resourcesByScope.size > 0) return;
  await closeBrowserProcess();
}

async function closeSessionResource(
  resource: BrowserSessionResource,
): Promise<void> {
  if (resource.closing) return resource.closing;
  resource.closed = true;
  if (resource.idleTimer) {
    clearTimeout(resource.idleTimer);
    resource.idleTimer = null;
  }
  resource.detachSessionCleanup();
  removeResource(resource);

  resource.closing = (async () => {
    await resource.initializing.catch(() => {});
    await persistResource(resource).catch(() => {});
    if (resource.page && !resource.page.isClosed()) {
      await resource.page.close().catch(() => {});
    }
    resource.page = null;
    if (resource.context) {
      await resource.context.close().catch(() => {});
    }
    resource.context = null;
    await closeSharedBrowserIfUnused();
  })();
  return resource.closing;
}

/** Close only the browser state owned by the invoking session and scope. */
export async function closeBrowserSession(
  context?: ToolRunnerContext,
): Promise<void> {
  const identity = resolveBrowserSessionIdentity(context);
  const resource = resourceForIdentity(identity);
  if (!resource) return;
  if (resource.identity.scopeRoot !== identity.scopeRoot) {
    throw new Error(
      "Browser session scope was invoked with a different scope directory",
    );
  }
  await closeSessionResource(resource);
}

/** Module lifecycle cleanup: close every remaining session resource. */
export async function closeBrowser(): Promise<void> {
  await Promise.all(allResources().map((resource) => closeSessionResource(resource)));
  await closeSharedBrowserIfUnused();
}
