/**
 * Capture namespace daemon-side handler test.
 *
 * The capture namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the capture module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The capture module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `capture` namespace.
 *  2. `capture` is wired through the typed `DaemonTransport.requestStrict<T>`
 *     shape — calling `capture` issues `POST /capture` with the
 *     `{ text, ...(filter && { filter }) }` JSON body the prior `captureHttp`
 *     emitted byte-for-byte.
 *  3. Every `CaptureFilter` arm (no filter, target-only, hint-only,
 *     both-fields) threads through the wire body unchanged. When no filter
 *     is provided, `filter` is omitted entirely from the body so the daemon
 *     never sees a `filter: undefined` field.
 *  4. Every `CaptureResult` arm decodes through `requestStrict<T>` unchanged,
 *     covering the four `ok: true` `CaptureRecord` discriminants
 *     (memory / knowledge / tasks / inbox) plus the three `ok: false`
 *     reason arms (`ambiguous`, `no_contributors`, `contributor_failed`).
 *  5. Removing the capture module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "capture" missing-handler
 *     error. This is the failure mode the namespace migration replaces:
 *     no silent fallback, no core-side stub.
 *  6. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { CaptureResult } from "./client.js";
import captureModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
};

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ method, path, body });
      return responder(method, path, body) as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("capture module daemonClient(link)", () => {
  it("contributes a capture namespace handler", () => {
    expect(captureModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = captureModule.daemonClient!(link);
    expect(contributed.capture).toBeDefined();
    expect(typeof contributed.capture!.capture).toBe("function");
  });

  it("routes through POST /capture with no filter and omits the filter field from the body", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: { target: "memory", recordId: "mem-7" },
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("note text");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "POST", path: "/capture", body: { text: "note text" } },
    ]);
  });

  it("threads a target-only filter through the wire body verbatim", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: {
        target: "inbox",
        recordId: "note-x",
        path: "data/inbox/note-x.md",
      },
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("just a thought", {
      target: "inbox",
    });
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/capture",
        body: { text: "just a thought", filter: { target: "inbox" } },
      },
    ]);
  });

  it("threads a hint-only filter through the wire body verbatim", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: { target: "knowledge", recordId: "discriminated-unions" },
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("a fact", {
      hint: "feels like reference material",
    });
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/capture",
        body: {
          text: "a fact",
          filter: { hint: "feels like reference material" },
        },
      },
    ]);
  });

  it("threads a both-fields filter through the wire body verbatim", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: {
        target: "tasks",
        recordId: "task-x",
        path: "data/tasks/backlog/task-x.md",
      },
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("track this work", {
      target: "tasks",
      hint: "p1 architecture",
    });
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/capture",
        body: {
          text: "track this work",
          filter: { target: "tasks", hint: "p1 architecture" },
        },
      },
    ]);
  });

  it("decodes the ok memory CaptureRecord arm", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: { target: "memory", recordId: "mem-1" },
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("remember this");
    expect(result).toEqual(expected);
  });

  it("decodes the ok knowledge CaptureRecord arm", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: { target: "knowledge", recordId: "kn-slug" },
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("a structured fact");
    expect(result).toEqual(expected);
  });

  it("decodes the ok tasks CaptureRecord arm with path metadata", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: {
        target: "tasks",
        recordId: "task-y",
        path: "data/tasks/backlog/task-y.md",
      },
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("a new task");
    expect(result).toEqual(expected);
  });

  it("decodes the ok inbox CaptureRecord arm with path metadata", async () => {
    const expected: CaptureResult = {
      ok: true,
      record: {
        target: "inbox",
        recordId: "note-y",
        path: "data/inbox/note-y.md",
      },
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("a quick note");
    expect(result).toEqual(expected);
  });

  it("decodes the ambiguous envelope arm with suggestions", async () => {
    const expected: CaptureResult = {
      ok: false,
      reason: "ambiguous",
      suggestions: ["memory", "knowledge", "tasks", "inbox"],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("not sure");
    expect(result).toEqual(expected);
  });

  it("decodes the no_contributors envelope arm", async () => {
    const expected: CaptureResult = { ok: false, reason: "no_contributors" };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("anything");
    expect(result).toEqual(expected);
  });

  it("decodes the contributor_failed envelope arm carrying target and message", async () => {
    const expected: CaptureResult = {
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk read-only",
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = captureModule.daemonClient!(transport);
    const result = await contributed.capture!.capture("a quick note", {
      target: "inbox",
    });
    expect(result).toEqual(expected);
  });

  it("the assembly path fails loudly when the capture module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.capture;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /capture/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the capture module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = captureModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.capture;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
