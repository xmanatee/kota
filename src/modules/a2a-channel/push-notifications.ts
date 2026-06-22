import { randomUUID } from "node:crypto";
import type { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleLogger } from "#core/modules/module-types.js";
import { postWithRetry } from "#modules/notification/index.js";
import type { A2ABackend } from "./daemon-session-client.js";
import {
  A2AProtocolError,
  type A2ATask,
  type A2ATaskUpdate,
  invalidParams,
  type TaskSelector,
} from "./protocol.js";
import {
  buildPushDeliveryHeaders,
  type PushDeliveryPayload,
  pushDeliveryPayload,
  pushDeliveryScope,
  redactedCallbackUrl,
} from "./push-notification-delivery.js";
import type {
  A2ATaskPushNotificationConfig,
  PushNotificationConfigInput,
  PushNotificationConfigListFilter,
  PushNotificationConfigListResponse,
  PushNotificationConfigSelector,
} from "./push-notification-protocol.js";
import {
  DEFAULT_PUSH_NOTIFICATION_PAGE_SIZE,
  MAX_PUSH_NOTIFICATION_PAGE_SIZE,
  projectIdFromTaskMetadata,
  pushConfigMatchesFilter,
  pushConfigMatchesSelector,
  pushNotificationPageStart,
  pushSubscriptionKey,
  readStoredPushNotificationConfigs,
  redactPushNotificationConfig,
  type StoredPushNotificationConfig,
  writeStoredPushNotificationConfigs,
} from "./push-notification-storage.js";

type ManagedTaskSubscription = {
  controller: AbortController;
};

type PushTaskSubscriptionSelector = TaskSelector & {
  contextId: string;
};

export type StoredTaskSubscriptionStatus =
  | "empty"
  | "backend-unavailable"
  | "started";

export class A2APushNotificationManager {
  private readonly subscriptions = new Map<string, ManagedTaskSubscription>();
  private storedSubscriptionRetry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: ModuleStorage,
    private readonly log: ModuleLogger,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  create(input: PushNotificationConfigInput, task: A2ATask): A2ATaskPushNotificationConfig {
    const id = input.id ?? randomUUID();
    const existingConflict = this.readAll().find((config) =>
      config.id === id && config.taskId !== input.taskId
    );
    if (existingConflict) {
      throw invalidParams("id must be unique within A2A push notification configs");
    }

    const stored: StoredPushNotificationConfig = {
      id,
      taskId: input.taskId,
      contextId: task.contextId,
      projectId: input.projectId ?? projectIdFromTaskMetadata(task.metadata),
      url: input.url,
      token: input.token,
      authentication: input.authentication,
      createdAt: this.now(),
    };
    const next = this.readAll().filter((config) =>
      !(config.taskId === stored.taskId && config.id === stored.id)
    );
    next.push(stored);
    this.writeAll(next);
    return redactPushNotificationConfig(stored);
  }

  ensureTaskSubscription(backend: A2ABackend, task: A2ATask): void {
    this.ensureSubscription(backend, {
      taskId: task.id,
      contextId: task.contextId,
      projectId: projectIdFromTaskMetadata(task.metadata),
    });
  }

  ensureStoredTaskSubscriptions(
    backendFactory: () => A2ABackend | null,
  ): StoredTaskSubscriptionStatus {
    const selectors = this.storedTaskSelectors();
    if (selectors.length === 0) return "empty";

    const backend = backendFactory();
    if (!backend) return "backend-unavailable";

    for (const selector of selectors) {
      this.ensureSubscription(backend, selector);
    }
    return "started";
  }

  startStoredTaskSubscriptions(
    backendFactory: () => A2ABackend | null,
    options: { retryDelayMs?: number } = {},
  ): void {
    const retryDelayMs = options.retryDelayMs ?? 1_000;
    this.clearStoredSubscriptionRetry();

    const attempt = (): void => {
      const status = this.ensureStoredTaskSubscriptions(backendFactory);
      if (status !== "backend-unavailable") {
        this.storedSubscriptionRetry = null;
        return;
      }

      this.storedSubscriptionRetry = setTimeout(attempt, retryDelayMs);
      this.storedSubscriptionRetry.unref?.();
    };

    attempt();
  }

  stop(): void {
    this.clearStoredSubscriptionRetry();
    for (const subscription of this.subscriptions.values()) {
      subscription.controller.abort();
    }
    this.subscriptions.clear();
  }

  get(selector: PushNotificationConfigSelector): A2ATaskPushNotificationConfig | null {
    const config = this.readAll().find((entry) => pushConfigMatchesSelector(entry, selector));
    return config ? redactPushNotificationConfig(config) : null;
  }

