import { describe, expect, it } from "vitest";
import {
  envWithoutSourceConditionNodeOption,
  nodeOptionsWithoutSourceCondition,
} from "./node-options.js";

describe("nodeOptionsWithoutSourceCondition", () => {
  it("removes only exact source conditions", () => {
    expect(
      nodeOptionsWithoutSourceCondition(
        "--max-old-space-size=4096 --conditions=source --trace-warnings",
      ),
    ).toEqual({
      nodeOptions: "--max-old-space-size=4096 --trace-warnings",
      removedSourceCondition: true,
    });

    expect(
      nodeOptionsWithoutSourceCondition("--conditions source --conditions=dev"),
    ).toEqual({
      nodeOptions: "--conditions=dev",
      removedSourceCondition: true,
    });
  });

  it("preserves non-source conditions and unrelated options", () => {
    expect(
      nodeOptionsWithoutSourceCondition(
        "--conditions=development --max-old-space-size=2048",
      ),
    ).toEqual({
      nodeOptions: "--conditions=development --max-old-space-size=2048",
      removedSourceCondition: false,
    });
  });

  it("returns undefined when source was the only option", () => {
    expect(nodeOptionsWithoutSourceCondition("--conditions=source")).toEqual({
      nodeOptions: undefined,
      removedSourceCondition: true,
    });
  });
});

describe("envWithoutSourceConditionNodeOption", () => {
  it("returns the original env when no source condition was present", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: "--conditions=development",
    };

    expect(envWithoutSourceConditionNodeOption(env)).toBe(env);
  });

  it("copies the env only when removing the source condition", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: "--conditions=source --max-old-space-size=4096",
      PATH: "/bin",
    };

    const nextEnv = envWithoutSourceConditionNodeOption(env);

    expect(nextEnv).not.toBe(env);
    expect(nextEnv).toEqual({
      NODE_OPTIONS: "--max-old-space-size=4096",
      PATH: "/bin",
    });
  });
});
