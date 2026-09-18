/** Tool execution and per-turn prompt assembly must share the live session/scope identity. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "./core/daemon/scope-provider.js";
import { ScopeRegistry } from "./core/daemon/scope-registry.js";
import { initEventBus, resetEventBus } from "./core/events/event-bus.js";
import { AgentSession } from "./core/loop/loop.js";
import { BufferTransport } from "./core/loop/transport.js";
import { createMockClient, textResponse, toolUseResponse } from "./core/model/mock-client.test-support.js";
import { ModuleLoader } from "./core/modules/module-loader.js";
import { registerCustomGroup } from "./core/tools/tool-groups.js";
import workingMemoryModule from "./modules/working-memory/index.js";

describe("session working-memory prompt isolation", () => {
  let root: string;
  let otherRoot: string;
  let loader: ModuleLoader;
  const sessions: AgentSession[] = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "kota-session-working-memory-"));
    otherRoot = join(root, "other-scope");
    mkdirSync(otherRoot);
    const registry = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [{ scopeRoot: root }, { scopeRoot: otherRoot }] });
    loader = new ModuleLoader({}, false, { scopeRoot: root });
    loader.setCwd(root);
    loader.setBus(initEventBus());
    loader.getProviderRegistry().register(DAEMON_SCOPE_PROVIDER_TYPE, "host", {
      getScopeRegistryProjection: () => registry.toProjection(),
      getActiveScopeId: () => null,
      resolveScopeRuntime: () => { throw new Error("Selection does not resolve runtime services"); },
    });
    await loader.load(workingMemoryModule);
  });

  afterEach(async () => {
    for (const session of sessions.splice(0)) await session.dispose();
    await loader.unloadAll();
    resetEventBus();
    rmSync(root, { recursive: true, force: true });
  });

  function createSession(responses: Parameters<typeof createMockClient>[0], scopeRoot = root) {
    const [client, calls] = createMockClient(responses);
    const session = new AgentSession({
      autonomyMode: "autonomous", client, transport: new BufferTransport(),
      model: "claude-haiku-4-5-20251001", noHistory: true, verbose: false,
      scopeRoot, moduleLoader: loader,
    });
    sessions.push(session);
    return { session, calls };
  }

  it("keeps two live scratchpads and another scope private through tool writes, clear, policy changes, and disposal", async () => {
    const a = createSession([
      toolUseResponse("working_memory", { action: "write", key: "research", value: "alpha findings" }),
      textResponse("Stored."),
      toolUseResponse("working_memory", { action: "clear" }),
      textResponse("Cleared."),
    ]);
    const b = createSession([
      toolUseResponse("working_memory", { action: "write", key: "research", value: "beta findings" }),
      textResponse("Stored."),
      textResponse("Still available."),
      textResponse("Tool unavailable."),
      textResponse("Available again."),
    ]);
    const other = createSession([textResponse("Empty.")], otherRoot);
    await a.session.send("Record alpha");
    await b.session.send("Record beta");
    await other.session.send("Check current state");
    expect(JSON.stringify(a.calls[0].system)).not.toContain("**research**");
    expect(JSON.stringify(a.calls[1].system)).toContain("alpha findings");
    expect(JSON.stringify(b.calls[0].system)).not.toContain("alpha findings");
    expect(JSON.stringify(b.calls[1].system)).toContain("beta findings");
    expect(JSON.stringify(other.calls[0].system)).not.toContain("**research**");
    await a.session.send("Clear state");
    expect(JSON.stringify(a.calls[2].system)).toContain("alpha findings");
    expect(JSON.stringify(a.calls[2].system)).not.toContain("beta findings");
    expect(JSON.stringify(a.calls[3].system)).not.toContain("**research**");
    await a.session.dispose();
    await b.session.send("Check retained state");
    expect(JSON.stringify(b.calls[2].system)).toContain("beta findings");

    const reveal = registerCustomGroup("working-memory-policy-test", ["working_memory"]);
    try {
      await b.session.send("Continue");
      expect(JSON.stringify(b.calls[3].system)).not.toContain("**research**");
    } finally {
      reveal();
    }
    await b.session.send("Continue");
    expect(JSON.stringify(b.calls[4].system)).toContain("beta findings");
    const fresh = createSession([textResponse("Empty.")]);
    await fresh.session.send("Check new state");
    expect(JSON.stringify(fresh.calls[0].system)).not.toContain("**research**");
  });
});
