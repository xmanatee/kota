/**
 * RetractPanel test — exercises the panel through the same /api/retract
 * surface the daemon route exposes, asserting that each branch of the
 * discriminated `RetractResult` renders its own distinct view:
 *
 *  - `ok: true` with a memory record → success row with target badge and
 *    record id (no path metadata)
 *  - `ok: true` with a tasks record → success row with the "dropped"
 *    state badge and previous → new path
 *  - `ok: false` with `reason: "no_contributors"` → fixed message
 *  - `ok: false` with `reason: "not_found"` → target badge plus the
 *    submitted identifier verbatim and a "no record found" message
 *  - `ok: false` with `reason: "contributor_failed"` → target badge plus
 *    verbatim message
 *
 * The per-target identifier control narrows on the picker value (memory id
 * → knowledge slug → inbox path), and the confirmation gate must display
 * before any /api/retract call is made.
 */

import type { RetractResult } from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetractPanel } from "./RetractPanel";

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

const MEMORY_OK: RetractResult = {
  ok: true,
  record: { target: "memory", recordId: "mem-7" },
};

const TASKS_OK: RetractResult = {
  ok: true,
  record: {
    target: "tasks",
    recordId: "task-old-cleanup",
    previousPath: "data/tasks/ready/task-old-cleanup.md",
    path: "data/tasks/dropped/task-old-cleanup.md",
    toState: "dropped",
  },
};

const NO_CONTRIBUTORS: RetractResult = {
  ok: false,
  reason: "no_contributors",
};

const NOT_FOUND: RetractResult = {
  ok: false,
  reason: "not_found",
  target: "knowledge",
  identifier: "missing-slug",
};

const CONTRIBUTOR_FAILED: RetractResult = {
  ok: false,
  reason: "contributor_failed",
  target: "inbox",
  message: "Inbox writer cannot reach project root",
};

function pickTarget(target: string): void {
  fireEvent.change(screen.getByLabelText(/Retract target/i), {
    target: { value: target },
  });
}

function typeIdentifier(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function clickRetract(): void {
  fireEvent.click(screen.getByRole("button", { name: /^retract$/i }));
}

function clickConfirm(): void {
  fireEvent.click(screen.getByRole("button", { name: /^confirm retract$/i }));
}

function getTargetBadgeText(target: string): HTMLElement {
  const matches = screen.getAllByText(target);
  const badge = matches.find((el) => el.tagName !== "OPTION");
  if (!badge) throw new Error(`No non-option element with text "${target}"`);
  return badge;
}

describe("RetractPanel", () => {
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

  it("renders memory id input by default and gates the request behind a confirmation step", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MEMORY_OK),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RetractPanel />
      </Wrapper>,
    );

    typeIdentifier(/Retract id/i, "mem-7");
    clickRetract();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Confirm retract of memory id/i),
    ).toBeInTheDocument();

    clickConfirm();

    await waitFor(() => expect(screen.getByText("mem-7")).toBeInTheDocument());
    expect(getTargetBadgeText("memory")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/retract",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "memory", id: "mem-7" }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("renders an ok tasks retract with the dropped state badge and path move", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TASKS_OK),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RetractPanel />
      </Wrapper>,
    );

    pickTarget("tasks");
    typeIdentifier(/Retract id/i, "task-old-cleanup");
    clickRetract();
    clickConfirm();

    await waitFor(() =>
      expect(screen.getByText("task-old-cleanup")).toBeInTheDocument(),
    );
    expect(getTargetBadgeText("tasks")).toBeInTheDocument();
    expect(getTargetBadgeText("dropped")).toBeInTheDocument();
    expect(
      screen.getByText(
        /data\/tasks\/ready\/task-old-cleanup\.md.*data\/tasks\/dropped\/task-old-cleanup\.md/,
      ),
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "/api/retract",
      expect.objectContaining({
        body: JSON.stringify({ target: "tasks", id: "task-old-cleanup" }),
      }),
    );
  });

  it("renders the no-contributors message for the no_contributors arm", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(NO_CONTRIBUTORS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RetractPanel />
      </Wrapper>,
    );

    typeIdentifier(/Retract id/i, "anything");
    clickRetract();
    clickConfirm();

    await waitFor(() =>
      expect(
        screen.getByText(
          /Retract unavailable — no contributors registered for the named target\./,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders the not_found arm with the named target and submitted identifier verbatim", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(NOT_FOUND),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RetractPanel />
      </Wrapper>,
    );

    pickTarget("knowledge");
    typeIdentifier(/Retract slug/i, "missing-slug");
    clickRetract();
    clickConfirm();

    await waitFor(() =>
      expect(screen.getByText("missing-slug")).toBeInTheDocument(),
    );
    expect(getTargetBadgeText("knowledge")).toBeInTheDocument();
    expect(screen.getByText("no record found")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "/api/retract",
      expect.objectContaining({
        body: JSON.stringify({ target: "knowledge", slug: "missing-slug" }),
      }),
    );
  });

  it("renders contributor_failed with the offending target and verbatim message", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(CONTRIBUTOR_FAILED),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RetractPanel />
      </Wrapper>,
    );

    pickTarget("inbox");
    typeIdentifier(/Retract path/i, "data/inbox/note-foo.md");
    clickRetract();
    clickConfirm();

    await waitFor(() =>
      expect(
        screen.getByText("Inbox writer cannot reach project root"),
      ).toBeInTheDocument(),
    );
    expect(getTargetBadgeText("inbox")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "/api/retract",
      expect.objectContaining({
        body: JSON.stringify({
          target: "inbox",
          path: "data/inbox/note-foo.md",
        }),
      }),
    );
  });

  it("narrows the identifier control by target and resets the draft when the target changes", () => {
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RetractPanel />
      </Wrapper>,
    );

    expect(screen.getByLabelText(/Retract id/i)).toBeInTheDocument();
    typeIdentifier(/Retract id/i, "mem-7");
    expect(screen.getByLabelText(/Retract id/i)).toHaveValue("mem-7");

    pickTarget("knowledge");
    expect(screen.getByLabelText(/Retract slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Retract slug/i)).toHaveValue("");
    expect(screen.queryByLabelText(/Retract id/i)).not.toBeInTheDocument();

    pickTarget("inbox");
    expect(screen.getByLabelText(/Retract path/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Retract slug/i)).not.toBeInTheDocument();
  });

  it("disables submit until a non-empty identifier is set", () => {
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RetractPanel />
      </Wrapper>,
    );

    const button = screen.getByRole("button", { name: /^retract$/i });
    expect(button).toBeDisabled();

    typeIdentifier(/Retract id/i, "   ");
    expect(button).toBeDisabled();

    typeIdentifier(/Retract id/i, "mem-7");
    expect(button).not.toBeDisabled();
  });
});
