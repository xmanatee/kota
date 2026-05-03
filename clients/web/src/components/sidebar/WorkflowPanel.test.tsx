/**
 * WorkflowPanel test — covers the trigger-button surface that exposes
 * workflow definitions through the daemon's typed `inputSchema`.
 *
 *  - Workflows without an `inputSchema` (or with no declared
 *    properties) trigger immediately on click with no payload, so the
 *    existing zero-input flow is preserved.
 *  - Workflows with an `inputSchema` reveal a generated form whose
 *    fields match the schema (`string` → text input, `number` → number
 *    input, `boolean` → checkbox; required fields marked with `*`).
 *  - Submitting the form with empty required fields shows a per-field
 *    validation message and never reaches `/api/workflow/trigger`.
 *  - Submitting valid values posts the assembled payload to the
 *    trigger endpoint, with values typed as the schema declares.
 */

import type {
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
} from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowPanel } from "./WorkflowPanel";

function emitEvidence(name: string, html: string): void {
  const target = process.env.KOTA_RUN_DIR;
  if (!target) return;
  const out = resolve(target, name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    [
      "<!doctype html>",
      `<html lang="en"><head><meta charset="utf-8"><title>${name}</title></head>`,
      "<body>",
      html,
      "</body></html>",
    ].join("\n"),
  );
}

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

const ZERO_INPUT_DEF: WorkflowDefinitionSummary = {
  name: "dispatcher",
  enabled: true,
  stepCount: 1,
  triggers: [{ type: "event", event: "runtime.idle" }],
};

const PARAMETERIZED_DEF: WorkflowDefinitionSummary = {
  name: "decomposer",
  enabled: true,
  stepCount: 2,
  triggers: [{ type: "event", event: "autonomy.queue.available" }],
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Task identifier to decompose" },
      maxChildren: { type: "number", description: "Cap on child tasks" },
      includeBlocked: { type: "boolean" },
    },
    required: ["taskId"],
  },
};

const STATUS: WorkflowLiveStatus = {
  activeRuns: [],
  pendingRuns: [],
  queueLength: 0,
  completedRuns: 0,
  paused: false,
  agentConcurrency: 1,
  codeConcurrency: 4,
  workflows: { dispatcher: { enabled: true }, decomposer: { enabled: true } },
};

type FetchInput = string | URL | Request;
type FetchHandler = (input: FetchInput, init?: RequestInit) => Promise<unknown>;

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function installFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
    const body = await handler(input, init);
    return {
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function defaultHandler(
  triggerCalls: Array<{ name: string; payload?: unknown }>,
): FetchHandler {
  return async (input, init) => {
    const url = urlOf(input);
    if (url === "/api/workflow/status") return STATUS;
    if (url === "/api/workflow/definitions") {
      return { definitions: [ZERO_INPUT_DEF, PARAMETERIZED_DEF] };
    }
    if (url.startsWith("/api/workflow/runs")) return { runs: [] };
    if (url === "/api/workflow/trigger" && init?.method === "POST") {
      const parsed = JSON.parse(String(init.body)) as {
        name: string;
        payload?: unknown;
      };
      triggerCalls.push(parsed);
      return { ok: true };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
}

async function renderPanel(): Promise<{
  triggerCalls: Array<{ name: string; payload?: unknown }>;
  fetchMock: ReturnType<typeof vi.fn>;
}> {
  const triggerCalls: Array<{ name: string; payload?: unknown }> = [];
  const fetchMock = installFetch(defaultHandler(triggerCalls));
  const { Wrapper } = makeWrapper();
  render(
    <Wrapper>
      <WorkflowPanel onRunSelect={() => undefined} />
    </Wrapper>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /decomposer/ }),
    ).toBeInTheDocument(),
  );
  return { triggerCalls, fetchMock };
}

