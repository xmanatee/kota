import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerResourceDiscoveryCommand } from "./cli.js";
import type {
  ResourceDiscoveryProvider,
  ResourceDiscoveryResult,
} from "./client.js";

const sampleResult: ResourceDiscoveryResult = {
  ok: true,
  query: "send a Slack approval",
  degradation: "keyword_only",
  hits: [
    {
      kind: "setup-requirement",
      id: "setup:slack-channel:socket-mode-credentials",
      name: "slack-channel/socket-mode-credentials",
      title: "slack-channel/socket-mode-credentials",
      description: "Slack setup requirement.",
      score: 8,
      why: ["title matched slack"],
      readiness: {
        status: "setup_blocked",
        message: "Slack credentials missing.",
        blockers: [
          {
            moduleName: "slack-channel",
            requirementId: "socket-mode-credentials",
            title: "socket-mode-credentials",
            state: "missing",
            reason: "secret_missing",
            message: "Slack credentials missing.",
            statusLinks: {
              list: "/setup/requirements",
              refresh: "/setup/requirements/slack-channel/socket-mode-credentials/refresh",
              revoke: "/setup/requirements/slack-channel/socket-mode-credentials",
            },
          },
        ],
      },
      ownerModule: "slack-channel",
      inspectPath: "kota setup list --json",
      accessHint: "Use kota setup.",
      tags: ["secret"],
      metadata: {},
    },
  ],
};

function makeProgram(
  capture: { query?: string; filter?: object },
  fallbackProvider?: ResourceDiscoveryProvider,
): Command {
  const program = new Command();
  program.exitOverride();
  registerResourceDiscoveryCommand(program, {
    client: {
      resourceDiscovery: {
        async discover(query: string, filter?: object) {
          capture.query = query;
          capture.filter = filter;
          return sampleResult;
        },
      },
    },
  } as unknown as ModuleContext, fallbackProvider);
  return program;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

describe("kota resource-discovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints the structured provider envelope for --json", async () => {
    const capture: { query?: string; filter?: object } = {};
    const output = await captureStdout(async () => {
      await makeProgram(capture).parseAsync([
        "node",
        "kota",
        "resource-discovery",
        "send a Slack approval",
        "--kind",
        "setup-requirement",
        "--limit",
        "2",
        "--json",
      ]);
    });
    expect(JSON.parse(output)).toEqual(sampleResult);
    expect(capture).toEqual({
      query: "send a Slack approval",
      filter: { limit: 2, kinds: ["setup-requirement"] },
    });
  });

  it("falls back to the local provider when a stale daemon lacks the route", async () => {
    const capture: { query?: string; filter?: object } = {};
    const fallbackCapture: { query?: string; filter?: object } = {};
    const program = new Command();
    program.exitOverride();
    registerResourceDiscoveryCommand(program, {
      client: {
        resourceDiscovery: {
          async discover(query: string, filter?: object) {
            capture.query = query;
            capture.filter = filter;
            throw new Error("Not found");
          },
        },
      },
    } as unknown as ModuleContext, {
      async discover(query, filter) {
        fallbackCapture.query = query;
        fallbackCapture.filter = filter;
        return sampleResult;
      },
    });

    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "resource-discovery",
        "send a Slack approval",
        "--limit",
        "1",
        "--json",
      ]);
    });

    expect(JSON.parse(output)).toEqual(sampleResult);
    expect(capture).toEqual({
      query: "send a Slack approval",
      filter: { limit: 1 },
    });
    expect(fallbackCapture).toEqual(capture);
  });
});
