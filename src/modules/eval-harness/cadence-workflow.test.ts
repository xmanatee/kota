import { describe, expect, it } from "vitest";
import {
  EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV,
  EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV,
  EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV,
  resolveCadenceIsolationBackend,
} from "./cadence-workflow.js";

describe("eval-harness cadence isolation backend selection", () => {
  it("defaults cadence execution to host subprocess isolation", () => {
    expect(resolveCadenceIsolationBackend({})).toEqual({
      kind: "host-subprocess",
    });
  });

  it("selects a strict container backend only when all cadence env fields are set", () => {
    expect(
      resolveCadenceIsolationBackend({
        [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "docker",
        [EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV]: "node:22-bookworm",
        [EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV]:
          "/opt/kota/bin/kota.mjs",
      }),
    ).toEqual({
      kind: "container",
      executable: "docker",
      image: "node:22-bookworm",
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
    });
  });

  it("fails loudly on incomplete cadence container config", () => {
    expect(() =>
      resolveCadenceIsolationBackend({
        [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "docker",
      }),
    ).toThrow(/must be set together/);
  });

  it("fails loudly on empty cadence container config values", () => {
    expect(() =>
      resolveCadenceIsolationBackend({
        [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "",
        [EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV]: "node:22-bookworm",
      }),
    ).toThrow(/must be set together/);
  });

  it("fails loudly on relative cadence container binary paths", () => {
    expect(() =>
      resolveCadenceIsolationBackend({
        [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "docker",
        [EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV]: "node:22-bookworm",
        [EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV]:
          "bin/kota.mjs",
      }),
    ).toThrow(/absolute container path/);
  });
});