describe("WorkflowPanel — trigger surface", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    localStorage.setItem("kota-auth-token", "test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.resetModules();
  });

  it("triggers a zero-input workflow immediately on first click with no payload", async () => {
    const { triggerCalls } = await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /dispatcher/ }));

    await waitFor(() => expect(triggerCalls).toHaveLength(1));
    expect(triggerCalls[0]).toEqual({
      name: "dispatcher",
      payload: undefined,
    });
    expect(
      screen.queryByRole("form", { name: /Trigger dispatcher/ }),
    ).not.toBeInTheDocument();
  });

  it("opens a generated form with one field per inputSchema property when triggering a parameterized workflow", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /decomposer/ }));

    const form = await waitFor(() =>
      screen.getByRole("form", { name: /Trigger decomposer/ }),
    );
    expect(form).toBeInTheDocument();
    expect(screen.getByLabelText(/taskId \*/)).toHaveProperty("type", "text");
    expect(screen.getByLabelText(/maxChildren/)).toHaveProperty(
      "type",
      "number",
    );
    expect(screen.getByLabelText(/includeBlocked/)).toHaveProperty(
      "type",
      "checkbox",
    );

    emitEvidence("workflow-trigger-form-empty.html", form.outerHTML);

    fireEvent.change(screen.getByLabelText(/taskId \*/), {
      target: { value: "task-do-the-thing" },
    });
    fireEvent.change(screen.getByLabelText(/maxChildren/), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByLabelText(/includeBlocked/));
    emitEvidence("workflow-trigger-form-filled.html", form.outerHTML);
  });

  it("blocks submission when required fields are empty and never calls the trigger endpoint", async () => {
    const { triggerCalls } = await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /decomposer/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("form", { name: /Trigger decomposer/ }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Trigger$/ }));

    await waitFor(() =>
      expect(screen.getByText("Required.")).toBeInTheDocument(),
    );
    expect(triggerCalls).toHaveLength(0);
  });

  it("posts the assembled payload with typed values when required fields are filled", async () => {
    const { triggerCalls } = await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /decomposer/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("form", { name: /Trigger decomposer/ }),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/taskId \*/), {
      target: { value: "task-do-the-thing" },
    });
    fireEvent.change(screen.getByLabelText(/maxChildren/), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByLabelText(/includeBlocked/));
    fireEvent.click(screen.getByRole("button", { name: /^Trigger$/ }));

    await waitFor(() => expect(triggerCalls).toHaveLength(1));
    expect(triggerCalls[0]).toEqual({
      name: "decomposer",
      payload: {
        taskId: "task-do-the-thing",
        maxChildren: 3,
        includeBlocked: true,
      },
    });
    expect(typeof triggerCalls[0]?.payload).toBe("object");
    const payload = triggerCalls[0]?.payload as Record<string, unknown>;
    expect(typeof payload.maxChildren).toBe("number");
    expect(typeof payload.includeBlocked).toBe("boolean");
  });

  it("treats an inputSchema with no declared properties as zero-input", async () => {
    const triggerCalls: Array<{ name: string; payload?: unknown }> = [];
    installFetch(async (input, init) => {
      const url = urlOf(input);
      if (url === "/api/workflow/status") return STATUS;
      if (url === "/api/workflow/definitions") {
        return {
          definitions: [
            {
              ...ZERO_INPUT_DEF,
              name: "echo",
              inputSchema: { type: "object" },
            },
          ],
        };
      }
      if (url.startsWith("/api/workflow/runs")) return { runs: [] };
      if (url === "/api/workflow/trigger" && init?.method === "POST") {
        const parsed = JSON.parse(String(init.body));
        triggerCalls.push(parsed);
        return { ok: true };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <WorkflowPanel onRunSelect={() => undefined} />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /echo/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /echo/ }));

    await waitFor(() => expect(triggerCalls).toHaveLength(1));
    expect(triggerCalls[0]).toEqual({ name: "echo", payload: undefined });
  });
});
