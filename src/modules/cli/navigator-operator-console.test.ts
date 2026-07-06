import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runNavigator } from "./navigator.js";
import { operatorConsoleBundle } from "./navigator-operator-console-fixture.js";
import { consoleAction } from "./navigator-operator-console-fixture-actions.js";
import { emptyClient } from "./navigator-test-client.js";
import {
  makeOutput,
  makePrompt,
  navigationSurface,
} from "./navigator-test-surfaces.js";

describe("navigator operator console", () => {
  it("renders the first-screen overview from shared Status, Work, Inbox, Setup, Modules, Agents, and Stores surfaces", async () => {
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => operatorConsoleBundle()),
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["q"]),
      output: output.capture,
    });

    const joined = output.frames.join("\n");
    expect(joined).toMatch(/KOTA Terminal Client/);
    expect(joined).toMatch(/Operator overview/);
    expect(joined).toMatch(/Daemon:\s+running \(pid 4242\)/);
    expect(joined).toMatch(/Project:\s+scope-main/);
    expect(joined).toMatch(/Dispatch:\s+running/);
    expect(joined).toMatch(/Active \/ queued:\s+1 active, 2 queued/);
    expect(joined).toMatch(/Inbox:\s+1 approvals, 1 owner questions, 1 failed runs/);
    expect(joined).toMatch(/Setup gaps:\s+missing 1, pending 1/);
    expect(joined).toMatch(/Run supervision/);
    expect(joined).toMatch(/workflow\.pause\s+Pause dispatch/);
    expect(joined).toMatch(/workflow\.resume\s+Resume dispatch/);
    expect(joined).toMatch(/run\.cancel-queued\s+Cancel queued run/);
    expect(joined).toMatch(/run\.retry\s+Retry failed run/);
    expect(joined).toMatch(/run\.replay\s+Replay run/);
    expect(joined).toMatch(/run\.resume\s+Resume run from step/);
    expect(joined).toMatch(/modules-agents/);
    expect(joined).toMatch(/stores/);
  });

  it("refuses typed action execution for secret parameter fields", async () => {
    const bundle = {
      protocolVersion: "ui.surface.v1" as const,
      surfaces: [
        navigationSurface({
          surfaceId: "setup",
          title: "Setup",
          intent: "Setup",
          order: 10,
          actions: [
            consoleAction({
              surfaceId: "setup",
              actionId: "setup.secret",
              label: "Store setup secret",
              namespace: "setup",
              method: "storeSecret",
              effect: "write",
              parameters: {
                fields: [{ id: "token", label: "Token", input: "secret", required: true }],
                schema: {
                  type: "object",
                  required: ["token"],
                  properties: { token: { type: "string" } },
                  additionalProperties: false,
                },
              },
            }),
          ],
        }),
      ],
    };
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "stored" }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => bundle),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt([":", 'action setup setup.secret {"token":"super-secret"}', "q"]),
      output: output.capture,
    });

    expect(executeAction).not.toHaveBeenCalled();
    const joined = output.frames.join("\n");
    expect(joined).toMatch(/Store setup secret needs secret input/);
    expect(joined).not.toContain("super-secret");
  });

  it("renders explicit daemon-down guidance for errors and empty local surface bundles", async () => {
    const failingOutput = makeOutput();
    await runNavigator({
      client: emptyClient({
        ui: {
          listSurfaces: vi.fn(async () => {
            throw new Error("Daemon unreachable while listing shared UI surfaces");
          }),
          executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
          watchEvents: async function* () {},
        },
      }),
      prompt: makePrompt(["work", "q"]),
      output: failingOutput.capture,
    });
    expect(failingOutput.frames.join("\n")).toMatch(/press r or type refresh/);

    const offlineOutput = makeOutput();
    await runNavigator({
      client: emptyClient({
        ui: {
          listSurfaces: vi.fn(async () => ({ protocolVersion: "ui.surface.v1" as const, surfaces: [] })),
          executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
          watchEvents: async function* () {},
        },
      }),
      prompt: makePrompt(["q"]),
      output: offlineOutput.capture,
    });
    const joined = offlineOutput.frames.join("\n");
    expect(joined).toMatch(/Daemon offline or shared UI unavailable/);
    expect(joined).toMatch(/kota daemon start/);
    expect(joined).toMatch(/live:not subscribed 0/);
    expect(joined).not.toMatch(/live:event-stream/);
  });

  it("keeps navigator code on the shared KotaClient UI contract", () => {
    const sourceFiles = [
      "index.ts",
      "navigator.ts",
      "navigator-action-execution.ts",
      "navigator-commands.ts",
      "navigator-live-events.ts",
      "navigator-render.ts",
      "navigator-state.ts",
      "navigator-terminal-prompt.ts",
    ];
    const sources = sourceFiles.map((file) => readFileSync(join(import.meta.dirname, file), "utf-8"));
    for (const src of sources) {
      expect(/['"]\.kota\//.test(src), "navigator must not read .kota/ paths").toBe(false);
      expect(/DaemonControlClient/.test(src), "navigator must not import DaemonControlClient").toBe(false);
      expect(/getProvider|getModuleSummaries|getApprovalQueue|moduleServices/.test(src),
        "navigator must not resolve module services through ctx",
      ).toBe(false);
      expect(/client\.(approvals|tasks|workflow|sessions|modules|setup|secrets|memory|knowledge|history|ownerQuestions)\b/.test(src),
        "navigator must consume shared ui surfaces rather than private namespace projections",
      ).toBe(false);
    }
  });
});
