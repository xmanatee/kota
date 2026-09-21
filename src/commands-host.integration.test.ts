// Detects catalog/prompt authority leaking between real module hosts and the
// serving catalog retaining the CLI bootstrap loader after its teardown.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { createModuleLoader } from "#core/modules/module-context.test-helpers.js";
import type { ModuleLoader } from "#core/modules/module-loader.js";
import type { KotaModule } from "#core/modules/module-types.js";
import commandsModule from "#modules/commands/index.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kota-commands-host-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function host(root: string, name: string, mode: "commands" | "runtime" = "runtime") {
  const scope = join(root, name);
  const external = join(root, `${name}-assets`);
  mkdirSync(scope);
  mkdirSync(external);
  writeFileSync(join(scope, "local.md"), `${name} local prompt`);
  writeFileSync(join(external, "external.md"), `${name} external prompt`);
  const loader = createModuleLoader({}, false, { mode, trustedPromptRoots: [external] });
  loader.setCwd(scope);
  const skills: KotaModule = {
    name: "skills",
    skills: [
      { name, promptPath: "local.md" },
      { name: "external", promptPath: join(external, "external.md") },
    ],
  };
  return { loader, skills, external };
}

// Keep registered handlers mounted across unload/reload: an already-constructed
// server must resolve current provider authority, not a retained catalog object.
function endpoints(loader: ModuleLoader) {
  const routes = [...loader.getRoutes(), ...loader.getContributedControlRoutes()];
  return async (surface: "/api/commands" | "/commands", name?: string) => {
    const req = new IncomingMessage(new Socket());
    req.method = name ? "POST" : "GET";
    req.url = `${surface}${name ? "/invoke" : ""}`;
    if (name) req.push(Buffer.from(JSON.stringify({ name })));
    req.push(null);
    const res = new ServerResponse(req);
    let body: unknown;
    vi.spyOn(res, "end").mockImplementation((data: string | Uint8Array) => {
      body = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString());
      return res;
    });
    const route = routes.find(r => r.path === req.url && r.method === req.method);
    if (!route) throw new Error(`Missing route: ${req.method} ${req.url}`);
    await route.handler(req, res, {});
    return { status: res.statusCode, body };
  };
}

const surfaces = ["/api/commands", "/commands"] as const;
type Endpoint = Awaited<ReturnType<typeof endpoints>>;
async function assertHost(request: Endpoint, own: string, foreign: string) {
  for (const surface of surfaces) {
    const list = await request(surface);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ commands: [`skill:${own}`, "skill:external"]
      .sort((a, b) => a.localeCompare(b))
      .map(name => expect.objectContaining({ name })) });
    expect(await request(surface, `skill:${own}`)).toEqual({
      status: 200, body: { kind: "skill", prompt: `${own} local prompt` },
    });
    expect(await request(surface, "skill:external")).toEqual({
      status: 200, body: { kind: "skill", prompt: `${own} external prompt` },
    });
    expect((await request(surface, `skill:${foreign}`)).status).toBe(404);
  }
}

it("keeps both surfaces host-local through overlapping activation, withdrawal and reload", async () => {
  const root = fixture();
  const a = host(root, "alpha");
  const b = host(root, "beta");
  await a.loader.load(a.skills);
  await a.loader.load(commandsModule);
  const requestA = endpoints(a.loader);
  await assertHost(requestA, "alpha", "beta");
  // Reverse contribution order also verifies live catalog callbacks.
  await b.loader.load(commandsModule);
  await b.loader.load(b.skills);
  const requestB = endpoints(b.loader);
  await assertHost(requestA, "alpha", "beta");
  await assertHost(requestB, "beta", "alpha");

  // Same declaration in each host: only A authorizes this external root.
  for (const loader of [a.loader, b.loader]) {
    await loader.load({ name: "foreign-asset", skills: [
      { name: "a-asset", promptPath: join(a.external, "external.md") },
    ] });
  }
  for (const surface of surfaces) {
    expect(await requestA(surface, "skill:a-asset")).toEqual({
      status: 200, body: { kind: "skill", prompt: "alpha external prompt" },
    });
    await expect(requestB(surface, "skill:a-asset")).rejects.toThrow("outside authorized roots");
  }
  await b.loader.unload("foreign-asset");
  await a.loader.unloadAll();
  for (const surface of surfaces) {
    for (const name of [undefined, "skill:alpha"]) {
      expect(await requestA(surface, name)).toEqual({
        status: 503, body: { error: "Slash-command catalog unavailable" },
      });
    }
  }
  await assertHost(requestB, "beta", "alpha");
  a.loader.setBus(new EventBus());
  await a.loader.load(commandsModule);
  await a.loader.load(a.skills);
  await assertHost(requestA, "alpha", "beta");
  await b.loader.unloadAll();
  await assertHost(requestA, "alpha", "beta");
});

it("keeps the runtime palette usable after commands-mode bootstrap cleanup", async () => {
  const root = fixture();
  const bootstrap = host(root, "bootstrap", "commands");
  const runtime = host(root, "runtime");
  await bootstrap.loader.load(bootstrap.skills);
  await bootstrap.loader.load(commandsModule);
  await runtime.loader.load(runtime.skills);
  await runtime.loader.load(commandsModule);
  const request = endpoints(runtime.loader);
  await assertHost(request, "runtime", "bootstrap");
  await bootstrap.loader.unloadAll();
  await assertHost(request, "runtime", "bootstrap");
});
