import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { TelegramProjectSelection } from "./project-selection.js";

const projects = [
  { projectId: "project-a", projectDir: "/tmp/project-a", displayName: "Project A" },
  { projectId: "project-b", projectDir: "/tmp/project-b", displayName: "Project B" },
];

function makeClient(): KotaClient {
  return {
    projects: {
      list: vi.fn(async () => ({
        ok: true as const,
        projects,
        defaultProjectId: "project-a",
        activeProjectId: null,
      })),
      use: vi.fn(),
    },
  } as unknown as KotaClient;
}

describe("TelegramProjectSelection", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function storage(): ModuleStorage {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-project-selection-"));
    return new ModuleStorage(dir, "telegram");
  }

  it("uses configured chat bindings to resolve a project on multi-project daemons", async () => {
    const selection = new TelegramProjectSelection(
      makeClient(),
      storage(),
      [{ chatId: 99, projectId: "project-b" }],
    );

    const resolved = await selection.resolveChat(99);

    expect(resolved).toEqual({
      ok: true,
      project: projects[1],
      showProjectLabels: true,
    });
  });

  it("stores per-chat /project overrides without mutating the global project selector", async () => {
    const client = makeClient();
    const selection = new TelegramProjectSelection(
      client,
      storage(),
      [{ chatId: 99, projectId: "project-a" }],
    );

    const switched = await selection.switchChat(99, "project-b");
    const resolved = await selection.resolveChat(99);

    expect(switched.ok).toBe(true);
    expect(resolved).toEqual({
      ok: true,
      project: projects[1],
      showProjectLabels: true,
    });
    expect(client.projects.use).not.toHaveBeenCalled();
  });

  it("can read projects from a daemon source when the captured client is local", async () => {
    const client = {
      projects: {
        list: vi.fn(async () => ({ ok: false as const, reason: "daemon_required" as const })),
        use: vi.fn(),
      },
    } as unknown as KotaClient;
    const projectSource = {
      list: vi.fn(async () => ({
        ok: true as const,
        projects,
        defaultProjectId: "project-a",
        activeProjectId: null,
      })),
    };
    const selection = new TelegramProjectSelection(client, storage(), [], {
      projectSource,
    });

    const switched = await selection.switchChat(99, "project-b");
    const resolved = await selection.resolveChat(99);

    expect(switched.ok).toBe(true);
    expect(resolved).toEqual({
      ok: true,
      project: projects[1],
      showProjectLabels: true,
    });
    expect(projectSource.list).toHaveBeenCalled();
    expect(client.projects.list).not.toHaveBeenCalled();
  });

  it("returns a loud unbound-chat message on multi-project daemons", async () => {
    const selection = new TelegramProjectSelection(makeClient(), storage(), []);

    const resolved = await selection.resolveChat(99);

    expect(resolved).toEqual({
      ok: false,
      message:
        "This Telegram chat is not bound to a KOTA project. Send /project to list projects, then /project <id> to choose one.",
    });
  });

  it("renders labels only when more than one project is hosted", async () => {
    const singleClient = {
      projects: {
        list: vi.fn(async () => ({
          ok: true as const,
          projects: [projects[0]!],
          defaultProjectId: "project-a",
          activeProjectId: null,
        })),
        use: vi.fn(),
      },
    } as unknown as KotaClient;

    expect(
      await new TelegramProjectSelection(makeClient(), storage(), [])
        .renderProjectLabelPrefix("project-b"),
    ).toBe("[Project B] ");
    expect(
      await new TelegramProjectSelection(singleClient, storage(), [])
        .renderProjectLabelPrefix("project-a"),
    ).toBe("");
  });
});
