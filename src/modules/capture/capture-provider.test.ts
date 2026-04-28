import { describe, expect, it } from "vitest";
import { CaptureProviderImpl } from "./capture-provider.js";
import type {
  CaptureClassifier,
  CaptureContributor,
  CaptureRecord,
  CaptureTarget,
} from "./capture-types.js";

function fixedContributor(
  target: CaptureTarget,
  record: CaptureRecord,
): CaptureContributor {
  return {
    target,
    async capture() {
      return record;
    },
  };
}

function failingContributor(
  target: CaptureTarget,
  err: Error,
): CaptureContributor {
  return {
    target,
    async capture() {
      throw err;
    },
  };
}

function fixedClassifier(
  result: { kind: "confident"; target: CaptureTarget } | { kind: "ambiguous" },
): CaptureClassifier {
  return {
    async classify() {
      return result;
    },
  };
}

const memRecord: CaptureRecord = { target: "memory", recordId: "mem-1" };
const knowRecord: CaptureRecord = {
  target: "knowledge",
  recordId: "k-slug",
};
const taskRecord: CaptureRecord = {
  target: "tasks",
  recordId: "task-x",
  path: "data/tasks/backlog/task-x.md",
};
const inboxRecord: CaptureRecord = {
  target: "inbox",
  recordId: "note-x",
  path: "data/inbox/note-x.md",
};

describe("CaptureProviderImpl", () => {
  it("dispatches verbatim when target is set", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(fixedContributor("memory", memRecord));
    provider.register(fixedContributor("knowledge", knowRecord));

    const result = await provider.capture("dark themes please", {
      target: "memory",
    });
    expect(result).toEqual({ ok: true, record: memRecord });
  });

  it("returns no_contributors when explicit target is unregistered", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(fixedContributor("memory", memRecord));

    const result = await provider.capture("hello", { target: "knowledge" });
    expect(result).toEqual({ ok: false, reason: "no_contributors" });
  });

  it("returns no_contributors when no contributors are registered", async () => {
    const provider = new CaptureProviderImpl();
    const result = await provider.capture("anything");
    expect(result).toEqual({ ok: false, reason: "no_contributors" });
  });

  it("surfaces ambiguous with full suggestions when no classifier and no target", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(fixedContributor("memory", memRecord));
    provider.register(fixedContributor("tasks", taskRecord));

    const result = await provider.capture("plain note");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("ambiguous");
    if (result.reason !== "ambiguous") throw new Error("unreachable");
    expect(result.suggestions).toEqual(["memory", "tasks"]);
  });

  it("dispatches via classifier when target is unset", async () => {
    const provider = new CaptureProviderImpl({
      classifier: fixedClassifier({ kind: "confident", target: "tasks" }),
    });
    provider.register(fixedContributor("memory", memRecord));
    provider.register(fixedContributor("tasks", taskRecord));

    const result = await provider.capture("review macOS push permissions");
    expect(result).toEqual({ ok: true, record: taskRecord });
  });

  it("surfaces ambiguous when classifier abstains", async () => {
    const provider = new CaptureProviderImpl({
      classifier: fixedClassifier({ kind: "ambiguous" }),
    });
    provider.register(fixedContributor("memory", memRecord));
    provider.register(fixedContributor("tasks", taskRecord));

    const result = await provider.capture("ambiguous-ish text");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("ambiguous");
  });

  it("falls back to ambiguous when classifier picks an unregistered target", async () => {
    const provider = new CaptureProviderImpl({
      classifier: fixedClassifier({ kind: "confident", target: "knowledge" }),
    });
    provider.register(fixedContributor("memory", memRecord));

    const result = await provider.capture("plain note");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("ambiguous");
  });

  it("returns ambiguous on empty / whitespace text without throwing", async () => {
    const provider = new CaptureProviderImpl({
      classifier: fixedClassifier({ kind: "confident", target: "memory" }),
    });
    provider.register(fixedContributor("memory", memRecord));

    const empty = await provider.capture("");
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error("unreachable");
    expect(empty.reason).toBe("ambiguous");
    const ws = await provider.capture("   \t\n  ");
    expect(ws.ok).toBe(false);
    if (ws.ok) throw new Error("unreachable");
    expect(ws.reason).toBe("ambiguous");
  });

  it("surfaces contributor_failed when the writer throws", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(failingContributor("inbox", new Error("disk full")));

    const result = await provider.capture("rough thought", {
      target: "inbox",
    });
    expect(result).toEqual({
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk full",
    });
  });

  it("does not silently retry into another store when one contributor throws", async () => {
    const calls: CaptureTarget[] = [];
    const tracking = (
      target: CaptureTarget,
      onCall: () => CaptureRecord | Promise<never>,
    ): CaptureContributor => ({
      target,
      async capture() {
        calls.push(target);
        return onCall();
      },
    });
    const provider = new CaptureProviderImpl({
      classifier: fixedClassifier({ kind: "confident", target: "tasks" }),
    });
    provider.register(
      tracking("tasks", () => {
        throw new Error("boom");
      }),
    );
    provider.register(tracking("memory", () => memRecord));

    const result = await provider.capture("anything");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("contributor_failed");
    expect(calls).toEqual(["tasks"]);
  });

  it("contributors() returns registration order", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(fixedContributor("inbox", inboxRecord));
    provider.register(fixedContributor("knowledge", knowRecord));
    expect(provider.contributors()).toEqual(["inbox", "knowledge"]);
  });

  it("re-registering the same target replaces the prior contributor", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(fixedContributor("memory", memRecord));
    const replacement: CaptureRecord = { target: "memory", recordId: "mem-2" };
    provider.register(fixedContributor("memory", replacement));

    const result = await provider.capture("x", { target: "memory" });
    expect(result).toEqual({ ok: true, record: replacement });
    expect(provider.contributors()).toEqual(["memory"]);
  });

  it("forwards hint to the classifier and the contributor input", async () => {
    let observedClassifyHint: string | undefined;
    let observedContribHint: string | undefined;
    const classifier: CaptureClassifier = {
      async classify(input) {
        observedClassifyHint = input.hint;
        return { kind: "confident", target: "memory" };
      },
    };
    const provider = new CaptureProviderImpl({ classifier });
    provider.register({
      target: "memory",
      async capture(input) {
        observedContribHint = input.hint;
        return memRecord;
      },
    });

    await provider.capture("dark themes", { hint: "preference" });
    expect(observedClassifyHint).toBe("preference");
    expect(observedContribHint).toBe("preference");
  });

  it("suggestions use the canonical contributor order", async () => {
    const provider = new CaptureProviderImpl();
    // Register in a non-canonical order.
    provider.register(fixedContributor("inbox", inboxRecord));
    provider.register(fixedContributor("memory", memRecord));
    provider.register(fixedContributor("knowledge", knowRecord));
    provider.register(fixedContributor("tasks", taskRecord));

    const result = await provider.capture("plain text");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("ambiguous");
    if (result.reason !== "ambiguous") throw new Error("unreachable");
    expect(result.suggestions).toEqual(["memory", "knowledge", "tasks", "inbox"]);
  });
});
