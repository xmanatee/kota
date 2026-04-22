import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasHarnessHooks,
  listHarnessHooks,
  registerHarnessHook,
  removeHarnessHooks,
  resetHarnessHooks,
} from "./hooks.js";

describe("harness hook registry", () => {
  afterEach(() => {
    resetHarnessHooks();
  });

  it("registers and lists hooks by kind", () => {
    const preRun = vi.fn();
    const postRun = vi.fn();
    registerHarnessHook({
      kind: "preRun",
      owner: "mod-a",
      name: "before",
      handler: preRun,
    });
    registerHarnessHook({
      kind: "postRun",
      owner: "mod-a",
      name: "after",
      handler: postRun,
    });

    expect(listHarnessHooks("preRun")).toHaveLength(1);
    expect(listHarnessHooks("postRun")).toHaveLength(1);
    expect(listHarnessHooks("preRun")[0]?.handler).toBe(preRun);
    expect(hasHarnessHooks("preRun")).toBe(true);
  });

  it("rejects duplicate (owner, name) pairs per kind", () => {
    registerHarnessHook({
      kind: "preRun",
      owner: "mod-a",
      name: "dup",
      handler: () => {},
    });
    expect(() =>
      registerHarnessHook({
        kind: "preRun",
        owner: "mod-a",
        name: "dup",
        handler: () => {},
      }),
    ).toThrow(/already registered/);
  });

  it("allows the same hook name under different owners", () => {
    registerHarnessHook({
      kind: "preRun",
      owner: "mod-a",
      name: "shared",
      handler: () => {},
    });
    registerHarnessHook({
      kind: "preRun",
      owner: "mod-b",
      name: "shared",
      handler: () => {},
    });
    expect(listHarnessHooks("preRun")).toHaveLength(2);
  });

  it("removes every hook owned by a module", () => {
    registerHarnessHook({
      kind: "preRun",
      owner: "mod-a",
      name: "one",
      handler: () => {},
    });
    registerHarnessHook({
      kind: "postRun",
      owner: "mod-a",
      name: "two",
      handler: () => {},
    });
    registerHarnessHook({
      kind: "preRun",
      owner: "mod-b",
      name: "three",
      handler: () => {},
    });

    removeHarnessHooks("mod-a");

    expect(listHarnessHooks("preRun")).toHaveLength(1);
    expect(listHarnessHooks("preRun")[0]?.owner).toBe("mod-b");
    expect(listHarnessHooks("postRun")).toHaveLength(0);
  });
});
