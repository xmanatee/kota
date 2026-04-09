/**
 * ExtensionTestHarness — lightweight in-process harness for testing KotaExtension
 * definitions without a running daemon, real config, or network.
 *
 * Mirrors the design of WorkflowTestHarness for consistency. Load one or more
 * extensions, call their onLoad, exercise tools and routes, then teardown.
 *
 * Usage:
 *   const harness = await ExtensionTestHarness.create(myExtension);
 *   const result = await harness.callTool("my_tool", { action: "list" });
 *   expect(result.is_error).toBeUndefined();
 *   await harness.teardown();
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { ExtensionStorage } from "../extension-storage.js";
import type {
  ExtensionContext,
  KotaExtension,
  RouteRegistration,
  ToolDef,
} from "../extension-types.js";
import type { ToolResult } from "../tools/tool-result.js";

export type ExtensionHarnessOptions = {
  /** Working directory passed to ctx.cwd. Defaults to process.cwd(). */
  cwd?: string;
  /** Config object passed to ctx.config. Defaults to {}. */
  config?: Record<string, unknown>;
  /** Named secrets available via ctx.getSecret(). */
  secrets?: Record<string, string>;
};

export class ExtensionTestHarness {
  readonly #extensions: KotaExtension[];
  readonly #options: ExtensionHarnessOptions;
  readonly #tools = new Map<string, ToolDef>();
  #routes: RouteRegistration[] = [];
  readonly #dynamicStateProviders = new Map<string, () => string>();
  readonly #eventHandlers = new Map<
    string,
    Array<(payload: Record<string, unknown>) => void>
  >();
  readonly #providers = new Map<string, unknown>();
  readonly #tempDir: string;
  #loaded = false;

  constructor(
    extensions: KotaExtension | KotaExtension[],
    options: ExtensionHarnessOptions = {},
  ) {
    this.#extensions = Array.isArray(extensions) ? extensions : [extensions];
    this.#options = options;
    this.#tempDir = mkdtempSync(`${tmpdir()}/kota-ext-harness-`);
  }

  /**
   * Create a harness and load the given extension(s). Shorthand for:
   *   const h = new ExtensionTestHarness(ext);
   *   await h.load();
   */
  static async create(
    extensions: KotaExtension | KotaExtension[],
    options?: ExtensionHarnessOptions,
  ): Promise<ExtensionTestHarness> {
    const harness = new ExtensionTestHarness(extensions, options);
    await harness.load();
    return harness;
  }

  /** Load all extensions: resolve tools, routes, and call onLoad. */
  async load(): Promise<void> {
    if (this.#loaded) return;
    for (const ext of this.#extensions) {
      const ctx = this.#buildContext(ext.name);
      const tools =
        !ext.tools
          ? []
          : typeof ext.tools === "function"
            ? ext.tools(ctx)
            : ext.tools;
      for (const t of tools) {
        this.#tools.set(t.tool.name, t);
      }
      if (ext.routes) {
        this.#routes.push(...ext.routes(ctx));
      }
      if (ext.onLoad) {
        await ext.onLoad(ctx);
      }
    }
    this.#loaded = true;
  }

  /**
   * Tear down all loaded extensions in reverse order. Calls onUnload on each.
   * After teardown, load() may be called again.
   */
  async teardown(): Promise<void> {
    for (const ext of [...this.#extensions].reverse()) {
      if (ext.onUnload) {
        await ext.onUnload();
      }
    }
    this.#loaded = false;
  }

  /** Return the ToolDef registered under the given name, or undefined. */
  getTool(name: string): ToolDef | undefined {
    return this.#tools.get(name);
  }

  /** Invoke a registered tool and return its result. Throws if not found. */
  async callTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const def = this.#tools.get(name);
    if (!def) {
      const known = [...this.#tools.keys()].join(", ") || "(none)";
      throw new Error(
        `Tool "${name}" not found in harness. Loaded tools: ${known}`,
      );
    }
    return def.runner(input);
  }

  /** Return HTTP routes contributed by the loaded extension(s). */
  getRoutes(): RouteRegistration[] {
    return [...this.#routes];
  }

  /**
   * Call all registered dynamic state providers and return their concatenated output.
   * Returns an empty string if no providers are registered.
   */
  getDynamicState(): string {
    return [...this.#dynamicStateProviders.values()]
      .map((fn) => fn())
      .join("\n");
  }

  /**
   * Fire a bus event — calls all handlers registered via ctx.events.subscribe
   * for the given event name.
   */
  emitEvent(event: string, payload: Record<string, unknown>): void {
    const handlers = this.#eventHandlers.get(event) ?? [];
    for (const h of handlers) h(payload);
  }

  #buildContext(extensionName: string): ExtensionContext {
    const cwd = this.#options.cwd ?? process.cwd();
    const config = this.#options.config ?? {};
    const secrets = this.#options.secrets ?? {};
    const storage = new ExtensionStorage(this.#tempDir, extensionName);

    return {
      cwd,
      verbose: false,
      config: config as ExtensionContext["config"],
      storage,
      registerGroup: () => {},
      getRoutes: () => [...this.#routes],
      getContributedWorkflows: () => [],
      getContributedChannels: () => [],
      getExtensionSummaries: () => [],
      getExtensionConfig: () => undefined,
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      getSecret: (key) => secrets[key] ?? null,
      listTools: () => [...this.#tools.keys()],
      events: {
        emit: (event, payload) => this.emitEvent(event, payload),
        subscribe: (event, handler) => {
          const handlers = this.#eventHandlers.get(event) ?? [];
          handlers.push(handler);
          this.#eventHandlers.set(event, handlers);
          return () => {
            const current = this.#eventHandlers.get(event);
            if (current) {
              this.#eventHandlers.set(
                event,
                current.filter((fn) => fn !== handler),
              );
            }
          };
        },
      },
      createSession: () => {
        throw new Error("createSession is not supported in ExtensionTestHarness");
      },
      registerProvider: (type, provider) => {
        this.#providers.set(type, provider);
      },
      getProvider: <T>(type: string) =>
        (this.#providers.get(type) as T | undefined) ?? null,
      callTool: async (name, input) => this.callTool(name, input),
      registerMiddleware: () => {},
      registerDynamicStateProvider: (name, fn) => {
        this.#dynamicStateProviders.set(name, fn);
      },
    };
  }
}
