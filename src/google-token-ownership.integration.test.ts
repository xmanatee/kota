import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { outboundHttp } from "#core/outbound-http/index.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { getToolEffect, resolveToolSet } from "#core/tools/index.js";
import daemonOps from "#modules/daemon-ops/index.js";
import git from "#modules/git/index.js";
import googleWorkspace from "#modules/google-workspace/index.js";
import inboundSignals from "#modules/inbound-signals/index.js";
import rendering from "#modules/rendering/index.js";
import repoTasks from "#modules/repo-tasks/index.js";
import workflowOps from "#modules/workflow-ops/index.js";

// Detects account substitution across module registration, readiness and reload.
// Only the HTTP port and clock are controlled; loaders and tools are production owners.
it("keeps registered Google tool credentials and token lifetimes isolated across reload", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "google-token-ownership-"));
  const credentials = (account: string) => ({
    clientId: `client-${account}`,
    clientSecret: `secret-${account}`,
    refreshToken: `refresh-${account}`,
  });
  const config = { modules: { "google-workspace": credentials("A") } };
  const loader = new ModuleLoader(config);
  loader.setCwd(cwd);
  loader.setBus(new EventBus());
  const transcript: unknown[] = [];
  const refreshes = new Map<string, number>();
  let failAccount: string | undefined;
  let now = Date.parse("2026-09-21T00:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const port = outboundHttpRequestPort((request) => {
    const url = new URL(request.url);
    if (url.hostname === "oauth2.googleapis.com") {
      const body = new URLSearchParams(String(request.body));
      const account = body.get("refresh_token")?.replace("refresh-", "");
      if (!account) throw new Error("Missing synthetic account");
      expect(body.get("client_id")).toBe(`client-${account}`);
      expect(body.get("client_secret")).toBe(`secret-${account}`);
      const generation = (refreshes.get(account) ?? 0) + 1;
      refreshes.set(account, generation);
      const status = failAccount === account ? 401 : 200;
      transcript.push({ refresh: account, generation, status });
      return Response.json(status === 200
        ? { access_token: `synthetic-${account}-${generation}`, expires_in: 3600 }
        : { error: `secret-${account} refresh-${account}` }, { status });
    }
    const bearer = new Headers(request.headers).get("Authorization");
    const account = bearer?.match(/^Bearer synthetic-([ABC])-\d+$/)?.[1];
    if (!account) throw new Error("Unexpected bearer");
    transcript.push({ request: url.pathname, bearer });
    const id = `account-${account}`;
    if (url.pathname.includes("/messages")) {
      if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id }] });
      return Response.json({ id, threadId: id, snippet: id, payload: { headers: [{ name: "Subject", value: id }] } });
    }
    if (url.pathname.includes("/calendar/")) {
      const event = { id, summary: id };
      return Response.json(request.method === "POST" ? event : { items: [event] });
    }
    if (url.pathname.includes("/drive/")) {
      if (url.searchParams.get("alt") === "media") return new Response(id);
      const file = { id, name: id, mimeType: "text/plain" };
      return Response.json(url.pathname.endsWith("/files") ? { files: [file] } : file);
    }
    throw new Error(`Unexpected synthetic request: ${url}`);
  });
  vi.spyOn(outboundHttp, "request").mockImplementation(port.request);
  const inputs: Record<string, Record<string, unknown>> = {
    gmail_list_messages: {},
    gmail_get_message: { id: "message" },
    gmail_send: { to: "synthetic@example.invalid", subject: "Synthetic", body: "Synthetic" },
    calendar_list_events: {},
    calendar_create_event: { summary: "Synthetic", start: "2026-09-21T10:00:00Z", end: "2026-09-21T11:00:00Z" },
    drive_list_files: {},
    drive_read_file: { id: "file" },
  };
  const names = Object.keys(inputs);
  type ToolSet = ReturnType<typeof resolveToolSet>;
  async function call(set: ToolSet, name: string, account: string, generation: number) {
    const start = transcript.length;
    const result = await set.runners[name](inputs[name]);
    expect(result.is_error).not.toBe(true);
    expect(result.content).toContain(`account-${account}`);
    const requests = transcript.slice(start).filter((entry): entry is { bearer: string } =>
      typeof entry === "object" && entry !== null && "bearer" in entry,
    );
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((entry) => entry.bearer === `Bearer synthetic-${account}-${generation}`)).toBe(true);
    transcript.push({ tool: name, account, result: result.content });
  }
  async function readiness(status: "ready" | "unavailable") {
    const source = loader.getProviderRegistry().getByName(CAPABILITY_READINESS_PROVIDER_TYPE, "google-workspace");
    expect(source).not.toBeNull();
    const result = await source!.probe();
    expect(result[0].status).toBe(status);
    transcript.push({ readiness: result });
  }
  try {
    for (const mod of [rendering, git, repoTasks, daemonOps, workflowOps, inboundSignals, googleWorkspace]) {
      await loader.load(mod);
    }
    const a = resolveToolSet(names);
    expect(a.tools).toHaveLength(7);
    await call(a, "calendar_list_events", "A", 1);

    // Same credentials still receive a fresh lifetime on a normal reload.
    expect(await loader.reload("google-workspace")).toBe(true);
    const reloadedA = resolveToolSet(names);
    await call(reloadedA, "drive_list_files", "A", 2);
    config.modules["google-workspace"] = credentials("B");
    expect(await loader.reload("google-workspace")).toBe(true);
    await readiness("ready");
    const b = resolveToolSet(names);
    for (const name of names) {
      // Retained runner snapshots model tool sets captured by existing sessions.
      await call(a, name, "A", 1);
      await call(b, name, "B", 2);
    }
    expect(refreshes.get("A")).toBe(2);
    expect(refreshes.get("B")).toBe(2);
    for (const name of ["gmail_send", "calendar_create_event"]) {
      expect(getToolEffect(name)).toMatchObject({ kind: "destructive", scope: "external-network" });
    }
    await readiness("ready");
    await call(b, "drive_list_files", "B", 2);
    expect(refreshes.get("B")).toBe(3);

    now += 3_600_000;
    await call(a, "gmail_get_message", "A", 3);
    failAccount = "B";
    await readiness("unavailable");
    const beforeFailure = transcript.length;
    const failure = await b.runners.gmail_get_message(inputs.gmail_get_message).catch((error: unknown) => error);
    expect(failure).toEqual(new Error("Google token refresh failed (401)"));
    transcript.push({ tool: "gmail_get_message", account: "B", error: (failure as Error).message });
    expect(transcript.slice(beforeFailure)).toEqual([
      { refresh: "B", generation: 5, status: 401 },
      { tool: "gmail_get_message", account: "B", error: "Google token refresh failed (401)" },
    ]);
    await call(a, "drive_list_files", "A", 3);
    failAccount = undefined;
    await call(b, "gmail_get_message", "B", 6);

    config.modules["google-workspace"] = credentials("C");
    expect(await loader.reload("google-workspace")).toBe(true);
    const c = resolveToolSet(names);
    for (const name of names) await call(c, name, "C", 1);
    await call(b, "calendar_list_events", "B", 6);
    expect(refreshes.get("C")).toBe(1);
    expect(JSON.stringify(transcript)).not.toMatch(/secret-[ABC]|refresh-[ABC]/);
    process.stdout.write(`Synthetic Google tool transcript:\n${JSON.stringify(transcript, null, 2)}\n`);
  } finally {
    await loader.unloadAll();
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  }
});
