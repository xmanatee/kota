/**
 * CapturePanel test — exercises the panel through the same /api/capture
 * surface the daemon route exposes, asserting that each branch of the
 * discriminated `CaptureResult` renders its own distinct view:
 *
 *  - `ok: true` with a memory record → success row with target badge,
 *    record id, and (for tasks/inbox) path metadata
 *  - `ok: false` with `reason: "ambiguous"` → suggestion buttons that
 *    re-issue `/api/capture` with the chosen target
 *  - `ok: false` with `reason: "no_contributors"` → fixed message
 *  - `ok: false` with `reason: "contributor_failed"` → target badge plus
 *    verbatim message
 *
 * Submission is gated to non-empty drafts — an explicit blank submit
 * must not fire `/api/capture`.
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureResult } from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  prettyDOM,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturePanel } from "./CapturePanel";

function makeWrapper(): {
  Wrapper: ({ children }: { children: ReactNode }) => ReactElement;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { Wrapper, client };
}

function evidenceDirectory(): string | null {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return null;
  return join(
    runDir,
    "capture-consolidation",
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

const MEMORY_OK: CaptureResult = {
  ok: true,
  record: { target: "memory", recordId: "mem-7" },
};

const KNOWLEDGE_OK: CaptureResult = {
  ok: true,
  record: { target: "knowledge", recordId: "knowledge-capture-web" },
};

const TASKS_OK: CaptureResult = {
  ok: true,
  record: {
    target: "tasks",
    recordId: "task-capture-from-web",
    path: "data/tasks/inbox/task-capture-from-web.md",
  },
};

const INBOX_OK: CaptureResult = {
  ok: true,
  record: {
    target: "inbox",
    recordId: "inbox-capture-from-web",
    path: "data/inbox/capture-from-web.md",
  },
};

const AMBIGUOUS: CaptureResult = {
  ok: false,
  reason: "ambiguous",
  suggestions: ["memory", "knowledge"],
};

const AMBIGUOUS_ALL: CaptureResult = {
  ok: false,
  reason: "ambiguous",
  suggestions: ["memory", "knowledge", "tasks", "inbox"],
};

const NO_CONTRIBUTORS: CaptureResult = {
  ok: false,
  reason: "no_contributors",
};

const CONTRIBUTOR_FAILED: CaptureResult = {
  ok: false,
  reason: "contributor_failed",
  target: "inbox",
  message: "Inbox writer cannot reach project root",
};

function typeDraft(text: string): void {
  const textarea = screen.getByPlaceholderText(/Capture a note across stores/);
  fireEvent.change(textarea, { target: { value: text } });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: /^capture$/i }));
}

function getTargetBadgeText(target: string): HTMLElement {
  const matches = screen.getAllByText(target);
  const badge = matches.find((el) => el.tagName !== "OPTION");
  if (!badge) throw new Error(`No non-option element with text "${target}"`);
  return badge;
}

describe("CapturePanel", () => {
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

  it("renders an ok memory capture as a success row with the target badge and record id", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MEMORY_OK),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    typeDraft("remember to reload the daemon after switching modules");
    submit();

    await waitFor(() => expect(screen.getByText("mem-7")).toBeInTheDocument());
    expect(getTargetBadgeText("memory")).toBeInTheDocument();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/capture",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "remember to reload the daemon after switching modules",
        }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("renders an ok tasks capture with path metadata", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TASKS_OK),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    typeDraft("split capture rendering across stores");
    submit();

    await waitFor(() =>
      expect(screen.getByText("task-capture-from-web")).toBeInTheDocument(),
    );
    expect(getTargetBadgeText("tasks")).toBeInTheDocument();
    expect(
      screen.getByText("data/tasks/inbox/task-capture-from-web.md"),
    ).toBeInTheDocument();
  });

  it("renders ambiguous suggestions as buttons that re-issue capture with the chosen target", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(AMBIGUOUS),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MEMORY_OK),
      });
    globalThis.fetch = fetchMock;

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    typeDraft("a fact about a place");
    submit();

    await waitFor(() =>
      expect(
        screen.getByText(/Capture target is ambiguous/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^memory$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^knowledge$/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^memory$/ }));

    await waitFor(() => expect(screen.getByText("mem-7")).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/capture",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "a fact about a place",
          filter: { target: "memory" },
        }),
      }),
    );
  });

  it("renders the no-contributors message when the seam is unconfigured", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(NO_CONTRIBUTORS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    typeDraft("anything");
    submit();

    await waitFor(() =>
      expect(
        screen.getByText("Capture unavailable — no contributors registered."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Capture target is ambiguous/),
    ).not.toBeInTheDocument();
  });

  it("renders contributor_failed with the offending target and verbatim message", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(CONTRIBUTOR_FAILED),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    typeDraft("forced to inbox");
    submit();

    await waitFor(() =>
      expect(
        screen.getByText("Inbox writer cannot reach project root"),
      ).toBeInTheDocument(),
    );
    expect(getTargetBadgeText("inbox")).toBeInTheDocument();
  });

  it("dispatches an explicit-target capture when the override is changed", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TASKS_OK),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    typeDraft("file as a task");
    fireEvent.change(screen.getByLabelText(/Capture target/i), {
      target: { value: "tasks" },
    });
    submit();

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/capture",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "file as a task",
            filter: { target: "tasks" },
          }),
        }),
      ),
    );
  });

  it("renders the strict-decode boundary error in the destructive banner when the daemon ships an unknown reason", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ ok: false, reason: "future_unknown_reason" }),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    typeDraft("anything");
    submit();

    const banner = await waitFor(() =>
      screen.getByText(/unknown capture reason/i),
    );
    expect(banner).toHaveClass("text-destructive");
    expect(
      screen.queryByText(/Capture target is ambiguous/),
    ).not.toBeInTheDocument();
  });

  it("does not call /api/capture on submit with a blank draft", () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(NO_CONTRIBUTORS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CapturePanel />
      </Wrapper>,
    );
    const textarea = screen.getByPlaceholderText(
      /Capture a note across stores/,
    );
    fireEvent.change(textarea, { target: { value: "   " } });
    const button = screen.getByRole("button", { name: /^capture$/i });
    expect(button).toBeDisabled();
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("writes mounted DOM evidence when KOTA_RUN_DIR is set", async () => {
    const dir = evidenceDirectory();
    if (!dir) return;

    const cases: Array<{
      id: string;
      response?: CaptureResult | { ok: false; reason: "future_unknown_reason" };
      draft?: string;
      target?: "auto" | "memory" | "knowledge" | "tasks" | "inbox";
      waitForText: RegExp | string;
      proves: string;
    }> = [
      {
        id: "empty",
        waitForText: "auto",
        proves:
          "CapturePanel mounted its empty form, textarea, auto target, explicit memory/knowledge/tasks/inbox options, and disabled submit state.",
      },
      {
        id: "success-memory",
        response: MEMORY_OK,
        draft: "remember to reload the daemon after switching modules",
        waitForText: "mem-7",
        proves:
          "CapturePanel called /api/capture with no explicit target and rendered the memory success arm.",
      },
      {
        id: "success-knowledge",
        response: KNOWLEDGE_OK,
        draft: "capture the architecture decision",
        target: "knowledge",
        waitForText: "knowledge-capture-web",
        proves:
          "CapturePanel called /api/capture with target=knowledge and rendered the knowledge success arm.",
      },
      {
        id: "success-tasks",
        response: TASKS_OK,
        draft: "split capture rendering across stores",
        target: "tasks",
        waitForText: "data/tasks/inbox/task-capture-from-web.md",
        proves:
          "CapturePanel called /api/capture with target=tasks and rendered path metadata.",
      },
      {
        id: "success-inbox",
        response: INBOX_OK,
        draft: "raw operator thought",
        target: "inbox",
        waitForText: "data/inbox/capture-from-web.md",
        proves:
          "CapturePanel called /api/capture with target=inbox and rendered inbox path metadata.",
      },
      {
        id: "ambiguous",
        response: AMBIGUOUS_ALL,
        draft: "something vague",
        waitForText: /Capture target is ambiguous/,
        proves:
          "CapturePanel rendered the ambiguous arm with all four suggestion buttons.",
      },
      {
        id: "no-contributors",
        response: NO_CONTRIBUTORS,
        draft: "anything",
        waitForText: "Capture unavailable — no contributors registered.",
        proves:
          "CapturePanel rendered the typed no_contributors unavailable state without guessing a store.",
      },
      {
        id: "contributor-failed",
        response: CONTRIBUTOR_FAILED,
        draft: "forced to inbox",
        waitForText: "Inbox writer cannot reach project root",
        proves:
          "CapturePanel rendered contributor_failed with the target badge and verbatim daemon message.",
      },
      {
        id: "decode-error",
        response: { ok: false, reason: "future_unknown_reason" },
        draft: "anything",
        waitForText: /unknown capture reason/i,
        proves:
          "CapturePanel surfaced strict decoder failure for an unknown result arm in the destructive error style.",
      },
    ];

    const manifest: Array<{
      id: string;
      artifact: string;
      fetchUrl: string | null;
      body: unknown;
      proves: string;
      bytes: number;
    }> = [];

    for (const entry of cases) {
      cleanup();
      vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
      if (entry.response) {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(entry.response),
        });
      }

      const { Wrapper } = makeWrapper();
      const rendered = render(
        <Wrapper>
          <CapturePanel />
        </Wrapper>,
      );

      if (entry.draft) {
        typeDraft(entry.draft);
        if (entry.target && entry.target !== "auto") {
          fireEvent.change(screen.getByLabelText(/Capture target/i), {
            target: { value: entry.target },
          });
        }
        submit();
      }

      await waitFor(() =>
        expect(screen.getByText(entry.waitForText)).toBeInTheDocument(),
      );

      const html = prettyDOM(rendered.container, undefined, {
        highlight: false,
      });
      const artifact = `capture-panel-${entry.id}.html`;
      writeEvidenceFile(
        artifact,
        [
          "<!doctype html>",
          '<html lang="en">',
          "<head>",
          '  <meta charset="utf-8">',
          `  <title>CapturePanel ${entry.id} mounted DOM evidence</title>`,
          "</head>",
          "<body>",
          "<!-- Generated by CapturePanel.test.tsx from mounted <CapturePanel />. -->",
          html ?? "",
          "</body>",
          "</html>",
          "",
        ].join("\n"),
      );

      const firstCall = vi.mocked(
        globalThis.fetch as ReturnType<typeof vi.fn>,
      ).mock.calls[0];
      manifest.push({
        id: entry.id,
        artifact,
        fetchUrl: firstCall ? String(firstCall[0]) : null,
        body: firstCall?.[1]?.body ? JSON.parse(String(firstCall[1].body)) : null,
        proves: entry.proves,
        bytes: statSync(join(dir, artifact)).size,
      });
    }

    writeEvidenceFile(
      "capture-panel-mounted-dom-manifest.json",
      `${JSON.stringify(
        {
          generatedBy: "clients/web/src/components/sidebar/CapturePanel.test.tsx",
          surface: "clients/web/src/components/sidebar/CapturePanel.tsx",
          mount: "<CapturePanel /> inside QueryClientProvider",
          requestPath: "/api/capture",
          decoder:
            "clients/web/src/api/client.ts apiDecoded('/api/capture', parseCaptureResult)",
          cases: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});
