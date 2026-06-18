/**
 * DigestPanel test — exercises the panel through the same /api/digest surface
 * the daemon route exposes, asserting:
 *
 *  - active payload renders the rendered text body and an "active" label
 *  - quiet payload (`data.quiet === true`) renders a distinct "quiet window" label
 *  - failed /api/digest surfaces the daemon's error one-to-one
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DigestResponse } from "@/api/types";
import { TestProjectProvider } from "@/lib/project-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  prettyDOM,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DigestPanel } from "./DigestPanel";

function makeWrapper(): {
  Wrapper: ({ children }: { children: ReactNode }) => ReactElement;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <TestProjectProvider>{children}</TestProjectProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, client };
}

function evidenceDirectory(): string | null {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return null;
  return join(
    runDir,
    "digest-consolidation",
    "surface-runtime-evidence",
    "web",
  );
}

function writeEvidenceFile(fileName: string, body: string): void {
  const dir = evidenceDirectory();
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), body, "utf-8");
}

const ACTIVE_PAYLOAD: DigestResponse = {
  data: {
    windowStartedAt: "2026-04-25T08:00:00.000Z",
    windowEndedAt: "2026-04-26T08:00:00.000Z",
    builderCommits: [
      {
        runId: "r-1",
        taskId: "task-foo",
        taskTitle: "Add foo",
        commitSubject: "Add foo",
        durationMs: 60000,
      },
    ],
    explorerAdditions: [],
    decomposerSplits: [],
    blockedPromoterMoves: [],
    failedMonitoredRuns: [],
    pendingOwnerQuestions: [],
    agingOperatorCaptures: [],
    queueDelta: {
      current: { backlog: 0, ready: 1, doing: 0, blocked: 8 },
      previous: null,
      delta: { backlog: null, ready: null, doing: null, blocked: null },
    },
    quiet: false,
  },
  text: "Daily digest 2026-04-26\n- builder committed: Add foo",
};

const QUIET_PAYLOAD: DigestResponse = {
  data: {
    windowStartedAt: "2026-04-25T08:00:00.000Z",
    windowEndedAt: "2026-04-26T08:00:00.000Z",
    builderCommits: [],
    explorerAdditions: [],
    decomposerSplits: [],
    blockedPromoterMoves: [],
    failedMonitoredRuns: [],
    pendingOwnerQuestions: [],
    agingOperatorCaptures: [],
    queueDelta: {
      current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
      previous: null,
      delta: { backlog: null, ready: null, doing: null, blocked: null },
    },
    quiet: true,
  },
  text: "Daily digest 2026-04-26\n(quiet window — nothing to report)",
};

describe("DigestPanel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    localStorage.setItem("kota-auth-token", "test-token");
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.resetModules();
  });

  it("renders the rendered body and an active label for an active payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ACTIVE_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <DigestPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/builder committed: Add foo/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.queryByText("quiet window")).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/digest",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("labels quiet windows distinctly using data.quiet", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(QUIET_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <DigestPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("quiet window")).toBeInTheDocument(),
    );
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(
      screen.getByText(/quiet window — nothing to report/),
    ).toBeInTheDocument();
  });

  it("surfaces the daemon's typed error when /api/digest fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve("digest unavailable"),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <DigestPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText(/digest unavailable/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/API error 503/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("writes mounted DOM evidence when KOTA_RUN_DIR is set", async () => {
    const dir = evidenceDirectory();
    if (!dir) return;

    const cases: Array<{
      id: string;
      response:
        | { ok: true; json: () => Promise<DigestResponse> }
        | { ok: false; status: number; text: () => Promise<string> };
      waitForText: RegExp | string;
      proves: string;
    }> = [
      {
        id: "active",
        response: {
          ok: true,
          json: () => Promise.resolve(ACTIVE_PAYLOAD),
        },
        waitForText: /builder committed: Add foo/,
        proves:
          "DigestPanel mounted against /api/digest, decoded an active DigestResponse, rendered the active badge and daemon text body.",
      },
      {
        id: "quiet",
        response: {
          ok: true,
          json: () => Promise.resolve(QUIET_PAYLOAD),
        },
        waitForText: "quiet window",
        proves:
          "DigestPanel mounted against /api/digest, decoded data.quiet=true, and rendered the quiet-window badge.",
      },
      {
        id: "error",
        response: {
          ok: false,
          status: 503,
          text: () => Promise.resolve("digest unavailable"),
        },
        waitForText: /API error 503/,
        proves:
          "DigestPanel mounted against /api/digest and surfaced the daemon error with the Retry control.",
      },
    ];

    const manifest: Array<{
      id: string;
      artifact: string;
      fetchUrl: string;
      authorizationHeader: string;
      proves: string;
      bytes: number;
    }> = [];

    for (const entry of cases) {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        entry.response,
      );
      const { Wrapper } = makeWrapper();
      const { container } = render(
        <Wrapper>
          <DigestPanel />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByText(entry.waitForText)).toBeInTheDocument(),
      );
      const html = prettyDOM(container, undefined, { highlight: false });
      const artifact = `digest-panel-${entry.id}.html`;
      writeEvidenceFile(
        artifact,
        [
          "<!doctype html>",
          '<html lang="en">',
          "<head>",
          '  <meta charset="utf-8">',
          `  <title>DigestPanel ${entry.id} mounted DOM evidence</title>`,
          "</head>",
          "<body>",
          "<!-- Generated by DigestPanel.test.tsx from mounted <DigestPanel />. -->",
          html ?? container.innerHTML,
          "</body>",
          "</html>",
          "",
        ].join("\n"),
      );
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(
        -1,
      );
      manifest.push({
        id: entry.id,
        artifact,
        fetchUrl: String(call?.[0] ?? ""),
        authorizationHeader: String(
          (call?.[1]?.headers as { Authorization?: string } | undefined)
            ?.Authorization ?? "",
        ),
        proves: entry.proves,
        bytes: statSync(join(dir, artifact)).size,
      });
      cleanup();
    }

    writeEvidenceFile(
      "digest-panel-mounted-dom-manifest.json",
      `${JSON.stringify(
        {
          generatedBy:
            "clients/web/src/components/sidebar/DigestPanel.test.tsx",
          surface: "clients/web/src/components/sidebar/DigestPanel.tsx",
          mount:
            "<DigestPanel /> inside QueryClientProvider + TestProjectProvider",
          requestPath: "/api/digest",
          decoder:
            "clients/web/src/api/client.ts apiDecoded('/api/digest', parseDigestResponse)",
          cases: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});
