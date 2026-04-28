import { describe, expect, it } from "vitest";
import { RetractProviderImpl } from "./retract-provider.js";
import type {
  RetractContributor,
  RetractContributorResult,
} from "./retract-types.js";

function fixedContributor(args: {
  target: "memory";
  removeResult: RetractContributorResult;
}): RetractContributor;
function fixedContributor(args: {
  target: "knowledge";
  removeResult: RetractContributorResult;
}): RetractContributor;
function fixedContributor(args: {
  target: "tasks";
  removeResult: RetractContributorResult;
}): RetractContributor;
function fixedContributor(args: {
  target: "inbox";
  removeResult: RetractContributorResult;
}): RetractContributor;
function fixedContributor(args: {
  target: "memory" | "knowledge" | "tasks" | "inbox";
  removeResult: RetractContributorResult;
}): RetractContributor {
  switch (args.target) {
    case "memory":
      return {
        target: "memory",
        async retract() {
          return args.removeResult;
        },
      };
    case "knowledge":
      return {
        target: "knowledge",
        async retract() {
          return args.removeResult;
        },
      };
    case "tasks":
      return {
        target: "tasks",
        async retract() {
          return args.removeResult;
        },
      };
    case "inbox":
      return {
        target: "inbox",
        async retract() {
          return args.removeResult;
        },
      };
  }
}

describe("RetractProviderImpl", () => {
  it("returns no_contributors when nothing is registered", async () => {
    const provider = new RetractProviderImpl();
    const result = await provider.retract({ target: "memory", id: "mem-1" });
    expect(result).toEqual({ ok: false, reason: "no_contributors" });
  });

  it("returns no_contributors when the named target is unregistered", async () => {
    const provider = new RetractProviderImpl();
    provider.register(
      fixedContributor({
        target: "memory",
        removeResult: {
          kind: "removed",
          record: { target: "memory", recordId: "mem-1" },
        },
      }),
    );
    const result = await provider.retract({
      target: "knowledge",
      slug: "k-slug",
    });
    expect(result).toEqual({ ok: false, reason: "no_contributors" });
  });

  it("returns the typed success arm when the contributor reports removed", async () => {
    const provider = new RetractProviderImpl();
    provider.register(
      fixedContributor({
        target: "memory",
        removeResult: {
          kind: "removed",
          record: { target: "memory", recordId: "mem-1" },
        },
      }),
    );
    const result = await provider.retract({ target: "memory", id: "mem-1" });
    expect(result).toEqual({
      ok: true,
      record: { target: "memory", recordId: "mem-1" },
    });
  });

  it("returns not_found with the original identifier when the contributor reports not_found", async () => {
    const provider = new RetractProviderImpl();
    provider.register(
      fixedContributor({
        target: "knowledge",
        removeResult: { kind: "not_found", identifier: "missing-slug" },
      }),
    );
    const result = await provider.retract({
      target: "knowledge",
      slug: "missing-slug",
    });
    expect(result).toEqual({
      ok: false,
      reason: "not_found",
      target: "knowledge",
      identifier: "missing-slug",
    });
  });

  it("surfaces contributor_failed when the writer throws", async () => {
    const provider = new RetractProviderImpl();
    provider.register({
      target: "inbox",
      async retract() {
        throw new Error("disk read-only");
      },
    });
    const result = await provider.retract({
      target: "inbox",
      path: "data/inbox/note-x.md",
    });
    expect(result).toEqual({
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk read-only",
    });
  });

  it("does not retry into another store when one contributor reports not_found", async () => {
    const calls: string[] = [];
    const provider = new RetractProviderImpl();
    provider.register({
      target: "memory",
      async retract() {
        calls.push("memory");
        return { kind: "not_found", identifier: "mem-1" };
      },
    });
    provider.register({
      target: "knowledge",
      async retract() {
        calls.push("knowledge");
        return {
          kind: "removed",
          record: { target: "knowledge", recordId: "k" },
        };
      },
    });

    const result = await provider.retract({ target: "memory", id: "mem-1" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not_found");
    expect(calls).toEqual(["memory"]);
  });

  it("contributors() returns registration order", () => {
    const provider = new RetractProviderImpl();
    provider.register(
      fixedContributor({
        target: "inbox",
        removeResult: {
          kind: "removed",
          record: {
            target: "inbox",
            recordId: "note-x",
            path: "data/inbox/note-x.md",
          },
        },
      }),
    );
    provider.register(
      fixedContributor({
        target: "memory",
        removeResult: {
          kind: "removed",
          record: { target: "memory", recordId: "mem-1" },
        },
      }),
    );
    expect(provider.contributors()).toEqual(["inbox", "memory"]);
  });

  it("re-registering the same target replaces the prior contributor", async () => {
    const provider = new RetractProviderImpl();
    provider.register(
      fixedContributor({
        target: "memory",
        removeResult: {
          kind: "removed",
          record: { target: "memory", recordId: "mem-old" },
        },
      }),
    );
    provider.register(
      fixedContributor({
        target: "memory",
        removeResult: {
          kind: "removed",
          record: { target: "memory", recordId: "mem-new" },
        },
      }),
    );

    const result = await provider.retract({ target: "memory", id: "mem-x" });
    expect(result).toEqual({
      ok: true,
      record: { target: "memory", recordId: "mem-new" },
    });
    expect(provider.contributors()).toEqual(["memory"]);
  });
});