  list(filter: PushNotificationConfigListFilter): PushNotificationConfigListResponse {
    const configs = this.readAll()
      .filter((entry) => pushConfigMatchesFilter(entry, filter))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const pageSize = Math.min(
      filter.pageSize ?? DEFAULT_PUSH_NOTIFICATION_PAGE_SIZE,
      MAX_PUSH_NOTIFICATION_PAGE_SIZE,
    );
    const start = pushNotificationPageStart(filter.pageToken);
    const selected = configs.slice(start, start + pageSize);
    const nextIndex = start + selected.length;
    return {
      configs: selected.map(redactPushNotificationConfig),
      nextPageToken: nextIndex < configs.length ? String(nextIndex) : "",
    };
  }

  delete(selector: PushNotificationConfigSelector): void {
    const configs = this.readAll();
    const next = configs.filter((entry) => !pushConfigMatchesSelector(entry, selector));
    if (next.length !== configs.length) {
      this.writeAll(next);
      this.pruneSubscriptions(next);
    }
  }

  removeTaskScope(selector: TaskSelector): void {
    const configs = this.readAll();
    const next = configs.filter((entry) => !configMatchesTaskScope(entry, selector));
    if (next.length !== configs.length) {
      this.writeAll(next);
      this.pruneSubscriptions(next);
    }
  }

  async dispatch(update: A2ATaskUpdate): Promise<void> {
    const payload = pushDeliveryPayload(update);
    if (!payload) return;
    const updateScope = pushDeliveryScope(payload);
    if (!updateScope) return;
    const configs = this.readAll().filter((config) =>
      config.taskId === updateScope.taskId && config.contextId === updateScope.contextId
    );
    await Promise.all(configs.map((config) => this.deliver(config, payload)));
  }

  private async deliver(
    config: StoredPushNotificationConfig,
    update: PushDeliveryPayload,
  ): Promise<void> {
    await postWithRetry(
      config.url,
      JSON.stringify(update),
      this.log,
      {
        retries: 2,
        baseDelayMs: 500,
        headers: buildPushDeliveryHeaders(config),
        logUrl: redactedCallbackUrl(config.url),
        fetchImpl: this.fetchImpl,
      },
    );
  }

  private ensureSubscription(backend: A2ABackend, selector: PushTaskSubscriptionSelector): void {
    const key = pushSubscriptionKey(selector.taskId, selector.contextId);
    if (this.subscriptions.has(key)) return;

    const controller = new AbortController();
    this.subscriptions.set(key, { controller });

    void backend.subscribeToTask(
      selector,
      {
        signal: controller.signal,
        onUpdate: (update) => {
          void this.dispatch(update);
        },
      },
    ).catch((err) => {
      if (controller.signal.aborted) return;
      if (err instanceof A2AProtocolError && err.rpcCode === -32001) {
        this.removeTaskScope(selector);
        return;
      }
      if (err instanceof A2AProtocolError && err.rpcCode === -32004) return;
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`A2A push task subscription failed for ${selector.taskId}: ${message}`);
    }).finally(() => {
      const current = this.subscriptions.get(key);
      if (current?.controller === controller) this.subscriptions.delete(key);
    });
  }

  private pruneSubscriptions(configs: StoredPushNotificationConfig[]): void {
    const configuredKeys = new Set(configs.map((config) =>
      pushSubscriptionKey(config.taskId, config.contextId)
    ));
    for (const [key, subscription] of this.subscriptions) {
      if (configuredKeys.has(key)) continue;
      subscription.controller.abort();
      this.subscriptions.delete(key);
    }
  }

  private storedTaskSelectors(): PushTaskSubscriptionSelector[] {
    const selectors = new Map<string, PushTaskSubscriptionSelector>();
    for (const config of this.readAll()) {
      const key = pushSubscriptionKey(config.taskId, config.contextId);
      if (selectors.has(key)) continue;
      selectors.set(key, {
        taskId: config.taskId,
        contextId: config.contextId,
        projectId: config.projectId,
      });
    }
    return [...selectors.values()];
  }

  private clearStoredSubscriptionRetry(): void {
    if (this.storedSubscriptionRetry === null) return;
    clearTimeout(this.storedSubscriptionRetry);
    this.storedSubscriptionRetry = null;
  }

  private readAll(): StoredPushNotificationConfig[] {
    return readStoredPushNotificationConfigs(this.storage);
  }

  private writeAll(configs: StoredPushNotificationConfig[]): void {
    writeStoredPushNotificationConfigs(this.storage, configs);
  }
}

function configMatchesTaskScope(
  config: StoredPushNotificationConfig,
  selector: TaskSelector,
): boolean {
  if (config.taskId !== selector.taskId) return false;
  if (selector.projectId !== null && config.projectId !== selector.projectId) return false;
  if (selector.contextId !== null && config.contextId !== selector.contextId) return false;
  return true;
}
